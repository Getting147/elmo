import { describe, expect, it } from "vitest";
import type { ResearchDraftPayload } from "@/lib/brand-research-client";
import { buildPromptNotice, collectCategoryOptions, suggestionToWizardData } from "./prompt-wizard";

function suggestion(overrides: Partial<ResearchDraftPayload> = {}): ResearchDraftPayload {
	return {
		brandName: "美的",
		website: "https://midea.com",
		additionalDomains: [],
		aliases: ["Midea"],
		competitors: [],
		suggestedPrompts: [],
		productLines: { confirmed: [], unverified: [] },
		...overrides,
	};
}

describe("B14 prompt suggestions and category candidates", () => {
	it("keeps model categories and draft metadata when mapping to the wizard", () => {
		const data = suggestionToWizardData(
			suggestion({
				suggestedPrompts: [{ prompt: "空调哪个牌子好", tags: ["dim:空调"] }],
				suggestedCategories: ["冰箱"],
				suggestedPromptsMeta: {
					generated: 2,
					kept: 1,
					filteredForBrandOrSku: 1,
					filteredForProprietary: 0,
					unconfirmed: 0,
					skippedDuplicateOrEmpty: 0,
					truncatedByCap: 0,
				},
			}),
			"美的",
			"https://midea.com",
		);

		expect(data.suggestedCategories).toEqual(["冰箱"]);
		expect(data.suggestedPromptsMeta).toEqual({
			generated: 2,
			kept: 1,
			filteredForBrandOrSku: 1,
			filteredForProprietary: 0,
			unconfirmed: 0,
			skippedDuplicateOrEmpty: 0,
			truncatedByCap: 0,
		});
	});

	it("offers categories from unverified business lines and model classifications without confirmed SKUs", () => {
		const options = collectCategoryOptions({
			productLines: [], // no confirmed product lines / SKUs
			unverifiedLines: [{ name: "空调" }, { name: "冰箱" }],
			suggestedCategories: ["洗衣机", "冰箱"],
			prompts: [{ tags: ["dim:厨房电器", "选购"] }],
		});

		expect(options).toEqual(["空调", "冰箱", "洗衣机", "厨房电器"]);
	});

	it("explains model-empty, all-filtered and partially-filtered prompt lists", () => {
		expect(buildPromptNotice({ language: "zh", promptCount: 0 })).toContain("暂无建议问题");

		expect(
			buildPromptNotice({
				language: "zh",
				promptCount: 0,
				meta: {
					generated: 0,
					kept: 0,
					filteredForBrandOrSku: 0,
					filteredForProprietary: 0,
					unconfirmed: 0,
					skippedDuplicateOrEmpty: 0,
					truncatedByCap: 0,
				},
			}),
		).toContain("未返回建议问题");

		expect(
			buildPromptNotice({
				language: "zh",
				promptCount: 0,
				meta: {
					generated: 3,
					kept: 0,
					filteredForBrandOrSku: 3,
					filteredForProprietary: 0,
					unconfirmed: 0,
					skippedDuplicateOrEmpty: 0,
					truncatedByCap: 0,
				},
			}),
		).toContain("均因包含品牌名");

		expect(
			buildPromptNotice({
				language: "zh",
				promptCount: 1,
				meta: {
					generated: 3,
					kept: 2,
					filteredForBrandOrSku: 1,
					filteredForProprietary: 0,
					unconfirmed: 0,
					skippedDuplicateOrEmpty: 0,
					truncatedByCap: 0,
				},
			}),
		).toContain("过滤 1 条");
	});

	it("B14-R01-F02: mixed empty results report each known cause by its real count", () => {
		const zh = buildPromptNotice({
			language: "zh",
			promptCount: 0,
			meta: {
				generated: 2,
				kept: 0,
				filteredForBrandOrSku: 1,
				filteredForProprietary: 0,
				unconfirmed: 0,
				skippedDuplicateOrEmpty: 1,
				truncatedByCap: 0,
			},
		});
		expect(zh).toContain("1 条因包含品牌名或别名被防引导规则过滤");
		expect(zh).toContain("1 条为空或重复");
		expect(zh).not.toContain("均因");

		const en = buildPromptNotice({
			language: "en",
			promptCount: 0,
			meta: {
				generated: 2,
				kept: 0,
				filteredForBrandOrSku: 1,
				filteredForProprietary: 0,
				unconfirmed: 0,
				skippedDuplicateOrEmpty: 1,
				truncatedByCap: 0,
			},
		});
		expect(en).toContain("1 were filtered for naming the brand or an alias");
		expect(en).toContain("1 were empty or duplicates");
		expect(en).not.toContain("all were filtered");
	});

	it("B14-B: unconfirmed and proprietary counts are reported separately, never as brand filtering", () => {
		const zh = buildPromptNotice({
			language: "zh",
			promptCount: 0,
			meta: {
				generated: 3,
				kept: 0,
				filteredForBrandOrSku: 0,
				filteredForProprietary: 1,
				unconfirmed: 2,
				skippedDuplicateOrEmpty: 0,
				truncatedByCap: 0,
			},
		});
		expect(zh).toContain("1 条因指向专有产品、系列或型号被过滤");
		expect(zh).toContain("2 条指向未确认");
		expect(zh).not.toContain("均因包含品牌名");

		const partial = buildPromptNotice({
			language: "zh",
			promptCount: 2,
			meta: {
				generated: 4,
				kept: 2,
				filteredForBrandOrSku: 1,
				filteredForProprietary: 0,
				unconfirmed: 1,
				skippedDuplicateOrEmpty: 0,
				truncatedByCap: 0,
			},
		});
		expect(partial).toContain("已按防引导规则过滤 1 条");
		expect(partial).toContain("另有 1 条指向未确认未自动纳入");
	});
});