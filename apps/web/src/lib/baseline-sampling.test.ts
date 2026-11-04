import { describe, expect, it } from "vitest";
import { DEFAULT_SAMPLING_OUTPUT_TOKENS, samplingOutputTokens, samplingUsageCount } from "./baseline-sampling";

describe("sampling output authorization", () => {
	it("uses 16384 only for new confirmations and preserves explicit smaller values", () => {
		expect(DEFAULT_SAMPLING_OUTPUT_TOKENS).toBe(16384);
		expect(samplingOutputTokens(undefined)).toBe(16384);
		expect(samplingOutputTokens(4096)).toBe(4096);
		expect(samplingOutputTokens(undefined, 4096)).toBe(4096);
		expect(samplingOutputTokens(4096, 16384)).toBe(4096);
	});
	it("requires explicit confirmation for missing or conflicting authorization", () => {
		expect(() => samplingOutputTokens(undefined, null)).toThrow("重新");
		expect(() => samplingOutputTokens(16384, 4096)).toThrow("超过");
		expect(() => samplingOutputTokens(0)).toThrow("正整数");
	});
	it("keeps missing, malformed and legitimate zero usage distinct", () => {
		expect(samplingUsageCount(undefined)).toBe("未知");
		expect(samplingUsageCount(null)).toBe("未知");
		expect(samplingUsageCount(0)).toBe(0);
		expect(samplingUsageCount(12855)).toBe(12855);
		for (const invalid of [-1, 0.5, "12855", {}, Number.NaN]) expect(samplingUsageCount(invalid)).toBe("格式异常");
	});
});
