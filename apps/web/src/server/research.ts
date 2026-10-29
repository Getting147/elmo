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

import { randomUUID } from "node:crypto";
import { db } from "@workspace/lib/db/db";
import { brands, draftResearch } from "@workspace/lib/db/schema";
import {
	analyzeBrand,
	computeExpiresAt,
	createDraft,
	getDraftById,
	hashUrlForDraft,
	listDraftsByBrand,
	markFailed,
	markRolledBack,
	type OnboardingSuggestion,
} from "@workspace/lib/onboarding";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
		brandName: suggestion.brandName,
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
async function getPgBossJobState(draftId: string): Promise<string | null> {
	try {
		const res = await db.execute(sql`
			SELECT state FROM pgboss.job
			WHERE name = 'analyze-brand-research' AND data->>'draftId' = ${draftId}
			ORDER BY created_on DESC LIMIT 1
		`);
		return (res.rows[0]?.state as string) ?? null;
	} catch {
		return null;
	}
}

async function createAndEnqueueDraft(options: {
	brandId: string;
	website: string;
	additionalDomains: string[];
	supersedesDraftId?: string;
	maxCompetitors?: number;
	maxPrompts?: number;
	maxProducts?: number;
	crawledPageTexts?: Map<string, string>;
}): Promise<{ draftId: string; alreadyExisted: boolean; jobSkipped: boolean }> {
	const { brandId, website, additionalDomains, supersedesDraftId } = options;
	const urlHash = hashUrlForDraft(website);
	const newDraftId = `dres_${randomUUID()}`;
	const expiresAt = computeExpiresAt();

	const payload: OnboardingSuggestion & { metadata?: Record<string, unknown> } = {
		...emptySuggestionPayload({ brandId, website, additionalDomains }),
		...(supersedesDraftId
			? {
					metadata: {
						supersedesDraftId,
						retryAuthorizedAt: new Date().toISOString(),
					},
				}
			: {}),
	};

	try {
		await db.insert(draftResearch).values({
			id: newDraftId,
			brandId,
			urlHash,
			state: "pending_review",
			researchStatus: "queued",
			payload: payload as never,
			createdAt: new Date(),
			updatedAt: new Date(),
			expiresAt,
		});
	} catch (err: unknown) {
		// 并发请求防重：捕获 partial unique 冲突（多个标签页/并发连击同时插入）
		const isUniqueViolation =
			(err as { code?: string })?.code === "23505" ||
			String(err).includes("unique") ||
			String(err).includes("duplicate");

		if (isUniqueViolation) {
			const activeDraft = await db.query.draftResearch.findFirst({
				where: and(
					eq(draftResearch.brandId, brandId),
					eq(draftResearch.urlHash, urlHash),
					inArray(draftResearch.state, ["pending_review", "confirmed"]),
				),
			});
			if (activeDraft) {
				return {
					draftId: activeDraft.id,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}
		}
		throw err;
	}

	// enqueue pg-boss job
	const boss = await getBoss();
	await boss.send(ANALYZE_BRAND_RESEARCH_QUEUE, {
		draftId: newDraftId,
		brandId,
		website,
		additionalDomains,
		input: {
			maxCompetitors: options.maxCompetitors,
			maxPrompts: options.maxPrompts,
			maxProducts: options.maxProducts,
			crawledPageTexts: options.crawledPageTexts ? Array.from(options.crawledPageTexts.entries()) : undefined,
		},
	});

	return { draftId: newDraftId, alreadyExisted: false, jobSkipped: false };
}

export async function triggerResearch(args: {
	brandId: string;
	website: string;
	additionalDomains?: string[];
	maxCompetitors?: number;
	maxPrompts?: number;
	maxProducts?: number;
	crawledPageTexts?: Map<string, string>;
	retry?: boolean;
}): Promise<{ draftId: string; alreadyExisted: boolean; jobSkipped: boolean }> {
	const { brandId, website, retry } = args;
	const additionalDomains = args.additionalDomains ?? [];
	// 查 brand 存在性（404 守卫 — FK CASCADE 不影响端点层）
	const brandRow = await db.query.brands.findFirst({
		where: eq(brands.id, brandId),
		columns: { id: true },
	});
	if (!brandRow) {
		throw new BrandNotFoundError(brandId);
	}

	const urlHash = hashUrlForDraft(website);

	// 查当前活跃草稿（pending_review / confirmed 态）
	const existingActive = await db.query.draftResearch.findFirst({
		where: and(
			eq(draftResearch.brandId, brandId),
			eq(draftResearch.urlHash, urlHash),
			inArray(draftResearch.state, ["pending_review", "confirmed"]),
		),
	});

	if (existingActive) {
		// 1. 已完成待审核：调研结果已存在，绝不重复调用模型
		if (existingActive.researchStatus === "done" || existingActive.state === "confirmed") {
			return {
				draftId: existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// 2. 正在执行 (running) 或执行情况未知：
		// 去掉“超过 5 分钟就确认旧执行已结束”的推断。先核对 pg-boss 实际状态。
		// 只要旧任务仍在 running 或未知（无明确失败/取消确认），严禁重置重发，恢复前端查询，等待后台安全落盘！
		if (existingActive.researchStatus === "running") {
			const pgBossState = await getPgBossJobState(existingActive.id);
			const isConfirmedTerminated = pgBossState === "failed" || pgBossState === "cancelled";

			if (!isConfirmedTerminated) {
				// 后台任务尚未结束：绝对不重复入队，不调用模型
				return {
					draftId: existingActive.id,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}

			// 若 pg-boss 已明确确认任务异常退出或取消，同步记录为 failed，允许后续走明确失败恢复
			await db
				.update(draftResearch)
				.set({
					researchStatus: "failed",
					error: `执行方任务已终止 (${pgBossState})`,
					updatedAt: new Date(),
				})
				.where(eq(draftResearch.id, existingActive.id));
			existingActive.researchStatus = "failed";
		}

		// 3. 防连续点击 / 在途排队防重复：
		// 若已有草稿处于 queued 且创建未满 60 秒（任务正等待 worker 拾取），
		// 无论是否 retry，一律跳过重复入队，受理同一次请求
		const isRecentlyQueued =
			existingActive.researchStatus === "queued" && Date.now() - new Date(existingActive.createdAt).getTime() < 60_000;
		if (isRecentlyQueued) {
			return {
				draftId: existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// 4. 未显式要求 retry 的情况（刷新、重进、查询、排队中或明确失败展示）：
		// 保护当前草稿不被重复投递
		if (!retry) {
			return {
				draftId: existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// 5. retry === true：用户显式授权重试（应对明确失败或旧排队超时无执行方恢复）
		// 原子 CAS 更新：仅在旧草稿状态仍为读取快照时才执行作废
		// 防止并发竞态（如后台 worker 刚抢占由 queued 变为 running，见 T06）
		const updatedOld = await db
			.update(draftResearch)
			.set({
				state: "rolled_back",
				researchStatus: "failed",
				error: existingActive.error
					? `${existingActive.error} (superseded_by_retry)`
					: "已由用户人工重试取代 (superseded_by_retry)",
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(draftResearch.id, existingActive.id),
					eq(draftResearch.researchStatus, existingActive.researchStatus),
					eq(draftResearch.state, existingActive.state),
				),
			)
			.returning({ id: draftResearch.id });

		if (updatedOld.length === 0) {
			// CAS 匹配 0 行：说明 worker 抢占或另一请求已更改状态，不发起第二次重试
			const fresh = await db.query.draftResearch.findFirst({
				where: eq(draftResearch.id, existingActive.id),
			});
			return {
				draftId: fresh?.id ?? existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// CAS 成功，创建继承旧草稿 ID 的后继草稿并入队
		return await createAndEnqueueDraft({
			brandId,
			website,
			additionalDomains,
			supersedesDraftId: existingActive.id,
			maxCompetitors: args.maxCompetitors,
			maxPrompts: args.maxPrompts,
			maxProducts: args.maxProducts,
			crawledPageTexts: args.crawledPageTexts,
		});
	}

	// 6. 不存在活跃草稿（可能初次触发，或已有草稿已处于终态 failed / rolled_back）：
	let supersedesDraftId: string | undefined;

	if (retry) {
		// T05: 显式重试时，查找最近的历史失败草稿（state = 'failed' 或 researchStatus = 'failed'）以建立重试链路
		const latestHistory = await db.query.draftResearch.findFirst({
			where: and(eq(draftResearch.brandId, brandId), eq(draftResearch.urlHash, urlHash)),
			orderBy: [desc(draftResearch.createdAt)],
		});
		if (latestHistory && (latestHistory.state === "failed" || latestHistory.researchStatus === "failed")) {
			supersedesDraftId = latestHistory.id;
		}
	}

	return await createAndEnqueueDraft({
		brandId,
		website,
		additionalDomains,
		supersedesDraftId,
		maxCompetitors: args.maxCompetitors,
		maxPrompts: args.maxPrompts,
		maxProducts: args.maxProducts,
		crawledPageTexts: args.crawledPageTexts,
	});
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
	brandName?: string;
	website?: string;
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
	if (patch.brandName !== undefined) next.brandName = patch.brandName;
	if (patch.website !== undefined) next.website = patch.website;
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
