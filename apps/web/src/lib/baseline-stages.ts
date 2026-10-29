import type { BaselineRunStatus } from "./baseline-status";

export type DiagnosisStageState = "pending" | "queued" | "running" | "success" | "partial" | "failed" | "blocked";
export type DiagnosisStage = {
	title: string;
	state: DiagnosisStageState;
	description: string;
};

type Artifact = { run_id: string };
type Report = Artifact & { revisions: Array<Artifact & { status: string }> };

export function diagnosisStages(
	run: BaselineRunStatus,
	metrics?: Artifact | null,
	analysis?: Artifact | null,
	report?: Report | null,
): DiagnosisStage[] {
	const step = run.current_step;
	const collectionActive = run.status === "running" && step === "collecting";
	const stopped = run.status === "failed" || run.status === "interrupted";
	const collection: DiagnosisStageState =
		run.status === "queued"
			? "queued"
			: stopped
				? run.valid_questions === run.total_questions && run.total_questions > 0
					? "success"
					: run.valid_questions > 0
						? "partial"
						: "failed"
				: collectionActive
					? "running"
					: run.status === "partial"
						? "partial"
						: run.status === "completed"
							? "success"
							: "pending";
	const noResults = stopped || (!collectionActive && run.status !== "queued" && run.valid_questions === 0);
	const hasMetrics = metrics?.run_id === run.run_id && run.valid_questions > 0;
	const hasAnalysis = analysis?.run_id === run.run_id;
	const revisions = report?.run_id === run.run_id ? report.revisions.filter((r) => r.run_id === run.run_id) : [];
	const readyReport = revisions.some((r) => r.status === "ready");
	const reportFailed = step === "report_render_failed" || revisions.at(-1)?.status === "failed";
	return [
		{
			title: "1. 豆包数据采集",
			state: collection,
			description:
				collection === "failed"
					? "采集未完成，未自动重试"
					: collection === "partial"
						? "保留本轮部分有效结果"
						: collection === "success"
							? "本轮采集已结束"
							: collection === "queued"
								? "等待本次任务执行"
								: collection === "running"
									? "正在采集本轮问题"
									: "尚未开始采集",
		},
		{
			title: "2. A 统计指标核算",
			state: hasMetrics ? "success" : noResults ? "blocked" : "pending",
			description: hasMetrics ? "本轮归档统计可查看" : noResults ? "前置执行已停止，尚无本轮统计" : "尚无本轮统计结果",
		},
		{
			title: "3. DeepSeek 归因诊断",
			state:
				step === "analysis_failed"
					? "failed"
					: step === "analyzing" && !stopped
						? "running"
						: hasAnalysis
							? "success"
							: noResults
								? "blocked"
								: "pending",
			description:
				step === "analysis_failed"
					? "本轮分析失败，未自动重试"
					: step === "analyzing" && !stopped
						? "本轮分析进行中"
						: hasAnalysis
							? "本轮分析草稿已保存"
							: noResults
								? "前置执行未通过，未执行分析"
								: "尚无本轮分析草稿",
		},
		{
			title: "4. 星河国际参考报告",
			state: reportFailed
				? "failed"
				: step === "rendering_report" && !stopped
					? "running"
					: readyReport
						? "success"
						: noResults || step === "analysis_failed"
							? "blocked"
							: "pending",
			description: reportFailed
				? "本轮报告生成失败，未自动重试"
				: step === "rendering_report" && !stopped
					? "本轮报告生成中"
					: readyReport
						? "本轮报告草稿可查看"
						: noResults || step === "analysis_failed"
							? "前置阶段未通过，未生成报告"
							: "尚无本轮报告草稿",
		},
	];
}
