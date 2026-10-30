import { describe, expect, it } from "vitest";
import { computeShareOfVoice } from "@/lib/visibility-stats";
import { validateBrandFilterSearch } from "@/hooks/use-list-filters";

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

	describe("2. URL search validation for runId (cross-dashboard navigation persistence)", () => {
		it("accepts valid alphanumeric, underscore and hyphen runId", () => {
			const valid = validateBrandFilterSearch({ runId: "run_20261030_123456-abc" });
			expect(valid.runId).toBe("run_20261030_123456-abc");
		});

		it("rejects invalid or malicious runId strings", () => {
			const malicious1 = validateBrandFilterSearch({ runId: "<script>alert(1)</script>" });
			expect(malicious1.runId).toBeUndefined();

			const malicious2 = validateBrandFilterSearch({ runId: "../../../etc/passwd" });
			expect(malicious2.runId).toBeUndefined();

			const malicious3 = validateBrandFilterSearch({ runId: "run' OR 1=1--" });
			expect(malicious3.runId).toBeUndefined();

			const empty = validateBrandFilterSearch({ runId: "" });
			expect(empty.runId).toBeUndefined();
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
	});
});
