/**
 * Epic A-2 (V1.0) M2 c3-job: processResearchJob handler
 *
 * 替代原同步 analyzeBrand（30-90s 抓站+LLM 触发网关超时）— 异步 pg-boss 任务
 * 流程：UPDATE research_status='running' → analyzeBrand + validateEvidence（M1）→
 *          UPDATE draft SET payload, research_status='done' / 'failed'
 *
 * 与 triggerResearch 配对：trigger 立即返 draftId，handler 跑 30-90s 后写 payload
 */

import { db } from "@workspace/lib/db/db";
import { draftResearch } from "@workspace/lib/db/schema";
import { analyzeBrand, markFailed } from "@workspace/lib/onboarding";
import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";

export interface ProcessResearchJobData {
	draftId: string;
	brandId: string;
	website: string;
	additionalDomains: string[];
	input?: {
		maxCompetitors?: number;
		maxPrompts?: number;
		maxProducts?: number;
		crawledPageTexts?: Array<[string, string]>; // Map entries serialized
	};
}

/**
 * 异步 LLM 处理草稿 — 完整 happy/sad path。
 *
 * 4 态转移：
 *   1. queued (trigger 写入) → running (本 handler 开始)
 *   2. analyzeBrand + validateEvidence 成功 → payload UPDATE + research_status='done'
 *   3. 任一异常 → markFailed + research_status='failed' + state='failed'
 *   4. state 仍=pending_review（V1 持久化 4 态：confirmed/applied 事务内瞬态；done/failed/rolled_back 持久）
 */
export async function processResearchJob(jobs: Job<ProcessResearchJobData>[]): Promise<void> {
	const [job] = jobs;
	if (!job) {
		throw new Error("process-research handler received an empty batch");
	}
	const { draftId, website, input } = job.data;

	// 1. UPDATE research_status='running'（CAS：仅 queued 态转 running，防重入）
	const claimed = await db
		.update(draftResearch)
		.set({ researchStatus: "running", updatedAt: new Date() })
		.where(and(eq(draftResearch.id, draftId), eq(draftResearch.researchStatus, "queued")))
		.returning({ id: draftResearch.id, createdAt: draftResearch.createdAt });

	if (claimed.length === 0) {
		// 已被其他 worker 抢走（不重新入队）→ 静默退出
		return;
	}

	const draftRecord = claimed[0];

	// 历史遗留任务隔离保护（任务书 3.1 & 验收门槛）：
	// 任何早于执行方启动前生成的任务不得自动消费，不调用模型，保全历史草稿数据不被更改或删除。
	// 处置方案与人工恢复由获准发布方按发布手册统一执行。
	const workerStartTime = process.env.RESEARCH_WORKER_STARTED_AT
		? new Date(process.env.RESEARCH_WORKER_STARTED_AT)
		: new Date();
	const isPreStartup = draftRecord.createdAt && new Date(draftRecord.createdAt) < workerStartTime;
	if (isPreStartup) {
		console.warn(
			`[process-research] 隔离执行方启动前的历史遗留任务 ${draftId} (创建于 ${draftRecord.createdAt} < 启动时间 ${workerStartTime.toISOString()})。按授权边界跳过执行，保持原样，不调用模型。`,
		);
		// 释放 CAS 占位，恢复 queued 态，保证历史数据 100% 物理保全且未被标记 failed
		await db
			.update(draftResearch)
			.set({ researchStatus: "queued" })
			.where(and(eq(draftResearch.id, draftId), eq(draftResearch.researchStatus, "running")));
		return;
	}

	try {
		// 2. analyzeBrand + validateEvidence（m1 evidence 校验）
		const crawledPageTexts = input?.crawledPageTexts ? new Map(input.crawledPageTexts) : new Map<string, string>();

		const suggestion = await analyzeBrand({
			website,
			maxCompetitors: input?.maxCompetitors ?? 10,
			maxPrompts: input?.maxPrompts ?? 30,
			maxProducts: input?.maxProducts ?? 10,
			crawledPageTexts,
			requireLiveWebsite: true,
		});

		// validateEvidence 已经在 analyzeBrand 内调用（M1 集成）— 无需重复

		// 3. UPDATE payload + research_status='done'（CAS：仅 running 态转 done，防重入）
		await db
			.update(draftResearch)
			.set({
				payload: suggestion as never, // OnboardingSuggestion shape
				researchStatus: "done",
				updatedAt: new Date(),
			})
			.where(and(eq(draftResearch.id, draftId), eq(draftResearch.researchStatus, "running")));
	} catch (err) {
		// 4. 异常 → markFailed（state='failed' + research_status='failed' + error 字段）
		const errorMsg = err instanceof Error ? err.message : String(err);
		await db
			.update(draftResearch)
			.set({
				researchStatus: "failed",
				updatedAt: new Date(),
			})
			.where(and(eq(draftResearch.id, draftId), eq(draftResearch.researchStatus, "running")));
		// 同步 state='failed' + error（用现成 helper）
		await markFailed({ id: draftId, error: errorMsg });
	}
}
