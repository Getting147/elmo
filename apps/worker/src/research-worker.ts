/**
 * BUG-001 / B02: 专属品牌调研执行方 (Research Worker)
 *
 * 核心设计约束（依据任务书 03_B02 第 3.1 节）：
 * 1. 最小执行接线：仅处理 analyze-brand-research 队列任务；
 * 2. 严禁自动采集：绝对不创建或调度 schedule-maintenance，绝对不注册 process-prompt；
 * 3. 优雅停机：捕获 SIGINT / SIGTERM，安全关闭 pg-boss 连接。
 */
import boss from "./boss";
import { type ProcessResearchJobData, processResearchJob } from "./jobs/process-research";

const QUEUE_NAME = "analyze-brand-research";

export const WORKER_START_TIME = new Date();
process.env.RESEARCH_WORKER_STARTED_AT = WORKER_START_TIME.toISOString();

async function main() {
	console.log(`[research-worker] Starting dedicated research worker (startedAt: ${WORKER_START_TIME.toISOString()})...`);

	boss.on("error", (error) => {
		console.error("[research-worker] pg-boss error:", error);
	});

	await boss.start();
	console.log("[research-worker] pg-boss started");

	// 仅创建 analyze-brand-research 队列
	await boss.createQueue(QUEUE_NAME, {
		retryLimit: 0,
		retryDelay: 0,
		retryBackoff: false,
		expireInSeconds: 60 * 15,
	});

	// 仅注册 analyze-brand-research 处理函数（单并发顺序执行，避免重入）
	await boss.work<ProcessResearchJobData>(QUEUE_NAME, { batchSize: 1, localConcurrency: 1 }, processResearchJob);
	console.log(`[research-worker] Handler registered for "${QUEUE_NAME}". Ready and listening for research jobs.`);
}

const shutdown = async (signal: string) => {
	console.log(`\n[research-worker] Received ${signal}, shutting down...`);
	try {
		await boss.stop({ graceful: true, timeout: 5000 });
		console.log("[research-worker] pg-boss stopped cleanly");
	} catch (e) {
		console.error("[research-worker] Error stopping pg-boss:", e);
	}
	process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
	console.error("[research-worker] Fatal error:", err);
	process.exit(1);
});
