/**
 * Epic A-2 (V1.0) M2: 研究业务层 (research.ts)
 *
 * 封装 brand research 业务流程：
 * - researchBrand: 触发抓取+LLM（analyzeBrand）+ 落 draft_research
 * - confirmDraft: 乐观锁 + 事务内 populate + 标 done
 * - rollbackDraft: 仅 pending_review 可回滚
 *
 * 设计：D:\NegencyWiki\概念\项目管理\GEO\GEO-V2品牌研究管道-设计-20260906.md v1.0
 * 状态语义（V1 拍板）：只持久 4 态（pending_review/done/failed/rolled_back）
 */

import { db } from "@workspace/lib/db/db";
import { brands, draftResearch } from "@workspace/lib/db/schema";
import {
	analyzeBrand,
	createDraft,
	getDraftById,
	listDraftsByBrand,
	markFailed,
	markRolledBack,
	type OnboardingSuggestion,
} from "@workspace/lib/onboarding";
import { and, eq, inArray } from "drizzle-orm";
import { getBoss } from "@/lib/boss-client";
import { BrandNotFoundError, saveWizardOnboarding, type WizardOnboardingInput } from "@/server/onboarding-core";

export class DraftNotFoundError extends Error {
	constructor(public readonly draftId: string) {
		super(`Draft "${draftId}" not found.`);
		this.name = "DraftNotFoundError";
	}
}

export class DraftConflictError extends Error {
	constructor(
		public readonly draftId: string,
		public readonly state: string,
	) {
		super(`Draft "${draftId}" is in state "${state}" — cannot perform this action.`);
		this.name = "DraftConflictError";
	}
}

/**
 * convertOnboardingSuggestionToWizardInput — V1.2 改造前临时方案。
 * 把 LLM 输出的 OnboardingSuggestion 转为 wizardOnboardingInputSchema 可消费对象。
 *
 * V1.0 关键约束：只灌库 confirmed[] 产品线（unverified 永不进库 — 防幻觉证据缺失）
 */
function convertOnboardingSuggestionToWizardInput(args: {
	brandId: string;
	website: string;
	additionalDomains: string[];
	suggestion: OnboardingSuggestion;
}): WizardOnboardingInput {
	const { brandId, website, additionalDomains, suggestion } = args;

	// productLines 只取 confirmed[] — unverified 全部丢弃（按 hill mtqroz9m5a 拍板 V1 语义）
	const confirmedProductLines = (suggestion.productLines?.confirmed ?? []).map(
		({ line }): { name: string; skus: typeof line.skus } => ({
			name: line.name,
			skus: line.skus,
		}),
	);

	return {
		brandId,
		website,
		additionalDomains,
		aliases: suggestion.aliases,
		summary: suggestion.summary,
		description: suggestion.description,
		productLines: confirmedProductLines,
		competitors: suggestion.competitors.map((c) => ({
			name: c.name,
			domains: c.domains,
			aliases: c.aliases,
		})),
		prompts: suggestion.suggestedPrompts.map((p) => ({
			value: p.prompt,
			tags: p.tags,
			enabled: true,
		})),
	};
}

/**
 * 触发 brand research — 抓取 + LLM analyze + 落 draft_research。
 *
 * V1: 同步实现（V2 可改 async job）
 *
 * 流程：
 * 1. 校验 brand 存在（404 守卫）
 * 2. 调 analyzeBrand(options) — 内部已含 evidence 校验
 * 3. createDraft（partial unique 幂等 — 同 url_hash active 直返；failed 覆盖）
 * 4. 如 createDraft 之前 LLM 抛错 → markFailed
 *
 * 失败语义：draft_research row 仍落 + state=failed + error 字段有原因
 */
