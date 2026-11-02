import { describe, expect, it } from "vitest";
import { analysisRecoveryStatus } from "./analysis-recovery";
import { analysisRequestErrorMessage, baselineResponseError } from "./baseline-request-error";
import { questionObservationMessage } from "./baseline-status";
import { formatActionPlan, inspectActionPlan, parseActionPlan } from "./analysis-action-editor";

describe("request error boundaries", () => {
	it("never exposes an HTML 504 body and retains status and safe correlation ID", async () => {
		const response = new Response("<html>nginx secret stack</html>", {
			status: 504, headers: { "content-type": "text/html", "x-request-id": "trace-123" },
		});
		const error = await baselineResponseError(response);
		expect(error.status).toBe(504);
		expect(error.message).toContain("等待超时");
		expect(error.message).toContain("trace-123");
		expect(error.message).not.toContain("<html>");
		expect(response.bodyUsed).toBe(true);
	});
	it("preserves structured business errors and handles invalid JSON without reading a consumed body twice", async () => {
		const error = await baselineResponseError(new Response('{"detail":{"error":"invalid_evidence","message":"第2条引用不属于当前任务"}}', {
			status: 422, headers: { "content-type": "application/json" },
		}));
		expect(error.message).toContain("第2条引用不属于当前任务");
		const bad = await baselineResponseError(new Response("<html>bad</html>", {
			status: 502, headers: { "content-type": "application/json" },
		}));
		expect(bad.message).toContain("HTTP 502");
		expect(bad.message).not.toContain("<html>");
	});
	it("does not display errors from a failing outer Web proxy", () => {
		expect(analysisRequestErrorMessage(new Error("<html>504 upstream timeout</html>"))).toContain("只读核对");
		expect(analysisRequestErrorMessage(new TypeError("fetch failed"))).toContain("不会自动重发");
	});
});

describe("read-only recovery", () => {
	const read = { fresh: true, readFailed: false, hasAnalysis: false };
	it.each(["analyzing", "rendering_report"])("blocks duplicate work while %s even with partial status", (step) => {
		expect(analysisRecoveryStatus({ status: "partial", current_step: step }, read)).toMatchObject({ phase: "running", canRetry: false });
	});
	it("waits for new reads instead of using stale analysis_failed", () => {
		expect(analysisRecoveryStatus({ status: "partial", current_step: "analysis_failed" }, { ...read, fresh: false }).phase).toBe("checking");
	});
	it("restores a saved result and removes the expired request failure meaning", () => {
		expect(analysisRecoveryStatus({ status: "partial", current_step: "ready_for_review" }, { ...read, hasAnalysis: true })).toMatchObject({ phase: "ready", canRetry: false });
	});
	it("only permits explicit failure retry and explains an older available version", () => {
		const result = analysisRecoveryStatus({ status: "partial", current_step: "analysis_failed" }, { ...read, hasAnalysis: true });
		expect(result.canRetry).toBe(true);
		expect(result.message).toContain("此前可用版本");
	});
	it("keeps unavailable or unknown state blocked, including stale data after read errors", () => {
		expect(analysisRecoveryStatus({ status: "partial", current_step: "ready_for_review" }, { ...read, readFailed: true, hasAnalysis: true }).canRetry).toBe(false);
		expect(analysisRecoveryStatus(null, read).phase).toBe("unknown");
	});
});

describe("current editing and running observations", () => {
	it("separates in-progress from failed and never attempted questions", () => {
		expect(questionObservationMessage({ effective_status: "in_progress", attempts_count: 1, error_message: "stale failure" })).toBe("采样进行中，请耐心等待");
		expect(questionObservationMessage({ attempts_count: 0 })).toContain("未尝试");
		expect(questionObservationMessage({ attempts_count: 1, error_message: "长度限制" })).toContain("长度限制");
	});
	it("updates readiness from current text, preserving origin after editing and reorder", () => {
		const first = { action: "a|b\nc", evidence_refs: [], finding: "已知事实", priority: "P1", run_id: "run_1", brand_id: "brand_1" };
		const second = { ...first, action: "第二条", evidence_refs: ["Q02"] };
		const edited = formatActionPlan([second, { ...first, evidence_refs: ["Q01"] }]);
		const current = inspectActionPlan(edited, [first, second]);
		expect(current.items[1].evidence_refs).toEqual(["Q01"]);
		expect(current.items[1].run_id).toBe("run_1");
		expect(current.items[1].action).toBe("a|b\nc");
		expect(parseActionPlan(formatActionPlan(current.items), current.items)).toEqual(current.items);
	});
});
