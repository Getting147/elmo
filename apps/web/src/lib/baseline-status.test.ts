import { describe, expect, it } from "vitest";
import { baselineRunStatusSchema, diagnosisStatusText, isDiagnosisInProgress } from "./baseline-status";

const run = {
	run_id: "run_test",
	status: "running" as const,
	current_step: "collecting",
	total_questions: 9,
	completed_questions: 2,
	valid_questions: 1,
	failed_questions: 1,
	mode: "synthetic" as const,
};

describe("diagnosis status reflects actual tasks", () => {
	it("no task gives a manual start instruction", () => {
		expect(diagnosisStatusText(null).title).toBe("尚未开始豆包诊断");
		expect(diagnosisStatusText(null).description).toContain("刷新页面不会启动任务");
	});
	it("a running 9-question task reports progress", () => {
		expect(isDiagnosisInProgress(run)).toBe(true);
		expect(diagnosisStatusText(run).description).toContain("2 / 9");
	});
	it("completed collection with analysis in progress remains in progress", () => {
		const analyzing = { ...run, status: "completed" as const, current_step: "analyzing" };
		expect(isDiagnosisInProgress(analyzing)).toBe(true);
		expect(diagnosisStatusText(analyzing).title).toBe("诊断分析进行中");
	});
	it.each(["failed", "interrupted"] as const)("%s does not become perpetual waiting", (status) => {
		const failed = { ...run, status, error_message: "本轮 Mock 采集失败" };
		expect(isDiagnosisInProgress(failed)).toBe(false);
		expect(diagnosisStatusText(failed).description).toContain("本轮 Mock 采集失败");
	});
	it("analysis failure after collection shows its error", () => {
		const failed = {
			...run,
			status: "completed" as const,
			current_step: "analysis_failed",
			error_message: "Mock 分析失败",
		};
		expect(isDiagnosisInProgress(failed)).toBe(false);
		expect(diagnosisStatusText(failed).description).toContain("Mock 分析失败");
	});
	it.each(["completed", "partial"] as const)("%s has a terminal next step without legacy prompt_runs", (status) => {
		const terminal = { ...run, status, current_step: "completed" };
		expect(isDiagnosisInProgress(terminal)).toBe(false);
		expect(diagnosisStatusText(terminal).title).toContain(status === "partial" ? "部分完成" : "采集已结束");
	});
	it("unrecognized task states are rejected instead of inventing success", () => {
		expect(() => baselineRunStatusSchema.parse({ ...run, status: "unknown" })).toThrow();
	});
});
