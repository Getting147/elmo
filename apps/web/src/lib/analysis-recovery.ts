import { isBaselineRunActive, type BaselineRunStatus } from "./baseline-status";

export function analysisRecoveryStatus(
	run: Pick<BaselineRunStatus, "status" | "current_step"> | null | undefined,
	options: { fresh: boolean; readFailed: boolean; hasAnalysis: boolean },
): { phase: "checking" | "unknown" | "running" | "ready" | "failed"; message: string; canRetry: boolean } {
	if (!options.fresh) return { phase: "checking", message: "正在只读核对本次请求的任务状态，请勿重复发起。", canRetry: false };
	if (options.readFailed || !run)
		return { phase: "unknown", message: "暂无法确认本次请求是否完成。请只读刷新状态；不会自动重发，也不代表后台已取消。", canRetry: false };
	if (isBaselineRunActive(run))
		return { phase: "running", message: "后台仍在执行本次任务，请耐心等待；不会重复发起。", canRetry: false };
	if (run.current_step === "analysis_failed")
		return {
			phase: "failed",
			message: options.hasAnalysis ? "已确认最近一次分析失败；当前保留此前可用版本，未保存编辑不受影响。" : "已确认本次分析失败；请核对原因后决定是否手动重试。",
			canRetry: true,
		};
	if (options.hasAnalysis)
		return { phase: "ready", message: "已恢复本任务保存的分析结果；此前请求等待异常不代表分析失败，未保存编辑保留。", canRetry: false };
	return { phase: "unknown", message: "任务状态与分析结果尚未完整确认，请只读刷新；不会自动重发。", canRetry: false };
}
