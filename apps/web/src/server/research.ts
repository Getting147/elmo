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
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
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

// 记录目标草稿与其已确立的直接后继草稿映射（针对 A 的重复请求固定返回 B，不随后续链条推进漂移，解决 V04）
const successorByTargetId = new Map<string, string>();

// 记录胜者 CAS 成功但尚未完成 INSERT 期间预分配的后继草稿 ID（解决 V01 并发交错窗口）
const pendingSuccessorByTargetId = new Map<string, string>();

async function createAndEnqueueDraft(options: {
	draftId?: string;
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
	const newDraftId = options.draftId ?? `dres_${randomUUID()}`;
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

	let draftInserted = false;
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
		draftInserted = true;
	} catch (err: unknown) {
		// 并发请求防重：捕获 partial unique 冲突（多个标签页/并发连击同时插入）
		const pgCause = (err as { cause?: { code?: string } })?.cause;
		const isUniqueViolation =
			(err as { code?: string })?.code === "23505" ||
			pgCause?.code === "23505" ||
			String(pgCause).includes("unique") ||
			String(pgCause).includes("duplicate") ||
			String(err).includes("unique") ||
			String(err).includes("duplicate");

		if (isUniqueViolation) {
			for (let attempt = 0; attempt < 5; attempt++) {
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
				await new Promise((r) => setTimeout(r, 20));
			}
		}
		throw err;
	}

	try {
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
	} catch (err) {
		// V02 修复：若数据库已插入新草稿但入队失败，必须将其置为 rolled_back/failed，释放 partial unique 索引，
		// 防止残留 queued/0-job 草稿，并使前序草稿能够成功补偿恢复而不发生 23505 冲突！
		if (draftInserted) {
			try {
				await db
					.update(draftResearch)
					.set({
						state: "rolled_back",
						researchStatus: "failed",
						error: `队列入队失败: ${err instanceof Error ? err.message : String(err)}`,
						updatedAt: new Date(),
					})
					.where(eq(draftResearch.id, newDraftId));
			} catch (rollbackErr) {
				console.error("[triggerResearch] Failed to rollback un-enqueued draft:", rollbackErr);
			}
		}
		throw err;
	}

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
	targetDraftId?: string;
}): Promise<{ draftId: string; alreadyExisted: boolean; jobSkipped: boolean }> {
	const { brandId, website, retry, targetDraftId } = args;
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

	// V03 修复：前置目标归属校验。若显式指定 targetDraftId，必须在写库/入队前核实其属于当前 brandId 和 urlHash
	let targetDraft: typeof draftResearch.$inferSelect | null = null;
	if (targetDraftId) {
		targetDraft =
			(await db.query.draftResearch.findFirst({
				where: and(
					eq(draftResearch.id, targetDraftId),
					eq(draftResearch.brandId, brandId),
					eq(draftResearch.urlHash, urlHash),
				),
			})) ?? null;

		if (!targetDraft) {
			throw new Error(
				`Target draft ${targetDraftId} not found or does not belong to brand ${brandId} for website ${website}`,
			);
		}

		// V04 修复：针对已验证 targetDraftId，检查是否已有确立的直接后继（不随链条推进漂移）
		const establishedSuccessorId = successorByTargetId.get(targetDraftId);
		if (establishedSuccessorId) {
			const existingSuccessor = await db.query.draftResearch.findFirst({
				where: eq(draftResearch.id, establishedSuccessorId),
			});
			if (existingSuccessor) {
				return {
					draftId: existingSuccessor.id,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}
			successorByTargetId.delete(targetDraftId);
		}

		// 检查是否有并发正在生成的后继（V01 窗口保护）
		const pendingId = pendingSuccessorByTargetId.get(targetDraftId);
		if (pendingId) {
			return {
				draftId: pendingId,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}
	}

	// 查当前活跃草稿（pending_review / confirmed 态）
	const existingActive = await db.query.draftResearch.findFirst({
		where: and(
			eq(draftResearch.brandId, brandId),
			eq(draftResearch.urlHash, urlHash),
			inArray(draftResearch.state, ["pending_review", "confirmed"]),
		),
	});

	if (existingActive) {
		// 若请求指定了 targetDraftId，且现有活跃草稿已是该目标的后继任务，直接复用返回同一后继
		if (
			targetDraftId &&
			targetDraftId !== existingActive.id &&
			(existingActive.payload as { metadata?: { supersedesDraftId?: string } })?.metadata?.supersedesDraftId ===
				targetDraftId
		) {
			return {
				draftId: existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// 若显式指定 targetDraftId 且该目标不是现有活跃草稿（例如重试前序已作废/失败的草稿）：
		// 此时已有 active 草稿占用，绝不能并发发起新的调研，直接返回 existingActive 保护状态一致性（见 V02 followup）
		if (targetDraftId && targetDraftId !== existingActive.id) {
			return {
				draftId: existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

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

		// 3. 在途排队任务防重（U01 修复）：
		// 若当前草稿本身已是一次重试的后继草稿且处于 queued 状态，严格视为在途任务等待执行，绝对不重复入队
		const isAlreadySuccessor = Boolean(
			(existingActive.payload as { metadata?: { supersedesDraftId?: string } })?.metadata?.supersedesDraftId,
		);
		if (existingActive.researchStatus === "queued" && isAlreadySuccessor) {
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

		// 6. retry === true：用户显式授权重试（应对明确失败或旧排队超时无执行方恢复）
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
			// CAS 匹配 0 行：说明 worker 抢占或另一并发重试已更改状态
			// V01 修复：先检查是否有胜者正在创建的后继草稿（交错暂停窗口）
			const pendingWinnerId =
				pendingSuccessorByTargetId.get(existingActive.id) ||
				(targetDraftId ? pendingSuccessorByTargetId.get(targetDraftId) : undefined);
			if (pendingWinnerId) {
				return {
					draftId: pendingWinnerId,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}

			// 检查是否有已确立的胜者后继
			const establishedWinnerId =
				successorByTargetId.get(existingActive.id) ||
				(targetDraftId ? successorByTargetId.get(targetDraftId) : undefined);
			if (establishedWinnerId) {
				return {
					draftId: establishedWinnerId,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}

			const freshOld = await db.query.draftResearch.findFirst({
				where: eq(draftResearch.id, existingActive.id),
			});

			// U02 修复：若原草稿已被并发请求置为 rolled_back，表明另一重试已胜出并建立了新后继任务
			// 必须查询并返回胜者创建的后继活跃草稿，而不是返回作废的旧草稿！
			if (freshOld?.state === "rolled_back") {
				const winnerSuccessor = await db.query.draftResearch.findFirst({
					where: and(
						eq(draftResearch.brandId, brandId),
						eq(draftResearch.urlHash, urlHash),
						inArray(draftResearch.state, ["pending_review", "confirmed"]),
					),
				});
				if (winnerSuccessor) {
					return {
						draftId: winnerSuccessor.id,
						alreadyExisted: true,
						jobSkipped: true,
					};
				}
				// 若处于交错窗口，依然尝试读取挂起后继
				const latePendingId =
					pendingSuccessorByTargetId.get(existingActive.id) ||
					(targetDraftId ? pendingSuccessorByTargetId.get(targetDraftId) : undefined);
				if (latePendingId) {
					return {
						draftId: latePendingId,
						alreadyExisted: true,
						jobSkipped: true,
					};
				}
			}
			return {
				draftId: freshOld?.id ?? existingActive.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// CAS 成功（当前请求是胜者）：
		// 预分配新草稿 ID 并登记到 pendingSuccessorByTargetId（关闭 V01 交错窗口）
		const preAllocatedId = `dres_${randomUUID()}`;
		pendingSuccessorByTargetId.set(existingActive.id, preAllocatedId);
		if (targetDraftId) {
			pendingSuccessorByTargetId.set(targetDraftId, preAllocatedId);
		}

		// 创建继承旧草稿 ID 的后继草稿并入队
		// U04 & V02 修复：原子一致性保护 — 若后继草稿创建或入队失败，双向补偿回滚！
		try {
			const res = await createAndEnqueueDraft({
				draftId: preAllocatedId,
				brandId,
				website,
				additionalDomains,
				supersedesDraftId: existingActive.id,
				maxCompetitors: args.maxCompetitors,
				maxPrompts: args.maxPrompts,
				maxProducts: args.maxProducts,
				crawledPageTexts: args.crawledPageTexts,
			});
			// 确立后继映射并清除挂起
			successorByTargetId.set(existingActive.id, res.draftId);
			if (targetDraftId) {
				successorByTargetId.set(targetDraftId, res.draftId);
			}
			pendingSuccessorByTargetId.delete(existingActive.id);
			if (targetDraftId) {
				pendingSuccessorByTargetId.delete(targetDraftId);
			}
			return res;
		} catch (err) {
			pendingSuccessorByTargetId.delete(existingActive.id);
			if (targetDraftId) {
				pendingSuccessorByTargetId.delete(targetDraftId);
			}
			// 补偿恢复旧草稿的原始状态与时间
			await db
				.update(draftResearch)
				.set({
					state: existingActive.state,
					researchStatus: existingActive.researchStatus,
					error: existingActive.error,
					updatedAt: existingActive.updatedAt,
				})
				.where(eq(draftResearch.id, existingActive.id));
			throw err;
		}
	}

	// 7. 不存在活跃草稿（可能初次触发，或已有草稿已处于终态 failed / rolled_back）：
	if (!retry) {
		return await createAndEnqueueDraft({
			brandId,
			website,
			additionalDomains,
			maxCompetitors: args.maxCompetitors,
			maxPrompts: args.maxPrompts,
			maxProducts: args.maxProducts,
			crawledPageTexts: args.crawledPageTexts,
		});
	}

	// 显式重试 (retry === true)：查找要恢复的目标草稿
	const effectiveTargetDraft =
		targetDraft ??
		(await db.query.draftResearch.findFirst({
			where: and(eq(draftResearch.brandId, brandId), eq(draftResearch.urlHash, urlHash)),
			orderBy: [desc(draftResearch.createdAt)],
		}));

	if (
		effectiveTargetDraft &&
		(effectiveTargetDraft.state === "failed" ||
			effectiveTargetDraft.researchStatus === "failed" ||
			effectiveTargetDraft.state === "rolled_back")
	) {
		// V04: 针对该目标的直接后继检查
		const establishedSuccessorId = successorByTargetId.get(effectiveTargetDraft.id);
		if (establishedSuccessorId) {
			const existingSuccessor = await db.query.draftResearch.findFirst({
				where: eq(draftResearch.id, establishedSuccessorId),
			});
			if (existingSuccessor) {
				return {
					draftId: existingSuccessor.id,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}
		}

		// U03 修复：检查该失败草稿是否已经存在更晚创建的后继草稿
		const existingSuccessor = await db.query.draftResearch.findFirst({
			where: and(
				eq(draftResearch.brandId, brandId),
				eq(draftResearch.urlHash, urlHash),
				gte(draftResearch.createdAt, new Date(new Date(effectiveTargetDraft.createdAt).getTime() + 1)),
			),
			orderBy: [desc(draftResearch.createdAt)],
		});

		if (existingSuccessor) {
			// 若当前请求未明确指定针对新后继草稿发起重试（targetDraftId !== existingSuccessor.id），
			// 则此请求属于针对前序草稿的重复/迟到重试，严禁自动级联发起下一轮，直接返回已有后继草稿！
			if (!targetDraftId || targetDraftId !== existingSuccessor.id) {
				return {
					draftId: existingSuccessor.id,
					alreadyExisted: true,
					jobSkipped: true,
				};
			}
		}

		// 若最新草稿本身是一次重试生成的后继草稿，且请求未显式指定针对它发起重试
		const isLatestSuccessor = Boolean(
			(effectiveTargetDraft.payload as { metadata?: { supersedesDraftId?: string } })?.metadata?.supersedesDraftId,
		);
		if (isLatestSuccessor && (!targetDraftId || targetDraftId !== effectiveTargetDraft.id)) {
			return {
				draftId: effectiveTargetDraft.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		// 若指定了 targetDraftId 但与最新草稿不符，且最新草稿正是其后继，直接复用返回同一后继
		if (
			targetDraftId &&
			targetDraftId !== effectiveTargetDraft.id &&
			(effectiveTargetDraft.payload as { metadata?: { supersedesDraftId?: string } })?.metadata?.supersedesDraftId ===
				targetDraftId
		) {
			return {
				draftId: effectiveTargetDraft.id,
				alreadyExisted: true,
				jobSkipped: true,
			};
		}

		const preAllocatedId = `dres_${randomUUID()}`;
		pendingSuccessorByTargetId.set(effectiveTargetDraft.id, preAllocatedId);
		if (targetDraftId) {
			pendingSuccessorByTargetId.set(targetDraftId, preAllocatedId);
		}

		try {
			const res = await createAndEnqueueDraft({
				draftId: preAllocatedId,
				brandId,
				website,
				additionalDomains,
				supersedesDraftId: existingSuccessor ? existingSuccessor.id : effectiveTargetDraft.id,
				maxCompetitors: args.maxCompetitors,
				maxPrompts: args.maxPrompts,
				maxProducts: args.maxProducts,
				crawledPageTexts: args.crawledPageTexts,
			});
			successorByTargetId.set(effectiveTargetDraft.id, res.draftId);
			if (targetDraftId) {
				successorByTargetId.set(targetDraftId, res.draftId);
			}
			pendingSuccessorByTargetId.delete(effectiveTargetDraft.id);
			if (targetDraftId) {
				pendingSuccessorByTargetId.delete(targetDraftId);
			}
			return res;
		} catch (err) {
			pendingSuccessorByTargetId.delete(effectiveTargetDraft.id);
			if (targetDraftId) {
				pendingSuccessorByTargetId.delete(targetDraftId);
			}
			throw err;
		}
	}

	return await createAndEnqueueDraft({
		brandId,
		website,
		additionalDomains,
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
