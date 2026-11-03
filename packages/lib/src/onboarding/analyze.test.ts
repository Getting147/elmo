import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the LLM and excerpt modules so the tests never call external services.
vi.mock("./llm", () => ({
	resolveResearchTarget: vi.fn(() => ({
		provider: { id: "anthropic-api", isConfigured: () => true } as any,
		model: "claude-sonnet-4-6",
	})),
	runStructuredResearchPrompt: vi.fn(),
}));
vi.mock("../website-excerpt", () => ({
	getWebsiteExcerpt: vi.fn(async () => ""),
}));

import { getWebsiteExcerpt } from "../website-excerpt";
import { analyzeBrand, buildAnalysisContext, normalizeAnalysisResult } from "./analyze";
import { runStructuredResearchPrompt } from "./llm";

afterEach(() => {
	vi.clearAllMocks();
});

describe("analyzeBrand", () => {
	it("uses the full page URL for analysis while retaining the domain identity", async () => {
		const pageUrl = "https://www.nike.com/golf?category=clubs#featured";
		vi.mocked(getWebsiteExcerpt).mockResolvedValueOnce("Nike Golf page excerpt");
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Nike Golf",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		});

		const result = await analyzeBrand({
			website: pageUrl,
			brandName: "Nike Golf",
		});
		const prompt = vi.mocked(runStructuredResearchPrompt).mock.calls[0]?.[0];

		expect(getWebsiteExcerpt).toHaveBeenCalledWith(pageUrl);
		expect(prompt).toContain(`Analyze the brand at ${pageUrl}.`);
		expect(prompt).toContain(`Text from ${pageUrl}:`);
		expect(result.website).toBe("nike.com");
	});

	it("does not disclose embedded URL credentials to analysis services", async () => {
		const privateUrl = "https://alice:secret@example.com/private?view=summary";
		const safeUrl = "https://example.com/private?view=summary";

		const ctx = await buildAnalysisContext({ website: privateUrl });

		expect(getWebsiteExcerpt).toHaveBeenCalledWith(safeUrl);
		expect(ctx.prompt).toContain(`Analyze the brand at ${safeUrl}.`);
		expect(ctx.prompt).not.toContain("alice");
		expect(ctx.prompt).not.toContain("secret");
		expect(ctx.website).toBe("example.com");
	});

	it("rejects unsupported protocols before calling analysis services", async () => {
		await expect(buildAnalysisContext({ website: "ftp://example.com/private" })).rejects.toThrow(
			'Could not parse website "ftp://example.com/private"',
		);

		expect(getWebsiteExcerpt).not.toHaveBeenCalled();
	});

	// The case from the issue: research the Nike Golf section of the site, but
	// keep tracking mentions against nike.com.
	it("scopes a sub-page to its own brand without moving the tracked domain", async () => {
		const pageUrl = "https://www.nike.com/golf";
		vi.mocked(getWebsiteExcerpt).mockResolvedValueOnce("Nike Golf clubs, balls, and apparel");
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			// The model narrows a sub-brand to the parent it recognises.
			brandName: "Nike",
			additionalDomains: [],
			aliases: [],
			competitors: [{ name: "Titleist", domains: ["titleist.com"], aliases: [] }],
			suggestedPrompts: [{ prompt: "best golf clubs", tags: ["golf"] }],
		});

		const result = await analyzeBrand({ website: pageUrl, brandName: "Nike Golf" });
		const prompt = vi.mocked(runStructuredResearchPrompt).mock.calls[0]?.[0];

		expect(getWebsiteExcerpt).toHaveBeenCalledWith(pageUrl);
		expect(prompt).toContain(`Analyze the brand at ${pageUrl}.`);
		expect(prompt).toContain(`Text from ${pageUrl}:`);
		expect(prompt).toContain("not the site root");
		// Mention and citation matching key off this, so it must stay the domain.
		expect(result.website).toBe("nike.com");
		expect(result.brandName).toBe("Nike Golf");
	});

	it("keeps the caller's brand name when the model answers with the parent brand", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Nike",
			additionalDomains: [],
			aliases: ["Nike Golf Equipment"],
			competitors: [],
			suggestedPrompts: [],
		});

		const result = await analyzeBrand({ website: "nike.com", brandName: "Nike Golf" });

		expect(result.brandName).toBe("Nike Golf");
		// Aliases are filtered against the name we actually kept.
		expect(result.aliases).toEqual([]);
	});

	it("takes the model's brand name when the caller supplied none", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		});

		const result = await analyzeBrand({ website: "acmecorp.com" });

		expect(result.brandName).toBe("Acme");
	});

	// Same page, written two ways — the website field accepts either, so both
	// must resolve to one analysis URL and one tracked domain.
	it("treats a plain domain with a path the same as its full URL", async () => {
		const contexts = [];
		for (const website of ["nike.com/golf", "https://nike.com/golf"]) {
			contexts.push(await buildAnalysisContext({ website }));
		}

		for (const ctx of contexts) {
			expect(ctx.analysisUrl).toBe("https://nike.com/golf");
			expect(ctx.website).toBe("nike.com");
			expect(ctx.prompt).toContain("not the site root");
		}
		expect(getWebsiteExcerpt).toHaveBeenCalledWith("https://nike.com/golf");
	});

	it("does not add the sub-page note for a site root, in either form", async () => {
		for (const website of ["nike.com", "www.nike.com", "https://nike.com/", "https://www.nike.com"]) {
			const ctx = await buildAnalysisContext({ website });

			expect(ctx.prompt).not.toContain("not the site root");
			expect(ctx.website).toBe("nike.com");
		}
	});

	it("normalizes brand fields, dedupes domains, and filters self-referential competitors", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: ["acme.co.uk", "ACME.COM", "acme.de"],
			// Aliases containing "Acme" are redundant under substring mention
			// matching; only "Globex Holdings" (a distinct parent) survives.
			aliases: ["Acme Inc", "acme inc", "Acme", "Globex Holdings"],
			competitors: [
				// Competitor alias "Globex Worldwide" contains the comp name → drop;
				// "GBX" stays because it doesn't contain "Globex".
				{ name: "Globex", domains: ["globex.com", "globex.de"], aliases: ["GBX", "Globex Worldwide"] },
				{ name: "Self Reference", domains: ["acme.com"], aliases: [] },
				{ name: "Bad Domain", domains: ["not a domain"], aliases: [] },
				{ name: "Globex Dup", domains: ["globex.com"], aliases: [] },
			],
			suggestedPrompts: [
				// Tags are now free-form / brand-tailored. Normalize step lowercases
				// + kebab-cases + dedupes + caps at 3 per prompt.
				{ prompt: "Best Widgets", tags: ["Industrial Supplies", "Manufacturing"], targetReference: "none" },
				{ prompt: "best widgets", tags: ["industrial-supplies"], targetReference: "none" }, // duplicate after lowercasing
				// Owner 2026-09-08: branded prompts ("acme …") are dropped by the
				// unbranded guard — keep the tag-cap case generic instead.
				{ prompt: "widget alternatives", tags: ["alternatives", "industrial supplies", "buying guide", "extra-tag"], targetReference: "none" },
			],
		});

		const result = await analyzeBrand({
			website: "https://www.acme.com",
			brandName: "Acme",
			maxCompetitors: 5,
			maxPrompts: 10,
		});

		expect(result.brandName).toBe("Acme");
		expect(result.website).toBe("acme.com");
		expect(result.additionalDomains).toEqual(["acme.co.uk", "acme.de"]);
		expect(result.aliases).toEqual(["Globex Holdings"]);

		expect(result.competitors).toHaveLength(1);
		expect(result.competitors[0]).toMatchObject({
			name: "Globex",
			domains: ["globex.com", "globex.de"],
			aliases: ["GBX"],
		});

		expect(result.suggestedPrompts).toEqual([
			{ prompt: "best widgets", tags: ["industrial-supplies", "manufacturing"] },
			{
				prompt: "widget alternatives",
				// "industrial supplies" → "industrial-supplies", capped at 3 (extra-tag dropped)
				tags: ["alternatives", "industrial-supplies", "buying-guide"],
			},
		]);
	});

	it("falls back to inferred brand name when LLM omits it", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		});

		const result = await analyzeBrand({ website: "nike.com" });
		const prompt = vi.mocked(runStructuredResearchPrompt).mock.calls[0]?.[0];

		expect(getWebsiteExcerpt).toHaveBeenCalledWith("https://nike.com/");
		expect(prompt).toContain("Analyze the brand at https://nike.com/.");
		expect(result.brandName).toBe("Nike");
	});

	it("respects maxCompetitors=0 / maxPrompts=0", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: [{ name: "Globex", domains: ["globex.com"], aliases: [] }],
			suggestedPrompts: [{ prompt: "best widgets", tags: ["best-of"] }],
		});

		const result = await analyzeBrand({
			website: "acme.com",
			maxCompetitors: 0,
			maxPrompts: 0,
		});
		expect(result.competitors).toEqual([]);
		expect(result.suggestedPrompts).toEqual([]);
	});

	it("caps competitors and prompts at the requested maxes", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: Array.from({ length: 20 }, (_, i) => ({
				name: `Comp ${i}`,
				domains: [`comp${i}.com`],
				aliases: [],
			})),
			suggestedPrompts: Array.from({ length: 50 }, (_, i) => ({
				prompt: `prompt ${i}`,
				tags: ["best-of"],
				targetReference: "none",
			})),
		});

		const result = await analyzeBrand({
			website: "acme.com",
			maxCompetitors: 3,
			maxPrompts: 5,
		});
		expect(result.competitors).toHaveLength(3);
		expect(result.suggestedPrompts).toHaveLength(5);
	});

	it("B05: 无语言参数时默认 zh，提示词包含中文输出要求；显式 en 时指定英文要求", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValue({
			brandName: "精工建",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		});

		// 默认缺省 language -> zh
		await analyzeBrand({ website: "szjgfw.com", brandName: "精工建" });
		const defaultPrompt = vi.mocked(runStructuredResearchPrompt).mock.calls[0]?.[0];
		expect(defaultPrompt).toContain("OUTPUT LANGUAGE REQUIREMENT: All outputs (summary, description, product line names, SKU oneLiner, suggestedPrompts, category, tags) MUST be in Simplified Chinese (简体中文)");

		// 显式 en
		vi.mocked(runStructuredResearchPrompt).mockClear();
		await analyzeBrand({ website: "szjgfw.com", brandName: "精工建", language: "en" });
		const enPrompt = vi.mocked(runStructuredResearchPrompt).mock.calls[0]?.[0];
		expect(enPrompt).toContain("OUTPUT LANGUAGE REQUIREMENT: All outputs must be in English");
	});

	it("B05: 中文标签与分类建议正确保留，category 转为 dim: 标签且不擦除中文字符", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "深圳市精工建轻钢房屋有限公司",
			additionalDomains: [],
			aliases: [],
			competitors: [
				{ name: "中建集成房屋", domains: ["cscec-ih.com"], aliases: ["中建集成"] },
				{ name: "远大住工", domains: ["bhome.com.cn"], aliases: [] },
			],
			productLines: [
				{
					name: "轻钢房屋",
					skus: [],
				},
				{
					name: "集装箱房",
					skus: [],
				},
			],
			suggestedPrompts: [
				{
					prompt: "轻钢别墅造价多少钱一平米",
					category: "轻钢房屋",
					tags: ["造价预算", "选型指南"],
					targetReference: "none",
				},
				{
					prompt: "工程营地集装箱房定做厂家",
					category: "集装箱房",
					tags: ["dim:集装箱房", "厂家定制"],
					targetReference: "none",
				},
				{
					prompt: "装配式建筑政策补贴标准",
					category: null,
					tags: ["政策解读"],
					targetReference: "none",
				},
				{
					prompt: "太空舱民宿设计规范",
					category: "dim:太空舱",
					tags: ["设计"],
					targetReference: "none",
				},
				{
					prompt: "集装箱活动房二手交易平台",
					category: "!!!",
					tags: ["二手交易"],
					targetReference: "none",
				},
			],
		});

		const result = await analyzeBrand({
			website: "szjgfw.com",
			brandName: "深圳市精工建轻钢房屋有限公司",
			language: "zh",
		});

		// 品牌名保持传入的中文名称
		expect(result.brandName).toBe("深圳市精工建轻钢房屋有限公司");

		// 中文竞品正常保留
		expect(result.competitors).toHaveLength(2);
		expect(result.competitors[0].name).toBe("中建集成房屋");
		expect(result.competitors[0].aliases).toEqual(["中建集成"]);

		// 提示词：通用品类名称（轻钢房屋）不导致“轻钢别墅造价多少钱一平米”被误杀
		expect(result.suggestedPrompts).toHaveLength(5);
		expect(result.suggestedPrompts[0].prompt).toBe("轻钢别墅造价多少钱一平米");
		// 校验 category 转换并前置为 dim:轻钢房屋
		expect(result.suggestedPrompts[0].tags).toEqual(["dim:轻钢房屋", "造价预算", "选型指南"]);

		// 已有 dim: 标签的不重复添加
		expect(result.suggestedPrompts[1].tags).toEqual(["dim:集装箱房", "厂家定制"]);

		// category 为 null 的保持普通标签，不硬塞默认分类
		expect(result.suggestedPrompts[2].tags).toEqual(["政策解读"]);

		// category 自身自带 dim: 前缀时，剥离冗余前缀后正确保持 dim:太空舱
		expect(result.suggestedPrompts[3].tags).toEqual(["dim:太空舱", "设计"]);

		// category 规整为空符号（如 !!!）时不产生无意义的 dim: 标签
		expect(result.suggestedPrompts[4].tags).toEqual(["二手交易"]);
	});

	it("B14-B: targetReference none keeps generic categories while brand/proprietary labels filter", async () => {
		const source = "空调和冰箱在此都是通用品类。";
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "美的",
			additionalDomains: [],
			aliases: ["美的集团", "Midea"],
			competitors: [{ name: "格力", domains: ["gree.com"], aliases: [] }],
			termAssessments: ["空调", "冰箱"].map((term) => ({
				term, kind: "generic", evidenceUrl: "https://midea.com/", evidenceQuote: source,
			})),
			productLines: [
				{ name: "空调", skus: [{ name: "空调", model: "空调", oneLiner: "", evidenceUrl: null }] },
				{ name: "冰箱", skus: [{ name: "冰箱", model: null, oneLiner: "", evidenceUrl: null }] },
				{ name: "空调型号", skus: [{ name: "KFR-35GW", model: null, oneLiner: "", evidenceUrl: null }] },
			],
			suggestedPrompts: [
				{ prompt: "空调哪个牌子好", category: "空调", tags: ["选购"], targetReference: "none" },
				{ prompt: "买冰箱选择什么品牌", category: "冰箱", tags: [], targetReference: "none" },
				{ prompt: "美的空调怎么样", category: "空调", tags: [], targetReference: "brand" },
				{ prompt: "KFR-35GW 适合多大面积", category: "空调", tags: [], targetReference: "proprietary" },
				{ prompt: "空调哪个牌子好", category: "空调", tags: [], targetReference: "none" },
				{ prompt: "", category: "空调", tags: [], targetReference: "none" },
			],
		});

		const result = await analyzeBrand({
			website: "midea.com", brandName: "美的集团（中国）", language: "zh",
			crawledPageTexts: new Map([["https://midea.com/", source]]),
		});

		expect(result.suggestedPrompts.map((p) => p.prompt)).toEqual(["空调哪个牌子好", "买冰箱选择什么品牌"]);
		expect(result.suggestedCategories).toEqual(["空调", "冰箱"]);
		expect(result.suggestedPromptsMeta).toEqual({
			generated: 6,
			kept: 2,
			filteredForBrandOrSku: 1,
			filteredForProprietary: 1,
			unconfirmed: 0,
			skippedDuplicateOrEmpty: 2,
			truncatedByCap: 0,
		});
		expect(result.suggestedPromptsExcluded).toEqual([
			{ prompt: "美的空调怎么样", targetReference: "brand", reason: "brandOrAlias" },
			{ prompt: "kfr-35gw 适合多大面积", targetReference: "proprietary", reason: "proprietary" },
		]);
	});

	it("B14-B: keeps the model's category when every prompt is filtered, and reports an empty generation", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "美的",
			additionalDomains: [],
			aliases: ["Midea"],
			competitors: [{ name: "格力", domains: ["gree.com"], aliases: [] }],
			productLines: [{ name: "空调", skus: [] }],
			suggestedPrompts: [{ prompt: "美的空调推荐", category: "空调", tags: [], targetReference: "brand" }],
		});
		const filtered = await analyzeBrand({ website: "midea.com", brandName: "美的", language: "zh" });
		expect(filtered.suggestedPrompts).toEqual([]);
		expect(filtered.suggestedCategories).toEqual(["空调"]);
		expect(filtered.suggestedPromptsMeta).toEqual({
			generated: 1,
			kept: 0,
			filteredForBrandOrSku: 1,
			filteredForProprietary: 0,
			unconfirmed: 0,
			skippedDuplicateOrEmpty: 0,
			truncatedByCap: 0,
		});

		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "美的",
			additionalDomains: [],
			aliases: [],
			competitors: [{ name: "格力", domains: ["gree.com"], aliases: [] }],
			productLines: [{ name: "空调", skus: [] }],
			suggestedPrompts: [],
		});
		const empty = await analyzeBrand({ website: "midea.com", brandName: "美的", language: "zh" });
		expect(empty.suggestedPrompts).toEqual([]);
		expect(empty.suggestedPromptsMeta).toEqual({
			generated: 0,
			kept: 0,
			filteredForBrandOrSku: 0,
			filteredForProprietary: 0,
			unconfirmed: 0,
			skippedDuplicateOrEmpty: 0,
			truncatedByCap: 0,
		});
	});

	it("B14-B: generic SKU names with none labels stay, proprietary labels filter regardless of glyphs", async () => {
		const source = "空调、3D打印机、USB集线器均为通用品类。";
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "华星设备",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			termAssessments: ["空调", "3D打印机", "USB集线器"].map((term) => ({
				term, kind: "generic", evidenceUrl: "https://example.invalid/", evidenceQuote: source,
			})),
			productLines: [
				{
					name: "设备",
					skus: [
						{ name: "空调", model: null, oneLiner: "", evidenceUrl: null },
						{ name: "星澜", model: null, oneLiner: "", evidenceUrl: null },
						{ name: "Orion", model: null, oneLiner: "", evidenceUrl: null },
						{ name: "3D打印机", model: null, oneLiner: "", evidenceUrl: null },
						{ name: "USB集线器", model: null, oneLiner: "", evidenceUrl: null },
					],
				},
			],
			suggestedPrompts: [
				{ prompt: "空调哪个牌子好", category: "设备", tags: [], targetReference: "none" },
				{ prompt: "星澜设备怎么样", category: "设备", tags: [], targetReference: "proprietary" },
				{ prompt: "orion设备怎么样", category: "设备", tags: [], targetReference: "proprietary" },
				{ prompt: "3d打印机哪个牌子好", category: "设备", tags: [], targetReference: "none" },
				{ prompt: "usb集线器哪个牌子好", category: "设备", tags: [], targetReference: "none" },
			],
		});

		const result = await analyzeBrand({
			website: "example.invalid", brandName: "华星设备", language: "zh",
			crawledPageTexts: new Map([["https://example.invalid/", source]]),
		});

		expect(result.suggestedPrompts.map((p) => p.prompt)).toEqual([
			"空调哪个牌子好",
			"3d打印机哪个牌子好",
			"usb集线器哪个牌子好",
		]);
		expect(result.suggestedPromptsMeta).toEqual({
			generated: 5,
			kept: 3,
			filteredForBrandOrSku: 0,
			filteredForProprietary: 2,
			unconfirmed: 0,
			skippedDuplicateOrEmpty: 0,
			truncatedByCap: 0,
		});
	});

	it("B14-B: missing or invalid targetReference stays unconfirmed instead of defaulting to none", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "华星设备",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			productLines: [{ name: "设备", skus: [] }],
			suggestedPrompts: [
				{ prompt: "空调哪个牌子好", category: "设备", tags: [] },
				{ prompt: "冰箱怎么选", category: "设备", tags: [], targetReference: "sometimes" },
				{ prompt: "洗衣机哪家好", category: "设备", tags: [], targetReference: "uncertain" },
			],
		});

		const result = await analyzeBrand({ website: "example.invalid", brandName: "华星设备", language: "zh" });

		expect(result.suggestedPrompts).toEqual([]);
		expect(result.suggestedPromptsMeta).toEqual({
			generated: 3,
			kept: 0,
			filteredForBrandOrSku: 0,
			filteredForProprietary: 0,
			unconfirmed: 3,
			skippedDuplicateOrEmpty: 0,
			truncatedByCap: 0,
		});
		expect(result.suggestedPromptsExcluded?.map((e) => e.reason)).toEqual([
			"missingOrInvalidTargetReference",
			"missingOrInvalidTargetReference",
			"uncertain",
		]);
	});

	it("protects an assessed proprietary model and leaves an unassessed name unconfirmed", async () => {
		vi.mocked(getWebsiteExcerpt).mockResolvedValueOnce(
			"华星设备官网：星澜系列与通用空调产品。KFR-35GW 是华星设备的专有型号。",
		);
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "华星设备",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			termAssessments: [{
				term: "KFR-35GW", kind: "proprietary", evidenceUrl: "https://example.invalid/",
				evidenceQuote: "KFR-35GW 是华星设备的专有型号。",
			}],
			productLines: [
				{
					name: "设备",
					skus: [
						{ name: "星澜", model: "KFR-35GW", oneLiner: "", evidenceUrl: "https://example.invalid/" },
					],
				},
			],
			suggestedPrompts: [
				{ prompt: "kfr-35gw 怎么样", category: "设备", tags: [], targetReference: "none" },
				{ prompt: "空调哪个牌子好", category: "设备", tags: [], targetReference: "none" },
				{ prompt: "星澜怎么样", category: "设备", tags: [], targetReference: "none" },
			],
		});

		const result = await analyzeBrand({ website: "example.invalid", brandName: "华星设备", language: "zh" });

		expect(result.suggestedPrompts.map((p) => p.prompt)).toEqual(["空调哪个牌子好"]);
		expect(result.suggestedPromptsMeta).toEqual({
			generated: 3,
			kept: 1,
			filteredForBrandOrSku: 0,
			filteredForProprietary: 1,
			unconfirmed: 1,
			skippedDuplicateOrEmpty: 0,
			truncatedByCap: 0,
		});
		expect(result.suggestedPromptsExcluded).toEqual([
			{ prompt: "kfr-35gw 怎么样", targetReference: "none", reason: "evidenceProprietary" },
			{ prompt: "星澜怎么样", targetReference: "none", reason: "unconfirmedTerm" },
		]);
	});

	it("B14-BPLAN-F01: a generic category name appearing on the official site is not proprietary proof", async () => {
		vi.mocked(getWebsiteExcerpt).mockResolvedValueOnce(
			"华星设备提供空调等通用品类。本文仅介绍通用空调的选购和使用，不声明任何专有系列或型号。",
		);
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "华星设备",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			termAssessments: [{
				term: "空调", kind: "generic", evidenceUrl: "https://example.invalid/",
				evidenceQuote: "华星设备提供空调等通用品类。",
			}],
			productLines: [
				{
					name: "设备",
					skus: [{ name: "空调", model: null, oneLiner: "", evidenceUrl: "https://example.invalid/" }],
				},
			],
			suggestedPrompts: [{ prompt: "空调哪个牌子好", category: "设备", tags: [], targetReference: "none" }],
		});

		const result = await analyzeBrand({ website: "example.invalid", brandName: "华星设备", language: "zh" });

		expect(result.suggestedPrompts.map((p) => p.prompt)).toEqual(["空调哪个牌子好"]);
		expect(result.suggestedPromptsMeta?.filteredForProprietary).toBe(0);
	});

	it("B14-BPLAN-F03: non-string targetReference is isolated as one unconfirmed row at the schema boundary", async () => {
		const ctx = await buildAnalysisContext({ website: "example.invalid", brandName: "华星设备", language: "zh" });
		for (const bad of [17, false, { value: "none" }]) {
			const parsed = ctx.schema.parse({
				brandName: "华星设备",
				additionalDomains: [],
				aliases: [],
				competitors: [{ name: "合成竞品", domains: [], aliases: [] }],
				summary: "合成品牌摘要",
				description: "合成品牌研究",
				productLines: [{ name: "设备", skus: [] }],
				suggestedPrompts: [
					{ prompt: "空调哪个牌子好", category: "设备", tags: [], targetReference: bad },
					{ prompt: "适合老年人的洗衣机怎么选", category: "设备", tags: [], targetReference: "none" },
				],
			});
			const result = normalizeAnalysisResult(parsed, ctx);
			expect(result.suggestedPrompts.map((p) => p.prompt)).toEqual(["适合老年人的洗衣机怎么选"]);
			expect(result.suggestedPromptsMeta?.unconfirmed).toBe(1);
			expect(result.competitors).toHaveLength(1);
		}
	});

	it("B14-B: a direct brand hit filters even when the model labels the prompt none", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "华星设备",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			productLines: [{ name: "设备", skus: [] }],
			suggestedPrompts: [{ prompt: "华星设备空调怎么样", category: "设备", tags: [], targetReference: "none" }],
		});

		const result = await analyzeBrand({ website: "example.invalid", brandName: "华星设备", language: "zh" });

		expect(result.suggestedPrompts).toEqual([]);
		expect(result.suggestedPromptsMeta?.filteredForBrandOrSku).toBe(1);
		expect(result.suggestedPromptsExcluded?.[0]?.reason).toBe("brandOrAlias");
	});
});
