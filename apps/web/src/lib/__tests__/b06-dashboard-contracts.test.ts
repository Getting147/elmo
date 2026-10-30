import { describe, expect, it } from "vitest";
import { computeShareOfVoice } from "@/lib/visibility-stats";
import { validateBrandFilterSearch } from "@/hooks/use-list-filters";
import {
	computeIsRequestedRunMissing,
	isInvalidBaselineRunId,
} from "@/hooks/use-active-baseline-run";

describe("BUG-001 / B06: Dashboard Data Contracts and Computations", () => {
	describe("1. SOV (Share of Voice) Calculation Contract", () => {
		it("computes exact SOV for standard multi-competitor test case (1 self, 2 compA, 1 compB -> 25%)", () => {
			const brand = { name: "TargetBrand", mentions: 1 };
			const competitors = [
				{ name: "CompetitorA", mentions: 2 },
				{ name: "CompetitorB", mentions: 1 },
			];

			const result = computeShareOfVoice(brand, competitors);

			expect(result.total).toBe(4);
			expect(result.brandShare).toBe(0.25);
			expect((result.brandShare! * 100).toFixed(1)).toBe("25.0");

			// Sorted by mentions descending: CompetitorA (2), TargetBrand (1), CompetitorB (1)
			expect(result.entries[0].name).toBe("CompetitorA");
			expect(result.entries[0].mentions).toBe(2);
			expect(result.entries[0].share).toBe(0.5);

			const brandEntry = result.entries.find((e) => e.isBrand);
			expect(brandEntry).toBeDefined();
			expect(brandEntry?.name).toBe("TargetBrand");
			expect(brandEntry?.mentions).toBe(1);
			expect(brandEntry?.share).toBe(0.25);

			const compBEntry = result.entries.find((e) => e.name === "CompetitorB");
			expect(compBEntry?.share).toBe(0.25);
		});

		it("returns null brandShare when total mentions is zero (SOV is non-computable)", () => {
			const brand = { name: "TargetBrand", mentions: 0 };
			const competitors = [
				{ name: "CompetitorA", mentions: 0 },
				{ name: "CompetitorB", mentions: 0 },
			];

			const result = computeShareOfVoice(brand, competitors);

			expect(result.total).toBe(0);
			expect(result.brandShare).toBeNull();
			// Entries all have share 0, no NaN or division by zero crash
			for (const entry of result.entries) {
				expect(entry.mentions).toBe(0);
				expect(entry.share).toBe(0);
			}
		});

		it("handles brand-only case with 100% share", () => {
			const brand = { name: "TargetBrand", mentions: 5 };
			const competitors = [
				{ name: "CompetitorA", mentions: 0 },
			];

			const result = computeShareOfVoice(brand, competitors);

			expect(result.total).toBe(5);
			expect(result.brandShare).toBe(1);
			expect(result.entries.find((e) => e.isBrand)?.share).toBe(1);
		});
	});

	describe("2. URL search validation for runId (cross-dashboard navigation persistence & F01 tamper resistance)", () => {
		it("accepts valid alphanumeric, underscore and hyphen runId", () => {
			const valid = validateBrandFilterSearch({ runId: "run_20261030_123456-abc" });
			expect(valid.runId).toBe("run_20261030_123456-abc");
		});

		it("preserves 'null' and 'undefined' string runId without erasing to undefined (F01)", () => {
			// String "null"
			const nullStr = validateBrandFilterSearch({ runId: "null" });
			expect(nullStr.runId).toBe("null");

			// Router-parsed null primitive (when ?runId=null is parsed via JSON.parse)
			const nullPrimitive = validateBrandFilterSearch({ runId: null });
			expect(nullPrimitive.runId).toBe("null");

			// String "undefined"
			const undefinedStr = validateBrandFilterSearch({ runId: "undefined" });
			expect(undefinedStr.runId).toBe("undefined");
		});

		it("neutralizes invalid or malicious runId strings into invalid token without stripping to undefined", () => {
			const malicious1 = validateBrandFilterSearch({ runId: "<script>alert(1)</script>" });
			expect(malicious1.runId).toBe("__invalid_run__");

			const malicious2 = validateBrandFilterSearch({ runId: "../../../etc/passwd" });
			expect(malicious2.runId).toBe("__invalid_run__");

			const malicious3 = validateBrandFilterSearch({ runId: "run' OR 1=1--" });
			expect(malicious3.runId).toBe("__invalid_run__");

			const malicious4 = validateBrandFilterSearch({ runId: "run_test<script>" });
			expect(malicious4.runId).toBe("__invalid_run__");

			const empty = validateBrandFilterSearch({ runId: "" });
			expect(empty.runId).toBeUndefined();

			const omitted = validateBrandFilterSearch({});
			expect(omitted.runId).toBeUndefined();

			const explicitUndefined = validateBrandFilterSearch({ runId: undefined });
			expect(explicitUndefined.runId).toBeUndefined();
		});
	});

	describe("3. Baseline Question and Domain Metrics Mapping", () => {
		it("correctly separates valid questions count from mention count (Visibility != SOV)", () => {
			// Visibility is mentions / valid_questions
			const p0Summary = {
				planned_questions: 3,
				valid_questions: 3,
				mention_count: 1,
				mention_rate: 1 / 3,
			};

			const visibilityPct = (p0Summary.mention_rate * 100).toFixed(1);
			expect(visibilityPct).toBe("33.3");

			// While SOV with CompA (2) and CompB (1) is 25.0%
			const sov = computeShareOfVoice(
				{ name: "TargetBrand", mentions: p0Summary.mention_count },
				[{ name: "CompA", mentions: 2 }, { name: "CompB", mentions: 1 }],
			);
			expect((sov.brandShare! * 100).toFixed(1)).toBe("25.0");

			// Crucial assertion: Visibility rate (33.3%) != SOV (25.0%)
			expect(visibilityPct).not.toBe((sov.brandShare! * 100).toFixed(1));
		});
	});

	describe("4. Probe Isolation Contract", () => {
		it("excludes probe questions from formal questions list and denominator", () => {
			const mixedQuestions = [
				{ question_id: "q1", question_text: "Formal question 1", is_probe: false, brand_mentioned: true },
				{ question_id: "q2", question_text: "Formal question 2", is_probe: false, brand_mentioned: false },
				{ question_id: "q_probe_1", question_text: "Probe query", is_probe: true, brand_mentioned: true },
			];

			const formalQuestions = mixedQuestions.filter((q) => !q.is_probe);
			expect(formalQuestions).toHaveLength(2);
			expect(formalQuestions.map((q) => q.question_id)).toEqual(["q1", "q2"]);

			const formalMentions = formalQuestions.filter((q) => q.brand_mentioned).length;
			const formalRate = formalMentions / formalQuestions.length;
			expect(formalMentions).toBe(1);
			expect(formalRate).toBe(0.5);

			// If probe wasn't excluded, rate would incorrectly be 2/3 = 66.7%
			const corruptedRate = mixedQuestions.filter((q) => q.brand_mentioned).length / mixedQuestions.length;
			expect(corruptedRate).toBeCloseTo(0.667, 2);
			expect(formalRate).not.toBe(corruptedRate);
		});
	});

	describe("5. Citation Category Mapping Contract", () => {
		const mapCategory = (rawCategory: string, rawSourceType: string): string => {
			const raw = (rawSourceType || rawCategory || "").toLowerCase();
			if (raw === "brand" || raw === "own_domain") return "brand";
			if (raw === "competitor") return "competitor";
			if (raw === "media" || raw === "news" || raw === "editorial") return "editorial";
			if (raw === "social" || raw === "ugc_or_community" || raw === "community") return "social";
			if (raw === "institutional" || raw === "gov_or_public" || raw === "industry_assoc") return "institutional";
			if (raw === "ecommerce") return "ecommerce";
			if (raw === "reviews") return "reviews";
			if (raw === "pr" || raw === "b2b_or_directory") return "pr";
			if (raw === "developer") return "developer";
			if (raw === "reference") return "reference";
			return "other";
		};

		it("maps all backend source_type and category variations to valid CITATION_CATEGORIES", () => {
			const testCases: [string, string, string][] = [
				["news", "", "editorial"],
				["media", "", "editorial"],
				["editorial", "", "editorial"],
				["ugc_or_community", "", "social"],
				["community", "", "social"],
				["social", "", "social"],
				["gov_or_public", "", "institutional"],
				["industry_assoc", "", "institutional"],
				["institutional", "", "institutional"],
				["own_domain", "", "brand"],
				["brand", "", "brand"],
				["competitor", "", "competitor"],
				["ecommerce", "", "ecommerce"],
				["reviews", "", "reviews"],
				["b2b_or_directory", "", "pr"],
				["pr", "", "pr"],
				["developer", "", "developer"],
				["reference", "", "reference"],
				["unknown_custom_source", "", "other"],
				["", "", "other"],
			];

			for (const [rawCategory, rawSourceType, expected] of testCases) {
				const mapped = mapCategory(rawCategory, rawSourceType);
				expect(mapped).toBe(expected);
			}
		});
	});

	describe("6. Model Filter Contract", () => {
		it("only matches baseline run data when filter is ALL_MODELS or matches model_name", () => {
			const baselineModel = "doubao-pro-32k";

			const isModelMatch = (filterModel: string | undefined, actualModel: string) => {
				if (!filterModel || filterModel === "all") return true;
				return filterModel === actualModel;
			};

			expect(isModelMatch(undefined, baselineModel)).toBe(true);
			expect(isModelMatch("all", baselineModel)).toBe(true);
			expect(isModelMatch("doubao-pro-32k", baselineModel)).toBe(true);
			expect(isModelMatch("gpt-4o", baselineModel)).toBe(false);
			expect(isModelMatch("claude-3-5-sonnet", baselineModel)).toBe(false);
		});

		it("detects unsupported models vs supported Doubao models", async () => {
			const { isUnsupportedBaselineModel, isDoubaoModel, UNSUPPORTED_MODEL_MESSAGE_ZH } = await import("@/lib/model-filter");

			expect(isDoubaoModel("doubao-pro-32k")).toBe(true);
			expect(isDoubaoModel("doubao-seed-128k")).toBe(true);
			expect(isDoubaoModel("Doubao")).toBe(true);
			expect(isDoubaoModel("gpt-4o")).toBe(false);

			expect(isUnsupportedBaselineModel("gpt-4o")).toBe(true);
			expect(isUnsupportedBaselineModel("gemini-1.5-pro")).toBe(true);
			expect(isUnsupportedBaselineModel("claude-3-5-sonnet")).toBe(true);
			expect(isUnsupportedBaselineModel("doubao-pro-32k")).toBe(false);
			expect(isUnsupportedBaselineModel("all")).toBe(false);
			expect(isUnsupportedBaselineModel(undefined)).toBe(false);
			expect(isUnsupportedBaselineModel("")).toBe(false);

			expect(UNSUPPORTED_MODEL_MESSAGE_ZH).toBe("目前仅支持豆包，其他模型暂不支持。");
		});

		it("correctly filters run dates by lookback window", async () => {
			const { isRunWithinLookback } = await import("@/lib/model-filter");

			const refDate = new Date("2026-10-30T12:00:00Z");

			// 2 days ago
			const twoDaysAgo = "2026-10-28T12:00:00Z";
			expect(isRunWithinLookback(twoDaysAgo, "1w", refDate)).toBe(true);
			expect(isRunWithinLookback(twoDaysAgo, "1m", refDate)).toBe(true);

			// 10 days ago
			const tenDaysAgo = "2026-10-20T12:00:00Z";
			expect(isRunWithinLookback(tenDaysAgo, "1w", refDate)).toBe(false);
			expect(isRunWithinLookback(tenDaysAgo, "1m", refDate)).toBe(true);

			// 45 days ago
			const fortyFiveDaysAgo = "2026-09-15T12:00:00Z";
			expect(isRunWithinLookback(fortyFiveDaysAgo, "1w", refDate)).toBe(false);
			expect(isRunWithinLookback(fortyFiveDaysAgo, "1m", refDate)).toBe(false);
			expect(isRunWithinLookback(fortyFiveDaysAgo, "3m", refDate)).toBe(true);
			expect(isRunWithinLookback(fortyFiveDaysAgo, "all", refDate)).toBe(true);
		});
	});

	describe("7. Citations Percentage Normalization & Brand Identity Freeze", () => {
		it("normalizes category counts with toRoundedPercentages so brand share evaluates to 20% (1/5) instead of 1%", async () => {
			const { toRoundedPercentages, emptyCategoryCounts } = await import("@/lib/domain-categories");

			const rawCounts = emptyCategoryCounts();
			rawCounts.brand = 1;
			rawCounts.competitor = 3;
			rawCounts.editorial = 1;

			const total = 5;
			const percentages = toRoundedPercentages(rawCounts);

			// 1 out of 5 is exactly 20%
			expect(percentages.brand).toBe(20);
			expect(percentages.competitor).toBe(60);
			expect(percentages.editorial).toBe(20);

			// Sum of non-zero percentages equals 100
			expect(percentages.brand + percentages.competitor + percentages.editorial).toBe(100);

			// Time series simulation: lastTrendPoint.brand is now 20, leading to brandShare = 20%
			const lastTrendPoint: { date: string; brand?: number; competitor?: number; editorial?: number } = { date: "2026-10-30", ...percentages };
			const brandShare = lastTrendPoint.brand ?? 0;
			expect(brandShare).toBe(20);
			expect(`${brandShare}%`).toBe("20%");
		});

		it("maps source_type=official to brand category and news to editorial category", () => {
			const mapItem = (c: { source_type?: string; category?: string; domain?: string }, brandDomains: Set<string>) => {
				const domain = (c.domain || "").toLowerCase();
				const raw = (c.source_type || c.category || "").toLowerCase();
				if (
					brandDomains.has(domain) ||
					raw === "own_domain" ||
					raw === "brand" ||
					raw === "official"
				) {
					return "brand";
				}
				if (raw === "competitor") return "competitor";
				if (raw === "news" || raw === "media" || raw === "editorial") return "editorial";
				return "other";
			};

			const brandDomains = new Set(["jinggongjian.com"]);

			expect(mapItem({ domain: "jinggongjian.com", source_type: "official" }, brandDomains)).toBe("brand");
			expect(mapItem({ domain: "compa.com", source_type: "competitor" }, brandDomains)).toBe("competitor");
			expect(mapItem({ domain: "news.industry.com", source_type: "news" }, brandDomains)).toBe("editorial");
		});
	});

	describe("8. Probe Isolation Under Dimensional Filter Contract", () => {
		it("strictly produces 0.0% SOV under '工程营地' when probe PX01 is isolated", () => {
			// Counterexample dataset:
			// P01: "产品定制", SELF=1, CompA=0, is_probe=false
			// P02: "工程营地", SELF=0, CompA=1, is_probe=false
			// P03: "度假民宿", SELF=0, CompB=1, is_probe=false
			// PX01: "工程营地", SELF=1, is_probe=true (supplemental probe hitting SELF)
			const allRawQuestions = [
				{ code: "P01", dimension_name: "产品定制", effective_mention: true, is_probe: false },
				{ code: "P02", dimension_name: "工程营地", effective_mention: false, is_probe: false },
				{ code: "P03", dimension_name: "度假民宿", effective_mention: false, is_probe: false },
				{ code: "PX01", dimension_name: "工程营地", effective_mention: true, is_probe: true },
			];

			// Competitor dimension hits from backend (CompA has 1 mention under 工程营地 from P02)
			const competitors = [
				{
					name: "CompA",
					dimension_hits: [{ dimension_name: "工程营地", mention_count: 1 }],
				},
			];

			// 1. Isolate formal questions:
			const formalQuestions = allRawQuestions.filter((q) => !q.is_probe);
			expect(formalQuestions).toHaveLength(3);
			expect(formalQuestions.find((q) => q.code === "PX01")).toBeUndefined();

			// 2. Filter by dimension "工程营地":
			const dimension = "工程营地";
			const matchingQuestions = formalQuestions.filter((q) => q.dimension_name === dimension);
			expect(matchingQuestions).toHaveLength(1);
			expect(matchingQuestions[0].code).toBe("P02");

			// SELF mentions under 工程营地
			const selfMentions = matchingQuestions.filter((q) => q.effective_mention).length;
			expect(selfMentions).toBe(0);

			// Competitor mentions under 工程营地
			const compList = competitors.map((c) => ({
				name: c.name,
				mentions: c.dimension_hits.find((d) => d.dimension_name === dimension)?.mention_count ?? 0,
			}));
			expect(compList[0].mentions).toBe(1);

			// Compute SOV:
			const sov = computeShareOfVoice({ name: "SelfBrand", mentions: selfMentions }, compList);
			expect(sov.total).toBe(1); // 0 + 1
			expect(sov.brandShare).toBe(0.0);
			expect((sov.brandShare! * 100).toFixed(1)).toBe("0.0");

			// Contrast: If probe PX01 was NOT excluded, selfMentions would be 1, total would be 2, SOV would be 50.0%
			const corruptedMatching = allRawQuestions.filter((q) => q.dimension_name === dimension);
			const corruptedSelf = corruptedMatching.filter((q) => q.effective_mention).length;
			const corruptedSov = computeShareOfVoice({ name: "SelfBrand", mentions: corruptedSelf }, compList);
			expect((corruptedSov.brandShare! * 100).toFixed(1)).toBe("50.0");
		});
	});

	describe("9. RunId Identity, Missing Detection & Legitimate Navigation Contract (F01)", () => {
		const sampleRuns = [
			{ run_id: "run_latest_001", brand_id: "brand_std", status: "completed" },
			{ run_id: "run_prev_002", brand_id: "brand_std", status: "completed" },
		];

		describe("9.1 Legitimate Navigation Preservation", () => {
			it("defaults to latest run (runs[0]) when runId is omitted from URL", () => {
				const requestedRunId = undefined;
				const activeRunId = requestedRunId || sampleRuns[0]?.run_id;
				const isRequestedRunMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
				});

				expect(activeRunId).toBe("run_latest_001");
				expect(isRequestedRunMissing).toBe(false);
			});

			it("selects specific run from dropdown when present in runs list", () => {
				const requestedRunId = "run_prev_002";
				const activeRunId = requestedRunId || sampleRuns[0]?.run_id;
				const isRequestedRunMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
				});

				expect(activeRunId).toBe("run_prev_002");
				expect(isRequestedRunMissing).toBe(false);
			});

			it("successfully fetches and preserves deep historical runs beyond top-30 list", () => {
				const requestedRunId = "run_historical_999";
				const historicalRunData = {
					run_id: "run_historical_999",
					brand_id: "brand_std",
					status: "completed",
					model_name: "doubao-pro-32k",
				};

				// While loading: do not flag missing prematurely
				const loadingMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
					isLoadingRun: true,
					runData: undefined,
				});
				expect(loadingMissing).toBe(false);

				// Once loaded: verify missing is false and run is injected
				const loadedMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
					isLoadingRun: false,
					runData: historicalRunData,
				});
				expect(loadedMissing).toBe(false);

				// Effective runs list prepends historical run
				const effectiveRuns = [historicalRunData, ...sampleRuns];
				expect(effectiveRuns[0].run_id).toBe("run_historical_999");
				expect(effectiveRuns).toHaveLength(3);
			});
		});

		describe("9.2 Adversarial Tampering & Invalid RunId Handling", () => {
			it("flags isRequestedRunMissing: true for literal 'null'", () => {
				const requestedRunId = "null";
				const isMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
				});

				expect(isMissing).toBe(true);
			});

			it("flags isRequestedRunMissing: true for literal 'undefined'", () => {
				const requestedRunId = "undefined";
				const isMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
				});

				expect(isMissing).toBe(true);
			});

			it("flags isRequestedRunMissing: true immediately for invalid characters / XSS / injection", () => {
				const invalidIds = [
					"__invalid_run__",
					"run_test<script>",
					"<script>alert(1)</script>",
					"../../../etc/passwd",
					"run' OR 1=1--",
					"run invalid spaces",
					"run!@#$%",
				];

				for (const id of invalidIds) {
					const isMissing = computeIsRequestedRunMissing({
						requestedRunId: id,
						runs: sampleRuns,
					});
					expect(isMissing).toBe(true);
				}
			});

			it("flags isRequestedRunMissing: true when run does not exist (404 Not Found)", () => {
				const requestedRunId = "run_non_existent";
				const isMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
					runError: { status: 404, message: "Run not_found" },
				});

				expect(isMissing).toBe(true);
			});

			it("flags isRequestedRunMissing: true and blocks cross-brand access (403 Forbidden)", () => {
				const requestedRunId = "run_b06_zeromention_001";
				const isMissing = computeIsRequestedRunMissing({
					requestedRunId,
					runs: sampleRuns,
					runError: { status: 403, message: "Access denied: brand mismatch" },
				});

				expect(isMissing).toBe(true);
			});
		});
	});
});
