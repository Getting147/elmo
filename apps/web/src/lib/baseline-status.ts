import { z } from "zod";

export const baselineRunStatusSchema = z.object({
	run_id: z.string().min(1),
	status: z.enum(["queued", "running", "completed", "partial", "failed", "interrupted"]),
	current_step: z.string(),
	total_questions: z.number().int().nonnegative(),
	completed_questions: z.number().int().nonnegative(),
	valid_questions: z.number().int().nonnegative(),
	failed_questions: z.number().int().nonnegative(),
	mode: z.enum(["synthetic", "real"]),
	error_message: z.string().nullable().optional(),
	error_category: z.string().nullable().optional(),
});

export type BaselineRunStatus = z.infer<typeof baselineRunStatusSchema>;

export function diagnosisCountText(run: BaselineRunStatus): string {
	return `已尝试 ${run.completed_questions} / ${run.total_questions} 题 · 有效 ${run.valid_questions} 题 · 失败 ${run.failed_questions} 题 · 未尝试 ${Math.max(0, run.total_questions - run.completed_questions)} 题`;
}

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
			description: `${run.error_message || run.error_category || "请进入诊断流程查看本次任务详情，确认原因后再决定下一步。"} ${diagnosisCountText(run)}`,
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
			description: `${diagnosisCountText(run)}。查看任务进度与后续处理，刷新不会重复执行。`,
		};
	}
	if (run.status === "partial")
		return {
			title: "豆包诊断部分完成",
			description: `${diagnosisCountText(run)}。请查看有效结果及未完成原因，不会自动重新采集。`,
		};
	return {
		title: run.current_step === "ready_for_review" ? "诊断草稿待审核" : "豆包采集已结束",
		description: `${diagnosisCountText(run)}。请进入诊断流程查看已有结果，分析及报告以本轮保存的产物为准。`,
	};
}

export type QuestionExecutionState = "effective" | "failed" | "unattempted";

export function resolveQuestionExecutionStatus(
	q: {
		code?: string;
		status?: string | null;
		attempts_history?: Array<{ status?: string; is_effective?: boolean; error_message?: string | null }>;
		effective_status?: string | null;
		attempts_count?: number;
		error_message?: string | null;
	},
	zeroEffectiveCodes?: string[],
): QuestionExecutionState {
	const code = q.code;

	// 1. 优先核对后端 sample_summary.zero_effective_questions 权威名单
	if (code && Array.isArray(zeroEffectiveCodes) && zeroEffectiveCodes.includes(code)) {
		const rawStatus = (q.status || "").toLowerCase();
		if (rawStatus === "未尝试" || rawStatus === "unattempted") {
			return "unattempted";
		}
		const hasAttempts =
			(Array.isArray(q.attempts_history) && q.attempts_history.length > 0) ||
			(typeof q.attempts_count === "number" && q.attempts_count > 0);
		if (!hasAttempts && !q.error_message && rawStatus !== "http_error" && rawStatus !== "failed") {
			return "unattempted";
		}
		return "failed";
	}

	// 2. 检查显式成功状态
	const rawStatus = (q.status || "").toLowerCase();
	if (rawStatus === "成功" || rawStatus === "success" || q.effective_status === "effective") {
		return "effective";
	}

	// 3. 检查 attempts_history 中是否有任意成功的有效尝试
	if (Array.isArray(q.attempts_history) && q.attempts_history.length > 0) {
		const hasEffective = q.attempts_history.some(
			(att) => att.is_effective === true || att.status === "success",
		);
		if (hasEffective) {
			return "effective";
		}
		return "failed";
	}

	// 4. 未尝试显式标识
	if (rawStatus === "未尝试" || rawStatus === "unattempted") {
		return "unattempted";
	}

	// 5. 失败显式标识
	if (
		rawStatus === "http_error" ||
		rawStatus === "failed" ||
		rawStatus === "error" ||
		rawStatus === "timeout" ||
		q.effective_status === "ineffective" ||
		Boolean(q.error_message)
	) {
		return "failed";
	}

	// 6. 若显式尝试次数为 0 且无报错，则为未尝试
	if (q.attempts_count === 0) {
		return "unattempted";
	}

	return "unattempted";
}
