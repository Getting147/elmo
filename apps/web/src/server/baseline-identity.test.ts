import { describe, expect, it } from "vitest";
import { baselineIdentityHeaders } from "./baseline-identity";

describe("baseline tenant header transport", () => {
	it("preserves historical ASCII headers", () => {
		expect(baselineIdentityHeaders("org_sri", "brand_sri", "user_test")).toEqual({
			"X-Organization-Id": "org_sri",
			"X-Brand-Id": "brand_sri",
			"X-Caller-Id": "user_test",
		});
	});
	it("round-trips original Chinese identities as ASCII bytes without a new identity", () => {
		const brand = "深圳市精工建轻钢房屋有限公司-2";
		const headers = baselineIdentityHeaders("测试组织", brand, "合成操作员");
		expect(() => new Headers(headers)).not.toThrow();
		expect(headers["X-Tenant-Id-Encoding"]).toBe("utf-8-percent");
		expect(decodeURIComponent(String(headers["X-Brand-Id"]))).toBe(brand);
		expect(decodeURIComponent(String(headers["X-Organization-Id"]))).toBe("测试组织");
	});
});
