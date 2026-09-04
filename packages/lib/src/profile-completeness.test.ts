/**
 * Epic A-1 完整度公式单测（A1-7 缺类归一化防除 0）
 *
 * 覆盖：
 * - 3 类齐全 → overall = Σ(w×s) / Σw = 0.3×brand + 0.4×pl + 0.3×cred
 * - 缺一类 → 分母归一化到剩余类权重和
 * - 全缺 → overall = 0
 * - 阈值 isCompletenessWarning(<0.6 true)
 * - 三档 completenessTier
 */
import { describe, expect, it } from "vitest";

import {
	COMPLETENESS_WARNING_THRESHOLD,
	W_BRAND,
	W_CREDENTIAL,
	W_PRODUCT_LINE,
	W_TOTAL,
	completenessTier,
	computeCompleteness,
	isCompletenessWarning,
} from "./profile-completeness.js";

const PERFECT_BRAND = {
	name: "Haier",
	website: "https://haier.com",
	aliases: ["海尔", "Haier Group"],
	competitorCount: 4,
};

const EMPTY_BRAND = {
	name: "X",
	website: null,
	aliases: [],
	competitorCount: 0,
};

const PERFECT_PL = [{ name: "Smart Home", differentiators: "AI-driven", targetAudience: "family" }];
const EMPTY_PL: Array<{ name: string | null; differentiators: string | null; targetAudience: string | null }> = [];
const PARTIAL_PL = [
	{ name: "A", differentiators: "x", targetAudience: null }, // 0/3 字段 → incomplete
	{ name: "B", differentiators: "y", targetAudience: "z" }, // 3/3 → complete
];

const TP_CRED = [{ isThirdPartyPublic: true }];
const NON_TP_CRED = [{ isThirdPartyPublic: false }];
const MIXED_CRED = [
	{ isThirdPartyPublic: true },
	{ isThirdPartyPublic: true },
	{ isThirdPartyPublic: false },
	{ isThirdPartyPublic: false },
];

describe("computeCompleteness — 3 classes present", () => {
	it("3 classes all perfect → overall = 1.0 (weights sum to 1.0)", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: PERFECT_PL,
			credentials: TP_CRED,
		});
		expect(r.overall).toBe(1.0);
		expect(r.brand).toBe(1);
		expect(r.product_line).toBe(1);
		expect(r.credential).toBe(1);
		expect(r.missing).toEqual([]);
	});

	it("3 classes all empty → overall = 0", () => {
		const r = computeCompleteness({
			brand: EMPTY_BRAND,
			productLines: EMPTY_PL,
			credentials: NON_TP_CRED,
		});
		expect(r.overall).toBe(0);
		expect(r.missing).toContain("brand");
		expect(r.missing).toContain("product_line");
		expect(r.missing).toContain("credential");
	});

	it("weight constants sum to 1.0 (sanity)", () => {
		expect(W_BRAND + W_PRODUCT_LINE + W_CREDENTIAL).toBeCloseTo(W_TOTAL, 5);
	});
});

describe("computeCompleteness — missing-class normalization (A1-7 防除 0)", () => {
	it("missing credential → 分母归一化 (0.3 + 0.4 = 0.7)", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: PERFECT_PL,
			credentials: [], // empty credentials -> missing-detect path
		});
		// brand=1, product_line=1, credential=missing
		// overall = (1*0.3 + 1*0.4) / (0.3 + 0.4) = 0.7/0.7 = 1.0
		expect(r.overall).toBe(1.0);
		expect(r.missing).toContain("credential");
	});

	it("missing product_line + perfect others → 分母归一化 (0.3 + 0.3 = 0.6)", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: EMPTY_PL,
			credentials: TP_CRED,
		});
		// overall = (1*0.3 + 1*0.3) / (0.3 + 0.3) = 0.6/0.6 = 1.0
		expect(r.overall).toBe(1.0);
		expect(r.missing).toContain("product_line");
	});

	it("only brand present (50%) → overall = 1.0 (no division by zero)", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: EMPTY_PL,
			credentials: NON_TP_CRED,
		});
		// presentWeights = [(1, 0.3)] → overall = 1.0
		expect(r.overall).toBe(1.0);
		expect(r.missing).toContain("product_line");
		expect(r.missing).toContain("credential");
	});

	it("partial product_lines (50% complete) → product_line score = 0.5", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: PARTIAL_PL,
			credentials: TP_CRED,
		});
		expect(r.product_line).toBe(0.5);
		// overall = (1*0.3 + 0.5*0.4 + 1*0.3) / 1.0 = 0.8
		expect(r.overall).toBe(0.8);
	});

	it("credential 50% third_party_public → credential score = 1 (≥30% threshold)", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: PERFECT_PL,
			credentials: MIXED_CRED, // 2/4 = 50% ≥ 30% → complete
		});
		expect(r.credential).toBe(1);
	});

	it("credential <30% third_party_public → credential score = 0", () => {
		const r = computeCompleteness({
			brand: PERFECT_BRAND,
			productLines: PERFECT_PL,
			credentials: [{ isThirdPartyPublic: false }, { isThirdPartyPublic: false }, { isThirdPartyPublic: false }, { isThirdPartyPublic: true }], // 1/4 = 25% < 30% → incomplete
		});
		expect(r.credential).toBe(0);
	});
});

describe("completenessTier + isCompletenessWarning (onboarding 3 档)", () => {
	it("tier thresholds: ok≥0.8 / warn≥0.6 / block<0.6", () => {
		expect(completenessTier(1.0)).toBe("ok");
		expect(completenessTier(0.8)).toBe("ok");
		expect(completenessTier(0.79)).toBe("warn");
		expect(completenessTier(0.6)).toBe("warn");
		expect(completenessTier(0.59)).toBe("block");
		expect(completenessTier(0)).toBe("block");
	});

	it("isCompletenessWarning triggers below 0.6", () => {
		expect(isCompletenessWarning(0)).toBe(true);
		expect(isCompletenessWarning(0.59)).toBe(true);
		expect(isCompletenessWarning(0.6)).toBe(false);
		expect(isCompletenessWarning(1.0)).toBe(false);
	});

	it("COMPLETENESS_WARNING_THRESHOLD = 0.6 (US-A05 验收口径)", () => {
		expect(COMPLETENESS_WARNING_THRESHOLD).toBe(0.6);
	});
});
