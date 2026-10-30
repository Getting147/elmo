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
});
