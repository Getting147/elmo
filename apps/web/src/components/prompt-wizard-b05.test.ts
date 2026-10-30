import { describe, expect, it } from "vitest";
import { suggestionToWizardData } from "./prompt-wizard";
import { getPromptCategory, setPromptCategory } from "./prompts-list-editor";
import type { ResearchDraftPayload } from "@/lib/brand-research-client";

describe("B05 中文调研与分类体验前端逻辑测试", () => {
	describe("suggestionToWizardData (走查 04: 用户品牌名保护)", () => {
		it("优先保留用户输入的原始品牌名，不被模型推测的英文名覆盖", () => {
			const suggestion: ResearchDraftPayload = {
				brandName: "zhejiang jike intelligent equipment",
				website: "https://zjjk.com",
				aliases: ["Jike"],
				additionalDomains: [],
				competitors: [{ name: "远大住工", domains: ["bhome.com.cn"], aliases: [] }],
				suggestedPrompts: [
					{ prompt: "轻钢别墅造价大概多少一平米？", tags: ["dim:轻钢房屋", "造价"] },
				],
				summary: "模块化房屋智造商",
				description: "集成房屋制造与设计",
				productLines: {
					confirmed: [
						{
							line: {
								name: "轻钢房屋",
								skus: [
									{
										name: "JK-100 轻钢别墅",
										model: "JK-100",
										oneLiner: "抗震节能整体装配式建筑",
										evidenceUrl: "https://zjjk.com/jk100",
									},
								],
							},
							sourceEvidenceChecked: 0,
						},
					],
					unverified: [],
				},
			};

			const wizardData = suggestionToWizardData(suggestion, "浙江集客", "https://zjjk.com");

			// 验证用户在创建品牌时输入的中文名被坚决保留
			expect(wizardData.brandName).toBe("浙江集客");
			expect(wizardData.website).toBe("https://zjjk.com");
			expect(wizardData.prompts).toHaveLength(1);
			expect(wizardData.prompts[0].value).toBe("轻钢别墅造价大概多少一平米？");
			expect(wizardData.prompts[0].tags).toEqual(["dim:轻钢房屋", "造价"]);
			expect(wizardData.productLines).toHaveLength(1);
			expect(wizardData.productLines[0].name).toBe("轻钢房屋");
		});

		it("当用户未提供 fallback 时，安全采纳 suggestion.brandName", () => {
			const suggestion: ResearchDraftPayload = {
				brandName: "极空间",
				website: "https://zspace.cn",
				aliases: [],
				additionalDomains: [],
				competitors: [],
				suggestedPrompts: [],
			};

			const wizardData = suggestionToWizardData(suggestion, "", "https://zspace.cn");
			expect(wizardData.brandName).toBe("极空间");
		});
	});

	describe("业务分类标签管理 (getPromptCategory / setPromptCategory)", () => {
		it("正确识别提取 dim: 或 cat: 前缀的分类", () => {
			expect(getPromptCategory(["unbranded", "dim:移动太空舱", "价格"])).toBe("移动太空舱");
			expect(getPromptCategory(["cat:折叠集装箱房"])).toBe("折叠集装箱房");
			expect(getPromptCategory(["unbranded", "价格"])).toBe("");
			expect(getPromptCategory([])).toBe("");
		});

		it("设置分类时保持非分类标签不变并替换或新增 dim: 标签", () => {
			// 新增分类
			const tags1 = setPromptCategory(["unbranded", "性价比"], "轻钢房屋");
			expect(tags1).toEqual(["unbranded", "性价比", "dim:轻钢房屋"]);

			// 修改已有分类
			const tags2 = setPromptCategory(["unbranded", "dim:旧分类", "性价比"], "新分类");
			expect(tags2).toEqual(["unbranded", "性价比", "dim:新分类"]);

			// 清除分类
			const tags3 = setPromptCategory(["unbranded", "dim:旧分类", "cat:历史旧分类"], "");
			expect(tags3).toEqual(["unbranded"]);

			// 输入自带 dim: 或 cat: 前缀时，剥离冗余前缀，防止生成 dim:dim: 脏数据
			const tags4 = setPromptCategory(["unbranded"], "dim:集成房屋");
			expect(tags4).toEqual(["unbranded", "dim:集成房屋"]);

			const tags5 = setPromptCategory(["unbranded"], "cat: 钢结构 ");
			expect(tags5).toEqual(["unbranded", "dim:钢结构"]);
		});

		it("getPromptCategory 正确兼容剥离多重或历史前缀与首尾空格", () => {
			expect(getPromptCategory(["dim:dim:轻钢房屋"])).toBe("轻钢房屋");
			expect(getPromptCategory(["cat:  模块化建筑  "])).toBe("模块化建筑");
		});
	});
});
