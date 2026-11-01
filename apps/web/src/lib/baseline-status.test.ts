import { describe, expect, it } from "vitest";
import {
	baselineRunStatusSchema,
	diagnosisAnalysisFormStatus,
	diagnosisStatusText,
	isBaselineRunActive,
	isDiagnosisInProgress,
} from "./baseline-status";
import { formatDiagnosticTaskName } from "./baseline-task-name";

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
	it("keeps the run time through schema validation so every page names the run alike", () => {
		const parsed = baselineRunStatusSchema.parse({
			...run,
			run_id: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			created_at: "2026-11-01T08:00:00+00:00",
			completed_at: "2026-11-01T09:30:00+00:00",
		});
		const overviewName = formatDiagnosticTaskName({
			brandName: "美的",
			runId: parsed.run_id,
			createdAt: parsed.created_at,
			completedAt: parsed.completed_at,
		});
		expect(overviewName).toBe("美的｜2026-11-01 16:00（北京时间）｜批次608dd03e");
		const reportName = formatDiagnosticTaskName({
			brandName: "美的",
			runId: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			createdAt: "2026-11-01T08:00:00+00:00",
		});
		expect(overviewName).toBe(reportName);
	});
	it("falls back to completed_at when only completion time is known", () => {
		const parsed = baselineRunStatusSchema.parse({ ...run, completed_at: "2026-11-01T02:30:00Z" });
		expect(
			formatDiagnosticTaskName({
				brandName: "美的",
				runId: "run_abc12345",
				createdAt: parsed.created_at,
				completedAt: parsed.completed_at,
			}),
		).toBe("美的｜2026-11-01 10:30（北京时间）｜批次abc12345");
	});
	it.each([
		["missing", {}],
		["null", { created_at: null, completed_at: null }],
		["unparseable text", { created_at: "not-a-date" }],
		["wrong type", { created_at: 1730448000, completed_at: { at: "2026-11-01" } }],
	])("an old task with %s time still loads and shows time unknown", (_label, times) => {
		const parsed = baselineRunStatusSchema.parse({ ...run, ...times });
		expect(parsed.status).toBe("running");
		expect(
			formatDiagnosticTaskName({
				brandName: "美的",
				runId: "run_abc12345",
				createdAt: parsed.created_at,
				completedAt: parsed.completed_at,
			}),
		).toBe("美的｜时间未知｜批次abc12345");
	});
	it("time tolerance does not relax status validation", () => {
		expect(() =>
			baselineRunStatusSchema.parse({ ...run, status: "unknown", created_at: "2026-11-01T08:00:00Z" }),
		).toThrow();
		expect(() => baselineRunStatusSchema.parse({ ...run, mode: "production", created_at: null })).toThrow();
	});
	it("ready_for_review is not active even if a stale status says running", () => {
		expect(isBaselineRunActive({ status: "running", current_step: "ready_for_review" })).toBe(false);
		expect(isBaselineRunActive({ status: "running", current_step: "rendering_report" })).toBe(true);
	});
});

describe("analysis form follows the actual analysis state", () => {
	const status = (value: Parameters<typeof diagnosisAnalysisFormStatus>[0], hasAnalysis = false) =>
		diagnosisAnalysisFormStatus(value, { hasAnalysis });

	it("does not claim generation before the analysis stage starts", () => {
		const collecting = status({ ...run, current_step: "collecting" });
		expect(collecting.phase).toBe("waiting");
		expect(collecting.editable).toBe(false);
		expect(collecting.message).toContain("尚未开始");
		expect(collecting.message).not.toContain("正在自动生成中");
		expect(status({ ...run, current_step: "queued", status: "queued" }).phase).toBe("waiting");
	});
	it("locks the form while the current run is generating analysis", () => {
		const analyzing = status({ ...run, status: "completed", current_step: "analyzing" });
		expect(analyzing.phase).toBe("generating");
		expect(analyzing.editable).toBe(false);
		expect(analyzing.message).toBe("Negency-Agent正在自动生成中，请稍后。");
		const withOldVersion = diagnosisAnalysisFormStatus(
			{ ...run, status: "completed", current_step: "analyzing" },
			{ hasAnalysis: true },
		);
		expect(withOldVersion.phase).toBe("generating");
		expect(withOldVersion.editable).toBe(false);
	});
	it("keeps a saved analysis editable while the report is rendering or failed", () => {
		for (const current_step of ["rendering_report", "report_render_failed"]) {
			const ready = status({ ...run, status: "completed", current_step }, true);
			expect(ready.phase).toBe("ready");
			expect(ready.editable).toBe(true);
		}
	});
	it("reports analysis failure without asking the user to write from scratch", () => {
		const failed = status({
			...run,
			status: "completed",
			current_step: "analysis_failed",
			valid_questions: 9,
		});
		expect(failed.phase).toBe("failed");
		expect(failed.editable).toBe(false);
		expect(failed.message).toContain("重试入口");
		expect(failed.message).toContain("空白代写");
		const stopped = status({ ...run, status: "failed", current_step: "failed" });
		expect(stopped.phase).toBe("failed");
		expect(stopped.message).toContain("已中止");
	});
	it("distinguishes a read failure from an unfinished analysis", () => {
		const unreadable = diagnosisAnalysisFormStatus(
			{ ...run, status: "completed", current_step: "ready_for_review" },
			{ hasAnalysis: false, analysisQueryFailed: true },
		);
		expect(unreadable.phase).toBe("unreadable");
		expect(unreadable.message).toContain("读取失败");
		expect(unreadable.message).not.toContain("正在自动生成中");
		const missing = status({ ...run, status: "completed", current_step: "completed", valid_questions: 9 });
		expect(missing.phase).toBe("missing");
		expect(missing.editable).toBe(false);
	});
	it("keeps unknown states locked and refreshable", () => {
		const unknownRun = diagnosisAnalysisFormStatus(null, { hasAnalysis: false, runQueryFailed: true });
		expect(unknownRun.phase).toBe("unknown");
		expect(unknownRun.message).toContain("任务状态读取失败");
		const loadingRun = diagnosisAnalysisFormStatus(null, { hasAnalysis: false });
		expect(loadingRun.phase).toBe("unknown");
		expect(loadingRun.message).toContain("正在读取");
		const reportFailed = status({ ...run, status: "completed", current_step: "report_render_failed" });
		expect(reportFailed.phase).toBe("unknown");
		expect(reportFailed.message).toContain("报告生成失败");
	});
	it("keeps a previously saved analysis usable after a later analysis failure", () => {
		const saved = diagnosisAnalysisFormStatus(
			{ ...run, status: "completed", current_step: "analysis_failed" },
			{ hasAnalysis: true },
		);
		expect(saved.phase).toBe("ready");
		expect(saved.editable).toBe(true);
		expect(saved.warning).toContain("此前已保存");
	});
});
