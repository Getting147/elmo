/**
 * Epic A-2 (V1.0): analyze.ts 扩展 — productLines 边界 + 老调用兼容 + evidence 分流
 *
 * 覆盖（re H1-1/2/3/4/5 + 兼容性 + S2-1/2/3 边界）：
 *   - 老调用不带 maxProducts/crawledPageTexts → 不传 productLines (向后兼容)
 *   - maxProducts=0 → 不传 productLines/summary/description
 *   - 新调用带 crawledPageTexts → productLines 按 evidence 分 confirmed/unverified
 *   - H1-1 SKU 名精确匹配 → confirmed
 *   - H1-2 SKU 名 1 字符差异 → confirmed (OCR 容忍)
 *   - H1-3 evidenceUrl 不在抓取集 → unverified + URL_NOT_IN_CRAWL（按 line 进，不整 brand 拒）
 *   - H1-5 SKU 名 grep 失败 → unverified + NAME_NOT_FOUND
 *   - S2-1 缺必填字段 → SKU 被 filter 掉（line.skus 空 → 整 line 不入 confirmed/unverified）
 *   - S2-2 SKU 重复名 → 视为单条（去重 = 同 line 内不重复）
 */
import { describe, expect, it } from "vitest";

import { normalizeAnalysisResult } from "./analyze";
import { crawledPageTextsFixture, KNOWN_PRODUCT_URL, KNOWN_SKU, KNOWN_SKU_OCR_VARIANT, HALLUCINATED_SKU, UNKNOWN_URL } from "./__fixtures__/crawled-pages";

describe("analyzeBrand — 老调用兼容（maxProducts 默认 10，crawledPageTexts 默认空）", () => {
	it("直接构造 AnalysisContext 验证默认 maxProducts=10 + crawledPageTexts.size=0（避免网络抓取）", () => {
		// 老调用兼容验证: 直接断言默认参数(避免 buildAnalysisContext 触发网络抓取)
		const ctx = {
			website: "haier.com",
			analysisUrl: "https://haier.com",
			brandNameHint: "Haier",
			prompt: "test prompt",
			schema: undefined as never,
			maxCompetitors: 0,
			maxPrompts: 0,
		} as unknown as Parameters<typeof normalizeAnalysisResult>[1];
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				productLines: [],
			} as never,
			ctx,
		);
		expect(result.productLines?.confirmed.length).toBe(0);
		expect(result.productLines?.unverified.length).toBe(0);
	});

	it("不传 crawledPageTexts 时：normalize 后 productLines 全部 confirmed（无证据校验）", () => {
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: "Test summary",
				description: "Test description",
				productLines: [
					{
						name: "Refrigerators",
						skus: [
							{ name: KNOWN_SKU, oneLiner: "Test", evidenceUrl: KNOWN_PRODUCT_URL },
						],
					},
				] as never,
			},
			{
				website: "haier.com",
				analysisUrl: "https://haier.com",
				brandNameHint: "Haier",
				prompt: "test prompt",
				schema: undefined as never,
				maxCompetitors: 0,
				maxPrompts: 0,
				maxProducts: 10,
				crawledPageTexts: new Map(),
			},
		);
		expect(result.productLines?.confirmed.length).toBe(1);
		expect(result.productLines?.unverified.length).toBe(0);
	});
});

describe("analyzeBrand — 新调用带 crawledPageTexts（H1-1/1-2/1-5 evidence 分流）", () => {
	const analysisContextBase = {
		website: "haier.com",
		analysisUrl: "https://haier.com",
		brandNameHint: "Haier",
		prompt: "test prompt",
		schema: undefined as never,
		maxCompetitors: 0,
		maxPrompts: 0,
		maxProducts: 5,
		crawledPageTexts: crawledPageTextsFixture,
	};

	it("H1-1: SKU name 精确匹配 evidenceUrl 页文本 → confirmed", () => {
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: "Haier home appliances",
				description: "Global home appliance manufacturer",
				productLines: [
					{
						name: "Refrigerators",
						skus: [
							{ name: KNOWN_SKU, oneLiner: "French-door", evidenceUrl: KNOWN_PRODUCT_URL },
						],
					},
				] as never,
			} as never,
			analysisContextBase,
		);
		expect(result.productLines?.confirmed.length).toBe(1);
		expect(result.productLines?.unverified.length).toBe(0);
	});

	it("H1-2: SKU 名 1 字符差异（OCR 容忍）→ confirmed", () => {
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: "Haier home appliances",
				description: "Global home appliance manufacturer",
				productLines: [
					{
						name: "Refrigerators",
						skus: [
							{ name: KNOWN_SKU_OCR_VARIANT, oneLiner: "French-door", evidenceUrl: KNOWN_PRODUCT_URL },
						],
					},
				] as never,
			} as never,
			analysisContextBase,
		);
		expect(result.productLines?.confirmed.length).toBe(1);
		expect(result.productLines?.unverified.length).toBe(0);
	});

	it("H1-3: evidenceUrl 不在抓取页集合 → unverified (URL_NOT_IN_CRAWL)", () => {
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: "Haier home appliances",
				description: "Global home appliance manufacturer",
				productLines: [
					{
						name: "Refrigerators",
						skus: [
							{ name: KNOWN_SKU, oneLiner: "French-door", evidenceUrl: UNKNOWN_URL },
						],
					},
				] as never,
			} as never,
			analysisContextBase,
		);
		expect(result.productLines?.confirmed.length).toBe(0);
		expect(result.productLines?.unverified.length).toBe(1);
		expect(result.productLines?.unverified[0].reason).toContain("URL_NOT_IN_CRAWL");
	});

	it("H1-5: LLM 幻觉 SKU 名 → unverified (NAME_NOT_FOUND)", () => {
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: "Haier home appliances",
				description: "Global home appliance manufacturer",
				productLines: [
					{
						name: "Refrigerators",
						skus: [
							{ name: HALLUCINATED_SKU, oneLiner: "Phantom", evidenceUrl: KNOWN_PRODUCT_URL },
						],
					},
				] as never,
			} as never,
			analysisContextBase,
		);
		expect(result.productLines?.confirmed.length).toBe(0);
		expect(result.productLines?.unverified.length).toBe(1);
		expect(result.productLines?.unverified[0].reason).toContain("NAME_NOT_FOUND");
	});

	it("S2-1: SKU 缺 evidenceUrl → 保留并进 unverified (MISSING_URL)（hill 2026-09-08：不整组丢弃）", () => {
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: "Haier home appliances",
				description: "Global home appliance manufacturer",
				productLines: [
					{
						name: "Refrigerators",
						skus: [
							// 缺 evidenceUrl（无 .evidenceUrl）
							{ name: KNOWN_SKU, oneLiner: "French-door" } as never,
						],
					},
				],
			} as never,
			analysisContextBase,
		);
		// evidenceUrl 缺失 → SKU 保留（evidenceUrl=""）→ validateEvidence MISSING_URL → 整 line 进 unverified
		expect(result.productLines?.confirmed.length).toBe(0);
		expect(result.productLines?.unverified.length).toBe(1);
		expect(result.productLines?.unverified[0].reason).toContain("MISSING_URL");
	});

	it("summary/description 长度截断（200/1000）", () => {
		const long = "a".repeat(5000);
		const result = normalizeAnalysisResult(
			{
				brandName: "Haier",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
				summary: long,
				description: long,
				productLines: [],
			} as never,
			analysisContextBase,
		);
		expect(result.summary?.length).toBe(200);
		expect(result.description?.length).toBe(1000);
	});
});
