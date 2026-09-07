/**
 * Pure-function tests for the product-lines editor — no DOM, fast unit tests
 * for the evidence-reason formatting and SKU validity rules shared with the
 * onboarding storage contract.
 */
import { describe, expect, it } from "vitest";

import { areSkusValid, formatEvidenceReason, newEditableSku } from "@/components/product-lines-editor";

describe("formatEvidenceReason", () => {
	it("maps a bare failure code to its Chinese label", () => {
		expect(formatEvidenceReason("NAME_NOT_FOUND")).toBe("产品名称未能在引用页面中找到");
		expect(formatEvidenceReason("URL_NOT_IN_CRAWL")).toBe("引用页面不在抓取范围内，无法核对");
		expect(formatEvidenceReason("MISSING_URL")).toBe("缺少证据链接，无法核对");
	});

	it("maps a code embedded after a SKU name (analyze.ts payload shape)", () => {
		expect(formatEvidenceReason("Galaxy S25: NAME_NOT_FOUND")).toBe(
			"Galaxy S25: 产品名称未能在引用页面中找到",
		);
	});

	it("maps every code in a multi-SKU reason list", () => {
		const reason = "Fridge X: NAME_NOT_FOUND; Washer Y: URL_NOT_IN_CRAWL";
		expect(formatEvidenceReason(reason)).toBe(
			"Fridge X: 产品名称未能在引用页面中找到; Washer Y: 引用页面不在抓取范围内，无法核对",
		);
	});

	it("leaves unknown text untouched", () => {
		const unknown = "custom reason without a code";
		expect(formatEvidenceReason(unknown)).toBe(unknown);
	});
});

describe("areSkusValid", () => {
	it("accepts a SKU with name + well-formed http(s) evidence URL", () => {
		expect(
			areSkusValid([newEditableSku({ name: "Galaxy S25", evidenceUrl: "https://example.com/product" })]),
		).toBe(true);
	});

	it("rejects a SKU without a name", () => {
		expect(areSkusValid([newEditableSku({ name: "", evidenceUrl: "https://example.com/product" })])).toBe(false);
	});

	it("rejects a SKU without / with a malformed evidence URL", () => {
		expect(areSkusValid([newEditableSku({ name: "X", evidenceUrl: "" })])).toBe(false);
		expect(areSkusValid([newEditableSku({ name: "X", evidenceUrl: "not-a-url" })])).toBe(false);
	});

	it("requires every SKU in the line to be valid", () => {
		const line = [
			newEditableSku({ name: "Good", evidenceUrl: "https://example.com/a" }),
			newEditableSku({ name: "Bad", evidenceUrl: "https://example.com/b" }),
			newEditableSku({ name: "", evidenceUrl: "https://example.com/c" }),
		];
		expect(areSkusValid(line)).toBe(false);
	});

	it("accepts an empty SKU list", () => {
		expect(areSkusValid([])).toBe(true);
	});
});
