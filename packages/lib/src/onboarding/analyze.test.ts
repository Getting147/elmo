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
import { analyzeBrand, buildAnalysisContext } from "./analyze";
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
				{ prompt: "Best Widgets", tags: ["Industrial Supplies", "Manufacturing"] },
				{ prompt: "best widgets", tags: ["industrial-supplies"] }, // duplicate after lowercasing
				// Owner 2026-09-08: branded prompts ("acme …") are dropped by the
				// unbranded guard — keep the tag-cap case generic instead.
				{ prompt: "widget alternatives", tags: ["alternatives", "industrial supplies", "buying guide", "extra-tag"] },
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
				},
				{
					prompt: "工程营地集装箱房定做厂家",
					category: "集装箱房",
					tags: ["dim:集装箱房", "厂家定制"],
				},
				{
					prompt: "装配式建筑政策补贴标准",
					category: null,
					tags: ["政策解读"],
				},
				{
					prompt: "太空舱民宿设计规范",
					category: "dim:太空舱",
					tags: ["设计"],
				},
				{
					prompt: "集装箱活动房二手交易平台",
					category: "!!!",
					tags: ["二手交易"],
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
});
