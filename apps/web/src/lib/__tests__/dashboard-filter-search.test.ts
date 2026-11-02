import { describe, expect, it } from "vitest";
import { pickDashboardFilterSearch } from "@/lib/dashboard-filter-search";

describe("pickDashboardFilterSearch", () => {
	it("keeps the shared dashboard filter params, including an explicit model", () => {
		expect(
			pickDashboardFilterSearch({
				runId: "run_pro",
				model: "doubao-seed-2-1-pro-260628",
				lookback: "1y",
				tags: "海上油气与光伏",
				q: "中东",
			}),
		).toEqual({
			runId: "run_pro",
			model: "doubao-seed-2-1-pro-260628",
			lookback: "1y",
			tags: "海上油气与光伏",
			q: "中东",
		});
	});

	it("omits undefined filter keys and keeps explicit values", () => {
		expect(pickDashboardFilterSearch({ runId: "run_pro" })).toEqual({ runId: "run_pro" });
		expect(pickDashboardFilterSearch({ runId: "run_pro", model: undefined, q: "" })).toEqual({
			runId: "run_pro",
			q: "",
		});
	});

	it("drops route-specific keys when moving between dashboards", () => {
		expect(
			pickDashboardFilterSearch({
				runId: "run_pro",
				model: "doubao",
				tab: "top-queries",
				order: "newest",
			}),
		).toEqual({ runId: "run_pro", model: "doubao" });
	});

	it("returns an empty object without previous search", () => {
		expect(pickDashboardFilterSearch(undefined)).toEqual({});
		expect(pickDashboardFilterSearch(null)).toEqual({});
	});
});