export async function researchBrand(args: {
	brandId: string;
	website: string;
	maxCompetitors?: number;
	maxPrompts?: number;
	maxProducts?: number;
	crawledPageTexts?: Map<string, string>;
}): Promise<{ draftId: string; alreadyExisted: boolean }> {
	const { brandId, website } = args;

	// 1. 404 守卫
	const brandRow = await db.query.brands.findFirst({
		where: eq(brands.id, brandId),
		columns: { id: true },
	});
	if (!brandRow) {
		throw new BrandNotFoundError(brandId);
	}

	// 2. 调 analyzeBrand（含 evidence 校验）
	let suggestion: OnboardingSuggestion;
	try {
		suggestion = await analyzeBrand({
			website,
			maxCompetitors: args.maxCompetitors ?? 10,
			maxPrompts: args.maxPrompts ?? 30,
			maxProducts: args.maxProducts ?? 10,
			crawledPageTexts: args.crawledPageTexts,
		});
	} catch (err) {
		// LLM/抓取失败 → 先创建 failed 草稿（让前端能查到失败原因）
		const { id } = await createDraft({
			brandId,
			website,
			payload: {
				brandName: "",
				website,
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
			} as OnboardingSuggestion,
		}).catch(() => ({ id: `failed_${Date.now()}`, alreadyExisted: false }));
		await markFailed({ id, error: err instanceof Error ? err.message : String(err) });
		throw err;
	}

	// 3. 落草稿（含 partial unique 幂等）
	const created = await createDraft({
		brandId,
		website,
		payload: suggestion,
	});
	return { draftId: created.id, alreadyExisted: created.alreadyExisted };
}

/**
 * 确认草稿 → 灌库（事务内乐观锁 + populate + 标 done）
 *
 * V1 乐观并发（按 hill mtqroz9m5a 拍板，不引入 version 列）：
 * - 1. UPDATE draft_research SET state='done' WHERE id=? AND state IN ('pending_review','confirmed') RETURNING id
 * - 2. 0 行 = 409 草稿非待确认状态
 * - 3. 1 行 = 继续 populate（saveWizardOnboarding 复用 M1 helpers）
 * - 4. populate 失败 → 整体回滚（事务自动，state 仍 = pending_review 因 1 步未提交）
 */
export async function confirmDraft(draftId: string): Promise<{ id: string }> {
	return db.transaction(async (tx) => {
		// 乐观锁 UPDATE — 0 行 = 409
		const updated = await tx
			.update(draftResearch)
			.set({ state: "done", updatedAt: new Date() })
			.where(and(eq(draftResearch.id, draftId), inArray(draftResearch.state, ["pending_review", "confirmed"])))
			.returning({ id: draftResearch.id });

		if (updated.length === 0) {
			// 查实际状态返 409 详细（用 db 读，无依赖 tx 状态）
			const cur = await db.query.draftResearch.findFirst({
				where: eq(draftResearch.id, draftId),
			});
			if (!cur) throw new DraftNotFoundError(draftId);
			throw new DraftConflictError(draftId, cur.state);
		}

		// populate（同一事务 — 失败自动回滚，包括上面的 state='done' UPDATE）
		const draft = await tx.query.draftResearch.findFirst({
			where: eq(draftResearch.id, draftId),
		});
		if (!draft) {
			// Race: 事务内某步删了 draft（应不会发生，但兜底）
			throw new DraftNotFoundError(draftId);
		}

		const payload = draft.payload as OnboardingSuggestion;
		const input = convertOnboardingSuggestionToWizardInput({
			brandId: draft.brandId,
			website: payload.website,
			additionalDomains: payload.additionalDomains,
			suggestion: payload,
		});
		await saveWizardOnboarding(input, tx);

		return { id: draftId };
	});
}

/**
 * 回滚草稿 — 仅 pending_review 可回滚（confirmed/done/applied 拒绝 → 409）
 *
 * V1 拍板：failed 不提供 rollback（DELETE 或重跑覆盖）
 */
export async function rollbackDraft(draftId: string): Promise<void> {
	const draft = await getDraftById(draftId);
	if (!draft) throw new DraftNotFoundError(draftId);
	if (draft.state !== "pending_review") {
		throw new DraftConflictError(draftId, draft.state);
	}
	await markRolledBack(draftId);
}

