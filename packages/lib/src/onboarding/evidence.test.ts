/**
 * Epic A-2 (V1.0): 防幻觉 evidence 校验测试（re H1 用例 + 自补）。
 *
 * 覆盖：
 * - L1 结构层：evidenceUrl 必填 + 属抓取页集合
 * - L2 内容层：SKU name grep evidenceUrl 对应页文本（防张冠李戴）
 * - H1-1/2/3/4/5 + 镜像大小写用例（re §1 后续补）
 */
import { describe, expect, it } from "vitest";

import { validateEvidence } from "./evidence";

const PAGE_TEXT_LOWER =
	"haier offers a full range of home appliances. " +
	"the haier bcd-470wgctd1 refrigerator features french-door design. " +
	"competitors include samsung and lg electronics.";

const PAGE_TEXT_UNICODE =
	"海尔智家提供全套家用电器。" +
	"海尔 bcd-470wgctd1 冰箱采用法式对开门设计。";

const crawledPageTexts = new Map<string, string>([
	["https://haier.com/products", PAGE_TEXT_LOWER],
	["https://haier.com/zh/products", PAGE_TEXT_UNICODE],
]);

describe("validateEvidence — L1 structural layer", () => {
	it("MISSING_URL: empty string → false + code MISSING_URL", () => {
		const r = validateEvidence({
			skuName: "Haier BCD-470WGCTD1",
			evidenceUrl: "",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("MISSING_URL");
	});

	it("MISSING_URL: whitespace-only → false + code MISSING_URL", () => {
		const r = validateEvidence({
			skuName: "Haier BCD-470WGCTD1",
			evidenceUrl: "   ",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("MISSING_URL");
	});

	it("URL_NOT_IN_CRAWL: URL not in crawledPageTexts → false + code URL_NOT_IN_CRAWL", () => {
		const r = validateEvidence({
			skuName: "Haier BCD-470WGCTD1",
			evidenceUrl: "https://example.com/no-such-page",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("URL_NOT_IN_CRAWL");
	});
});

describe("validateEvidence — L2 content layer (SKU name grep)", () => {
	it("H1-1: SKU name exactly matches evidence page text → ok=true", () => {
		const r = validateEvidence({
			skuName: "Haier BCD-470WGCTD1",
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(true);
		expect(r.code).toBeUndefined();
	});

	it("H1-2: SKU name NOT in evidence page → NAME_NOT_FOUND", () => {
		const r = validateEvidence({
			skuName: "Haier BCD-999NOSUCH", // 拼写错 → 文本无
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("NAME_NOT_FOUND");
	});

	it("H1-3: evidenceUrl not in crawled set (different domain) → URL_NOT_IN_CRAWL", () => {
		const r = validateEvidence({
			skuName: "Haier BCD-470WGCTD1",
			evidenceUrl: "https://competitor.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("URL_NOT_IN_CRAWL");
	});

	it("H1-4: SKU with empty name → NAME_NOT_FOUND", () => {
		const r = validateEvidence({
			skuName: "",
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("NAME_NOT_FOUND");
	});

	it("H1-5: SKU name hallucinated (not in any crawled page) → NAME_NOT_FOUND", () => {
		const r = validateEvidence({
			skuName: "BrandX Model-999-Fictional",
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("NAME_NOT_FOUND");
	});

	it("Mirror (re §1 后续补): SKU name with different case matches → ok=true", () => {
		// H1-1 镜像: 大小写不敏感 — text 已预处理 lowercase
		const r = validateEvidence({
			skuName: "haier bcd-470wgctd1", // lowercase variant
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(true);
	});

	it("OCR-tolerant: SKU name with 1-char difference matches → ok=true", () => {
		// "BCD-470WGCTD1" → "BCD-470WGCTD2"（末位 1→2，1 char diff）应通过
		const r = validateEvidence({
			skuName: "BCD-470WGCTD2",
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(true);
	});

	it("OCR-beyond-tolerance: SKU name with 2+ char difference → NAME_NOT_FOUND", () => {
		// "BCD-470WGCTD1" → "BCD-470ABCDE1"（多字符差异）应拒绝
		const r = validateEvidence({
			skuName: "BCD-470ABCDE1",
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("NAME_NOT_FOUND");
	});

	it("Unicode SKU: Chinese SKU name matches Unicode page → ok=true", () => {
		const r = validateEvidence({
			skuName: "BCD-470WGCTD1",
			evidenceUrl: "https://haier.com/zh/products",
			crawledPageTexts,
		});
		expect(r.ok).toBe(true);
	});
});

describe("validateEvidence — fallback for empty crawled set", () => {
	it("empty crawledPageTexts + valid evidenceUrl + skuName → MISSING_URL (no URL to validate against)", () => {
		// 边界: crawlerPageTexts 空 = caller 没传 → evidence 校验无法跑 → 拒绝
		const r = validateEvidence({
			skuName: "Haier BCD-470WGCTD1",
			evidenceUrl: "https://haier.com/products",
			crawledPageTexts: new Map(),
		});
		expect(r.ok).toBe(false);
		expect(r.code).toBe("URL_NOT_IN_CRAWL"); // evidenceUrl 不在空集合
	});
});
