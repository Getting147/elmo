import { z } from "zod";

export const baselineRunStatusSchema = z.object({
	run_id: z.string().min(1),
	status: z.enum(["queued", "running", "completed", "partial", "failed", "interrupted"]),
	current_step: z.string(),
	total_questions: z.number().int().nonnegative(),
	completed_questions: z.number().int().nonnegative(),
	mode: z.enum(["synthetic", "real"]),
	error_message: z.string().nullable().optional(),
	error_category: z.string().nullable().optional(),
});

export type BaselineRunStatus = z.infer<typeof baselineRunStatusSchema>;

export function isDiagnosisInProgress(run: BaselineRunStatus): boolean {
	if (
		["failed", "interrupted"].includes(run.status) ||
		["analysis_failed", "report_render_failed"].includes(run.current_step)
	)
		return false;
	return (
		run.status === "queued" ||
		run.status === "running" ||
		["collecting", "analyzing", "rendering_report"].includes(run.current_step)
	);
}

export function diagnosisStatusText(run: BaselineRunStatus | null): { title: string; description: string } {
	if (!run)
		return {
			title: "尚未开始豆包诊断",
			description: "品牌建档已完成。核对现有问题并确认本次执行后，才会开始诊断；浏览或刷新页面不会启动任务。",
		};
	if (
		["failed", "interrupted"].includes(run.status) ||
		["analysis_failed", "report_render_failed"].includes(run.current_step)
	) {
		return {
			title: run.status === "interrupted" ? "豆包诊断已中断" : "豆包诊断未完成",
			description:
				run.error_message || run.error_category || "请进入诊断流程查看本次任务详情，确认原因后再决定下一步。",
		};
	}
	if (isDiagnosisInProgress(run)) {
		const title =
			run.status === "queued"
				? "豆包诊断已排队"
				: run.current_step === "analyzing"
					? "诊断分析进行中"
					: run.current_step === "rendering_report"
						? "诊断报告生成中"
						: "豆包诊断进行中";
		return {
			title,
			description: `本次已完成 ${run.completed_questions} / ${run.total_questions} 题。查看任务进度与后续处理，刷新不会重复执行。`,
		};
	}
	if (run.status === "partial")
		return {
			title: "豆包诊断部分完成",
			description: "已有部分结果，请进入诊断流程查看有效题目及未完成原因。不会自动重新采集。",
		};
	return {
		title: "豆包诊断已完成",
		description: "请进入诊断流程查看本次结果、分析及报告。历史看板暂无数据不影响查看这次诊断。",
	};
}
