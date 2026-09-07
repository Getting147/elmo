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
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { brands, draftResearch } from "@workspace/lib/db/schema";
import {
	analyzeBrand,
	type OnboardingSuggestion,
} from "@workspace/lib/onboarding";
import {
	BrandNotFoundError,
	saveWizardOnboarding,
	type WizardOnboardingInput,
} from "@/server/onboarding-core";
import {
	createDraft,
	getDraftById,
	listDraftsByBrand,
	markFailed,
	markRolledBack,
} from "@workspace/lib/onboarding/draft-research";

export class DraftNotFoundError extends Error {
	constructor(public readonly draftId: string) {
		super(`Draft "${draftId}" not found.`);
		this.name = "DraftNotFoundError";
	}
}

export class DraftConflictError extends Error {
	constructor(public readonly draftId: string, public readonly state: string) {
		super(`Draft "${draftId}" is in state "${state}" — cannot perform this action.`);
		this.name = "DraftConflictError";
	}
}

/** PG 23505 unique_violation SQLSTATE */
const PG_UNIQUE_VIOLATION = "23505";

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
			brandId,
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
	return createDraft({
		brandId,
		website,
		payload: suggestion,
	});
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
	// 乐观锁 UPDATE — 0 行 = 409
	const updated = await db
		.update(draftResearch)
		.set({ state: "done", updatedAt: new Date() })
		.where(
			and(
				eq(draftResearch.id, draftId),
				inArray(draftResearch.state, ["pending_review", "confirmed"]),
			),
		)
		.returning({ id: draftResearch.id });

	if (updated.length === 0) {
		// 查实际状态返 409 详细
		const cur = await getDraftById(draftId);
		if (!cur) throw new DraftNotFoundError(draftId);
		throw new DraftConflictError(draftId, cur.state);
	}

	// 查草稿（用于 populate payload）
	const draft = await getDraftById(draftId);
	if (!draft) throw new DraftNotFoundError(draftId); // race: 已被删

	// brand 删守卫（FK CASCADE 后再访问 brand 应 404 — 但草稿 brand_id 已被设）
	const brandRow = await db.query.brands.findFirst({
		where: eq(brands.id, draft.brandId),
		columns: { id: true },
	});
	if (!brandRow) {
		// 422 提示「brand 已被删除」（与契约 F1-10 一致）
		// 把 state 回滚到 pending_review（因乐观锁已成功但 populate 失败）
		await db
			.update(draftResearch)
			.set({ state: "pending_review", updatedAt: new Date() })
			.where(eq(draftResearch.id, draftId));
		throw new Error("brand has been deleted; cannot confirm draft");
	}

	// populate（事务内 — 失败整体回滚）
	try {
		const payload = draft.payload as OnboardingSuggestion;
		const input = convertOnboardingSuggestionToWizardInput({
			brandId: draft.brandId,
			website: payload.website,
			additionalDomains: payload.additionalDomains,
			suggestion: payload,
		});
		await saveWizardOnboarding(input);
	} catch (err) {
		// populate 失败 → 把 state 回滚到 pending_review（事务回滚 + UPDATE 同事务）
		await db
			.update(draftResearch)
			.set({ state: "pending_review", updatedAt: new Date() })
			.where(eq(draftResearch.id, draftId));
		throw err;
	}

	return { id: draftId };
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
