/**
 * Epic A-2 (V1.0): 共享测试 fixture — crawledPageTexts Map 单点维护。
 *
 * 防止 evidence.test.ts + analyze.test.ts 两处 mock 漂移（re 建议采纳）。
 *
 * 用法：
 *   import { crawledPageTextsFixture, expectProductLineValidated } from "./__fixtures__/crawled-pages";
 *
 * Fixture 设计原则：
 *   1. lowercase 后的文本（与 evidence.ts L2 grep 对齐）
 *   2. 含 1 个完整 SKU（BCD-470WGCTD1）和 1 个 OCR-tolerant 变体（BCD-470WGCTD2）
 *   3. 含 1 个错误案例 URL（competitor.com 不在 Map）
 *   4. 含 Unicode 页面（验证 cross-language）
 */
export const crawledPageTextsFixture = new Map<string, string>([
	// 主产品页（lower-normalized，含海尔多 SKU 描述）
	[
		"https://haier.com/products",
		"haier offers a full range of home appliances. " +
			"the haier bcd-470wgctd1 refrigerator features french-door design. " +
			"competitors include samsung and lg electronics.",
	],
	// 中文页面（Unicode cross-language 验证）
	[
		"https://haier.com/zh/products",
		"海尔智家提供全套家用电器。" +
			"海尔 bcd-470wgctd1 冰箱采用法式对开门设计。",
	],
	// 简单页面（最小 fixture）
	["https://haier.com/about", "haier is a global home appliance brand."],
]);

/** 标准 SKU（evidence.ts 应通过） */
export const KNOWN_SKU = "BCD-470WGCTD1";
/** OCR-tolerant 变体（BCD-470WGCTD1 → BCD-470WGCTD2，1 char diff） */
export const KNOWN_SKU_OCR_VARIANT = "BCD-470WGCTD2";
/** LLM 幻觉 SKU（页面无 → NAME_NOT_FOUND） */
export const HALLUCINATED_SKU = "BrandX Model-999-Fictional";
/** 标准 evidence URL（fixture 主键） */
export const KNOWN_PRODUCT_URL = "https://haier.com/products";
/** Unicode 页面 URL */
export const ZH_PRODUCT_URL = "https://haier.com/zh/products";
/** 不在抓取页集合的 URL（用于测 URL_NOT_IN_CRAWL） */
export const UNKNOWN_URL = "https://competitor.com/no-such-page";

/** 期望 productLines 验证辅助（re H1-1/1-2/1-5 落地参考） */
export const expectProductLineValidated = (line: {
	skus: Array<{ name: string }>;
}) => {
	if (line.skus.length === 0) {
		throw new Error("ProductLine should have at least 1 SKU");
	}
};
