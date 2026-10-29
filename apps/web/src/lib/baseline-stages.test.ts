import { describe, expect, it } from "vitest";
import { diagnosisStages } from "./baseline-stages";
import { diagnosisCountText, diagnosisStatusText } from "./baseline-status";

const run = {
	run_id: "run_nine",
	status: "completed" as const,
	current_step: "completed",
	completed_questions: 9,
	total_questions: 9,
	valid_questions: 9,
	failed_questions: 0,
	mode: "synthetic" as const,
};
const artifact = { run_id: run.run_id };
const report = { ...artifact, revisions: [{ ...artifact, status: "ready" }] };
const states = (value: ReturnType<typeof diagnosisStages>) => value.map((s) => s.state);

describe("task stages and counts", () => {
	it("403 is one attempted question and zero useful results, with blocked downstream", () => {
		const failed = {
			...run,
			status: "failed" as const,
			current_step: "failed",
			completed_questions: 1,
			valid_questions: 0,
			failed_questions: 1,
			error_message: "AccountOverdueError",
		};
		expect(states(diagnosisStages(failed))).toEqual(["failed", "blocked", "blocked", "blocked"]);
		expect(diagnosisCountText(failed)).toBe("已尝试 1 / 9 题 · 有效 0 题 · 失败 1 题 · 未尝试 8 题");
		expect(diagnosisStatusText(failed).description).toContain(diagnosisCountText(failed));
	});
	it("collection-only completion never invents downstream success", () => {
		expect(states(diagnosisStages(run, artifact))).toEqual(["success", "success", "pending", "pending"]);
	});
	it("queued and collecting are not success", () => {
		expect(diagnosisStages({ ...run, status: "queued", current_step: "queued", valid_questions: 0 })[0].state).toBe(
			"queued",
		);
		expect(
			diagnosisStages({ ...run, status: "running", current_step: "collecting", valid_questions: 0 })[0].state,
		).toBe("running");
	});
	it("partial collection retains useful results without inventing analysis", () => {
		expect(
			states(diagnosisStages({ ...run, status: "partial", valid_questions: 4, failed_questions: 5 }, artifact)),
		).toEqual(["partial", "success", "pending", "pending"]);
	});
	it("interruption after all collection results preserves upstream artifacts", () => {
		expect(states(diagnosisStages({ ...run, status: "interrupted", current_step: "interrupted" }, artifact))).toEqual([
			"success",
			"success",
			"blocked",
			"blocked",
		]);
	});

	it("analysis failure retains successful collection and statistics", () => {
		expect(states(diagnosisStages({ ...run, current_step: "analysis_failed" }, artifact))).toEqual([
			"success",
			"success",
			"failed",
			"blocked",
		]);
	});
	it("report failure retains the saved analysis", () => {
		expect(states(diagnosisStages({ ...run, current_step: "report_render_failed" }, artifact, artifact))).toEqual([
			"success",
			"success",
			"success",
			"failed",
		]);
	});
	it("full success requires artifacts bound to the selected run", () => {
		expect(states(diagnosisStages({ ...run, current_step: "ready_for_review" }, artifact, artifact, report))).toEqual([
			"success",
			"success",
			"success",
			"success",
		]);
		const other = { run_id: "another_run" };
		expect(
			states(diagnosisStages(run, other, other, { ...other, revisions: [{ ...other, status: "ready" }] })),
		).toEqual(["success", "pending", "pending", "pending"]);
	});
	it("analysis and rendering in progress are distinguished from saved results", () => {
		expect(diagnosisStages({ ...run, current_step: "analyzing" }, artifact)[2].state).toBe("running");
		expect(diagnosisStages({ ...run, current_step: "rendering_report" }, artifact, artifact)[3].state).toBe("running");
	});
});
