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
					skippedDuplicateOrEmpty: 0,
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
			skippedDuplicateOrEmpty: 0,
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
				meta: { generated: 0, kept: 0, filteredForBrandOrSku: 0, skippedDuplicateOrEmpty: 0 },
			}),
		).toContain("未返回建议问题");

		expect(
			buildPromptNotice({
				language: "zh",
				promptCount: 0,
				meta: { generated: 3, kept: 0, filteredForBrandOrSku: 3, skippedDuplicateOrEmpty: 0 },
			}),
		).toContain("均因包含品牌名");

		expect(
			buildPromptNotice({
				language: "zh",
				promptCount: 1,
				meta: { generated: 3, kept: 2, filteredForBrandOrSku: 1, skippedDuplicateOrEmpty: 0 },
			}),
		).toContain("过滤 1 条");
	});
});