/**
 * Epic A-2 (V1.0): crawledPageTexts 共享 fixture 单元测试
 * (防 evidence.test.ts + analyze.test.ts mock 漂移 — re 建议采纳)
 */
import { describe, expect, it } from "vitest";

import { crawledPageTextsFixture } from "./crawled-pages";

describe("crawledPageTexts fixture", () => {
	it("3 个页面共享，product 页 lowercase 文本含 SKUs", () => {
		expect(crawledPageTextsFixture.size).toBe(3);
		const productPage = crawledPageTextsFixture.get("https://haier.com/products");
		expect(productPage).toBeDefined();
		expect(productPage!.toLowerCase()).toContain("bcd-470wgctd1");
	});

	it("中文页面含 Unicode SKU（cross-language 验证）", () => {
		const zhPage = crawledPageTextsFixture.get("https://haier.com/zh/products");
		expect(zhPage).toBeDefined();
		expect(zhPage!.toLowerCase()).toContain("bcd-470wgctd1");
	});
});
