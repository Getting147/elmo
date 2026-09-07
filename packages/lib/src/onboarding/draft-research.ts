/**
 * Epic A-2 (V1.0) M2: 草稿持久化层
 * 设计：D:\NegencyWiki\概念\项目管理\GEO\GEO-V2品牌研究管道-设计-20260906.md v1.0
 *
 * 状态机 5 态（CHECK 约束见 migration 0017）：
 * - pending_review: LLM 完成等用户确认
 * - confirmed:      用户已确认待灌库
 * - applied:        已 populate 目标表（V1.1 拆分）
 * - done:           流程完成（同 applied V1 语义）
 * - failed:         LLM/抓取失败（error 字段有原因）
 * - rolled_back:    用户后悔放弃（V1 软删 = 状态标记）
 *
 * idempotency: 同 brand + url_hash 命中 active 态（pending_review/confirmed）→ 直返
 * 重试覆盖: failed 状态可被新草稿覆盖（先 deleteFailed 再 insert）
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { brands, draftResearch } from "@workspace/lib/db/schema";
import { type OnboardingSuggestion } from "@workspace/lib/onboarding";
import {
	DEFAULT_DRAFT_TTL_MS,
	hashUrlForDraft,
	computeExpiresAt,
} from "./draft-research-utils";

export { DEFAULT_DRAFT_TTL_MS, hashUrlForDraft, computeExpiresAt };

/** PG 23505 unique_violation SQLSTATE */
const PG_UNIQUE_VIOLATION = "23505";

/** Drizzle pg 龙卷风错误类型（不导出，type-only import） */
type PgError = { code?: string; constraint?: string; message?: string };

/**
 * 清理同 url_hash 的 failed/expired 行（避免 partial unique 冲突 + 释放空间）。
 * 在 createDraft 前调用。
 *
 * F1-8 修正（避免重跑命中过期 pending_review/done 返旧草稿）：
 * 过期行（expires_at < now()）不论 state 一律清 — done 行 payload 已灌库无保留价值；
 * 过期 pending_review 必清（用户重跑应能新建）。
 */
export async function deleteFailedOrExpiredForHash(
	brandId: string,
	urlHash: string,
): Promise<number> {
	const result = await db
		.delete(draftResearch)
		.where(
			and(
				eq(draftResearch.brandId, brandId),
				eq(draftResearch.urlHash, urlHash),
				sql`(${draftResearch.state} IN ('failed', 'rolled_back') OR ${draftResearch.expiresAt} < now())`,
			),
		)
		.returning({ id: draftResearch.id });
	return result.length;
}

/**
 * 验证 brand 存在（FK CASCADE 由 DB 保证，但端点需显式 404 守卫）
 */
export async function brandExists(brandId: string): Promise<boolean> {
	const row = await db.query.brands.findFirst({
		where: eq(brands.id, brandId),
		columns: { id: true },
	});
	return row !== undefined;
}

/**
 * 创建草稿 — 含 idempotency 处理（partial unique conflict → SELECT 返现有）。
 */
export async function createDraft(args: {
	brandId: string;
	website: string;
	payload: OnboardingSuggestion;
}): Promise<{ id: string; alreadyExisted: boolean }> {
	const { brandId, website, payload } = args;
	const urlHash = hashUrlForDraft(website);

	// 先清理同 hash 的 failed/rolled_back 行（避免 partial unique 冲突 + 节省空间）
	await deleteFailedOrExpiredForHash(brandId, urlHash);

	const id = `dres_${randomUUID()}`;
	const expiresAt = computeExpiresAt();

	try {
		const [inserted] = await db
			.insert(draftResearch)
			.values({
				id,
				brandId,
				urlHash,
				state: "pending_review",
				payload,
				expiresAt,
			})
			.returning({ id: draftResearch.id });
		return { id: inserted.id, alreadyExisted: false };
	} catch (err) {
		// Partial unique conflict → 返 existing active draft（idempotency 活态直返）
		if ((err as PgError).code === PG_UNIQUE_VIOLATION) {
			const existing = await db.query.draftResearch.findFirst({
				where: and(
					eq(draftResearch.brandId, brandId),
					eq(draftResearch.urlHash, urlHash),
					inArray(draftResearch.state, ["pending_review", "confirmed"]),
				),
				columns: { id: draftResearch.id },
			});
			if (existing) {
				return { id: existing.id, alreadyExisted: true };
			}
			throw err; // 真正的非 idempotency 错误，重抛
		}
		throw err;
	}
}

/**
 * 标记草稿为 failed（LLM/抓取失败时调用）
 */
export async function markFailed(args: { id: string; error: string }): Promise<void> {
	const { id, error } = args;
	await db
		.update(draftResearch)
		.set({ state: "failed", error, updatedAt: new Date() })
		.where(eq(draftResearch.id, id));
}

/**
 * 标记草稿为 confirmed（confirm 端点事务内调用）
 */
export async function markConfirmed(id: string): Promise<void> {
	await db
		.update(draftResearch)
		.set({ state: "confirmed", error: null, updatedAt: new Date() })
		.where(eq(draftResearch.id, id));
}

/**
 * 标记草稿为 applied（confirm 端点事务成功后调用）
 */
export async function markApplied(id: string): Promise<void> {
	await db
		.update(draftResearch)
		.set({ state: "applied", updatedAt: new Date() })
		.where(eq(draftResearch.id, id));
}

/**
 * 标记草稿为 rolled_back（rollback 端点调用，物理不删）
 */
export async function markRolledBack(id: string): Promise<void> {
	await db
		.update(draftResearch)
		.set({ state: "rolled_back", updatedAt: new Date() })
		.where(eq(draftResearch.id, id));
}

/**
 * 单条草稿查询（draft 详情页用）
 */
export async function getDraftById(id: string) {
	return db.query.draftResearch.findFirst({
		where: eq(draftResearch.id, id),
	});
}

/**
 * 品牌草稿列表（V1 默认过滤 expires_at > now()，排除过期）
 * ORDER BY created_at DESC（最新在前）
 *
 * S2-2: includeAll=true 时全显（含 failed/rolled_back/expired，仅排除无效态）
 * — 默认按 hill 拍板：state IN ('pending_review','done') AND expires_at > now()
 * — 兼容老调用（不传 includeAll → 默认 false 走默认行为）
 */
export async function listDraftsByBrand(brandId: string, includeAll: boolean = false) {
	const stateFilter = includeAll
		? sql`(${draftResearch.state} IN ('pending_review', 'confirmed', 'done', 'failed', 'rolled_back') AND ${draftResearch.expiresAt} > now())`
		: sql`(${draftResearch.state} IN ('pending_review', 'done') AND ${draftResearch.expiresAt} > now())`;
	return db
		.select()
		.from(draftResearch)
		.where(and(eq(draftResearch.brandId, brandId), stateFilter))
		.orderBy(sql`${draftResearch.createdAt} DESC`);
}
