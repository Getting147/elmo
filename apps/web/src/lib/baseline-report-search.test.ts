import { describe, expect, it } from "vitest";
import { INVALID_REPORT_TASK_LINK, validateReportSearch } from "./baseline-report-search";

describe("report task links", () => {
	it("keeps an absent selection and valid task identity", () => {
		expect(validateReportSearch({})).toEqual({});
		expect(validateReportSearch({ runId: "run_valid-01" })).toEqual({ runId: "run_valid-01" });
	});
	it.each(["", "../run_a", "a/b", "run_中文", ["run_a", "run_b"]])("rejects invalid external runId %j", (runId) => {
		expect(() => validateReportSearch({ runId })).toThrow(INVALID_REPORT_TASK_LINK);
	});
});