// Re-export list/get helpers for endpoint convenience
export { getDraftById, listDraftsByBrand };

// =============================================================================
// Epic A-2 (V1.0) M2 c3-job: triggerResearch — async job 化入口
// 同步 analyzeBrand（30-90s 抓站+LLM）改造为 pg-boss enqueue（<100ms 即返）
// =============================================================================

/** V1 pg-boss 队列名（c3-job 异步 LLM 处理） */
const ANALYZE_BRAND_RESEARCH_QUEUE = "analyze-brand-research";

/**
 * V1 占位 payload（legal OnboardingSuggestion 最小完整形状）：
 * - brandName: ""（待 LLM 完成后 UPDATE）
 * - productLines: confirmed=[] / unverified=[]（待 UPDATE）
 * - 其余字段 = 空数组/null
 *
 * 设计理由：createDraft 签名约束 OnboardingSuggestion 完整形状，placeholder 用合法最小形状避免改签名。
 */
function emptySuggestionPayload(args: {
	brandId: string;
	website: string;
	additionalDomains: string[];
}): OnboardingSuggestion {
	return {
		brandName: "",
		website: args.website,
		additionalDomains: args.additionalDomains,
		aliases: [],
		competitors: [],
		suggestedPrompts: [],
		summary: "",
		description: "",
		productLines: { confirmed: [], unverified: [] },
	};
}

/**
 * triggerResearch — POST /api/v1/brands/{id}/research 的服务层入口
 *
 * 流程：
 * 1. createDraft（partial unique 23505 catch → existed）
 * 2. existed + researchStatus in (queued, running) → 跳过 enqueue（防重 job）→ 直接返 {draftId, alreadyExisted: true, jobSkipped: true}
 * 3. existed + researchStatus in (done, failed) → 正常走（重跑场景，partial unique 不约束终态，新建空 payload 后 enqueue）
 * 4. 不 existed → createDraft 新建 queued → enqueue
 *
 * 返回 < 100ms（仅 DB 写入 + pg-boss send = 不阻塞）
 */
export async function triggerResearch(args: {
	brandId: string;
	website: string;
	additionalDomains?: string[];
	maxCompetitors?: number;
	maxPrompts?: number;
	maxProducts?: number;
	crawledPageTexts?: Map<string, string>;
}): Promise<{ draftId: string; alreadyExisted: boolean; jobSkipped: boolean }> {
	const { brandId, website } = args;
	const additionalDomains = args.additionalDomains ?? [];
	// 查 brand 存在性（404 守卫 — FK CASCADE 不影响端点层）
	const brandRow = await db.query.brands.findFirst({
		where: eq(brands.id, brandId),
		columns: { id: true },
	});
	if (!brandRow) {
		throw new BrandNotFoundError(brandId);
	}

	// createDraft 内部已含 idempotency（partial unique 23505 catch）
	const createResult = await createDraft({
		brandId,
		website,
		payload: emptySuggestionPayload({ brandId, website, additionalDomains }),
	});

	// existed + 还在跑 → 跳过 enqueue
	if (createResult.alreadyExisted) {
		const existing = await getDraftById(createResult.id);
		if (existing && (existing.researchStatus === "queued" || existing.researchStatus === "running")) {
			return {
				draftId: createResult.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}
		// existed 但 done/failed → 走重跑流程：清失败行 + 新建（deleteFailedOrExpiredForHash 包含 done？V1 不清 done — done 是历史归档）
		// V1 简化：existed 且 done/failed → 仅返 alreadyExisted（前端用现有 payload 重新跑 triggerResearch 会建新空 payload draft）
		return {
			draftId: createResult.id,
			alreadyExisted: true,
			jobSkipped: false, // 不阻塞，trigger 端会走 setTimeout 重发（V1.1 优化）
		};
	}

	// enqueue pg-boss job
	const boss = await getBoss();
	await boss.send(ANALYZE_BRAND_RESEARCH_QUEUE, {
		draftId: createResult.id,
		brandId,
		website,
		additionalDomains,
		input: {
			maxCompetitors: args.maxCompetitors,
			maxPrompts: args.maxPrompts,
			maxProducts: args.maxProducts,
			crawledPageTexts: args.crawledPageTexts ? Array.from(args.crawledPageTexts.entries()) : undefined,
		},
	});

	return { draftId: createResult.id, alreadyExisted: false, jobSkipped: false };
}

// =============================================================================
// Epic A-2 M2×M3 对接: updateDraftPayload — PATCH /drafts/{id} payload 编辑回写
// confirm 灌库读 draft.payload（单一真源）→ 前端 review 编辑必须回写 payload。
// 语义：缺失字段保留原值；仅 pending_review 可编辑（409 其他态）。
// =============================================================================

export interface DraftPayloadSku {
	name: string;
	model?: string;
	oneLiner: string;
	evidenceUrl: string;
}

export interface DraftPayloadLine {
	name: string;
	skus: DraftPayloadSku[];
}

/** PATCH body（路由 zod 消费）— 与 OnboardingSuggestion 部分字段对齐（productLines 只收 confirmed 结构） */
export interface DraftPayloadPatch {
	summary?: string;
	description?: string;
	aliases?: string[];
	additionalDomains?: string[];
	competitors?: { name: string; domains?: string[]; aliases?: string[] }[];
	prompts?: { prompt: string; tags?: string[] }[];
	productLines?: { line: DraftPayloadLine; evidence?: number }[];
}

/**
 * 纯 merge：把 PATCH 部分字段应用到原 payload（Record 级浅合并 + key 映射）。
 * - prompts → suggestedPrompts（payload 存储键名）
 * - productLines → { confirmed: 传入行, unverified: 保留原值 }（unverified 是 LLM 证据不足行，编辑不触碰）
 * - 其余字段存在即替换，缺失保留原值
 */
export function applyDraftPayloadPatch(
	prev: Record<string, unknown>,
	patch: DraftPayloadPatch,
): Record<string, unknown> {
	const next = { ...prev };
	if (patch.summary !== undefined) next.summary = patch.summary;
	if (patch.description !== undefined) next.description = patch.description;
	if (patch.aliases !== undefined) next.aliases = patch.aliases;
	if (patch.additionalDomains !== undefined) next.additionalDomains = patch.additionalDomains;
	if (patch.competitors !== undefined) {
		next.competitors = patch.competitors.map((c) => ({
			name: c.name,
			domains: c.domains ?? [],
			aliases: c.aliases ?? [],
		}));
	}
	if (patch.prompts !== undefined) {
		next.suggestedPrompts = patch.prompts.map((p) => ({
			prompt: p.prompt,
			tags: p.tags ?? [],
		}));
	}
	if (patch.productLines !== undefined) {
		const prevProductLines = prev.productLines as OnboardingSuggestion["productLines"];
		next.productLines = {
			confirmed: patch.productLines.map(({ line, evidence }) => ({
				line,
				sourceEvidenceChecked: evidence ?? 0,
			})),
			unverified: prevProductLines?.unverified ?? [],
		};
	}
	return next;
}

/**
 * 编辑回写：404（不存在）+ 409（非 pending_review）+ payload merge + UPDATE JSONB。
 * 返回 { id, state }（state 恒 pending_review — 编辑不改变状态）
 */
export async function updateDraftPayload(
	draftId: string,
	patch: DraftPayloadPatch,
): Promise<{ id: string; state: string }> {
	const draft = await getDraftById(draftId);
	if (!draft) throw new DraftNotFoundError(draftId);
	if (draft.state !== "pending_review") throw new DraftConflictError(draftId, draft.state);

	const prev = (draft.payload ?? {}) as Record<string, unknown>;
	const next = applyDraftPayloadPatch(prev, patch);
	await db
		.update(draftResearch)
		.set({ payload: next as never, updatedAt: new Date() })
		.where(eq(draftResearch.id, draftId));

	return { id: draftId, state: "pending_review" };
}
