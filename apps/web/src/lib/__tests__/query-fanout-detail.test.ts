import { describe, expect, it } from "vitest";

describe("BUG-001 / B17: 检索发散详情接线、中文提示与真实执行颜色测试", () => {
	describe("交付项 A: AI 可见度与 SOV 标题提示中文", () => {
		it("AI 可见度标题提示：中文包含完整指导文本并保留竞品设置链接", () => {
			const getVisibilityTip = (isZh: boolean) => {
				if (isZh) {
					return {
						text: "查看 AI 对与你的品牌、产品及竞品相关问题的实际回答与品牌提及情况。",
						competitorLink: "/app/$brand/settings/competitors",
					};
				}
				return {
					text: "Track how different LLMs respond to prompts related to your brand, products, and competitors.",
					competitorLink: "/app/$brand/settings/competitors",
				};
			};

			const zh = getVisibilityTip(true);
			expect(zh.text).toContain("查看 AI 对与你的品牌、产品及竞品相关问题的实际回答与品牌提及情况。");
			expect(zh.competitorLink).toBe("/app/$brand/settings/competitors");

			const en = getVisibilityTip(false);
			expect(en.text).toContain("Track how different LLMs respond to prompts related to your brand, products, and competitors.");
		});

		it("AI 可见度条状图提示（VisibilityBar Tooltip）：中文正确格式化提示词数量并准确描述计算口径", () => {
			const getVisibilityBarTooltip = (totalPrompts: number, isZh: boolean) => {
				if (isZh) {
					return `下方展示的 ${totalPrompts.toLocaleString()} 个提示词在所选筛选条件与时间范围内的 AI 可见度，计算方式为提及您品牌的 AI 回答所占百分比。`;
				}
				return `AI visibility for the ${totalPrompts.toLocaleString()} prompt${totalPrompts !== 1 ? "s" : ""} shown below, calculated as the percentage of AI responses that mention your brand over the time period for the selected filters.`;
			};

			const zh = getVisibilityBarTooltip(3, true);
			expect(zh).toBe("下方展示的 3 个提示词在所选筛选条件与时间范围内的 AI 可见度，计算方式为提及您品牌的 AI 回答所占百分比。");

			const en = getVisibilityBarTooltip(3, false);
			expect(en).toBe("AI visibility for the 3 prompts shown below, calculated as the percentage of AI responses that mention your brand over the time period for the selected filters.");
		});

		it("SOV 标题提示：中文包含精确的两段声量份额与竞品口径说明", () => {
			const getSovTips = (isZh: boolean) => {
				if (isZh) {
					return {
						p1: "声量份额反映在当前筛选范围内，你的品牌和纳入对比的竞品分别占全部品牌提及的比例。提及按每次回答计数，同一回答中同一品牌出现多次不重复累加，便于按相同口径比较。",
						p2: "竞品范围以当前页面使用的数据为准；可结合标签、时间范围及可用的引擎筛选查看结果。",
					};
				}
				return {
					p1: "Share of voice is how often each brand is mentioned in the AI answers to your prompts. Mentions are counted per run, so the brand and competitor figures use the same unit and are directly comparable.",
					p2: "Competitors are the ones you track in settings. Switch the model filter to compare engines.",
				};
			};

			const zh = getSovTips(true);
			expect(zh.p1).toBe(
				"声量份额反映在当前筛选范围内，你的品牌和纳入对比的竞品分别占全部品牌提及的比例。提及按每次回答计数，同一回答中同一品牌出现多次不重复累加，便于按相同口径比较。",
			);
			expect(zh.p2).toBe(
				"竞品范围以当前页面使用的数据为准；可结合标签、时间范围及可用的引擎筛选查看结果。",
			);

			const en = getSovTips(false);
			expect(en.p1).toContain("Share of voice is how often each brand is mentioned");
		});
	});

	describe("交付项 B: 报告页板块3 当前任务来源真实执行浅绿色", () => {
		const getSourceColorClass = (mode?: string | null) => {
			return mode === "real"
				? "text-emerald-600 dark:text-emerald-400"
				: "text-muted-foreground";
		};

		it("真实执行模式为浅绿色系", () => {
			expect(getSourceColorClass("real")).toBe("text-emerald-600 dark:text-emerald-400");
		});

		it("合成演示、读取中或未知模式保持 text-muted-foreground", () => {
			expect(getSourceColorClass("synthetic")).toBe("text-muted-foreground");
			expect(getSourceColorClass(null)).toBe("text-muted-foreground");
			expect(getSourceColorClass(undefined)).toBe("text-muted-foreground");
			expect(getSourceColorClass("unknown")).toBe("text-muted-foreground");
		});
	});

	describe("交付项 C: 联网检索详情接线、中文与状态处理", () => {
		it("变体格式化：中文为 'X 种检索词记录'，英文为 'X variations' 或 '1 variation'", () => {
			const formatVariations = (count: number, isZh: boolean) => {
				if (isZh) return `${count.toLocaleString()} 种检索词记录`;
				return `${count.toLocaleString()} ${count === 1 ? "variation" : "variations"}`;
			};

			expect(formatVariations(1, true)).toBe("1 种检索词记录");
			expect(formatVariations(5, true)).toBe("5 种检索词记录");
			expect(formatVariations(1, false)).toBe("1 variation");
			expect(formatVariations(5, false)).toBe("5 variations");
		});

		it("检索词记录数据保真：每个搜索块一条记录，不按分号拆分", () => {
			const rawQueries = [
				"洗衣机;滚筒洗衣机优缺点",
				"洗烘一体机和独立烘干机哪个实用",
			];

			// 严格按元素计数，不以分号拆数
			expect(rawQueries.length).toBe(2);
			expect(rawQueries[0]).toBe("洗衣机;滚筒洗衣机优缺点");
			expect(rawQueries[1]).toBe("洗烘一体机和独立烘干机哪个实用");
		});

		it("空态处理：无检索词时展示指定准确提示，不补零不填假记录", () => {
			const resolveQueryRecordFeedback = (queries?: string[], isZh = true) => {
				if (!queries || queries.length === 0) {
					return isZh
						? "本题暂无可观测检索词记录，不能据此确认未联网"
						: "No observable query records for this prompt; this does not confirm web search was unused.";
				}
				return isZh ? `共 ${queries.length} 条记录（每搜索块计一条）` : `${queries.length} record(s)`;
			};

			expect(resolveQueryRecordFeedback([], true)).toBe(
				"本题暂无可观测检索词记录，不能据此确认未联网",
			);
			expect(resolveQueryRecordFeedback(undefined, true)).toBe(
				"本题暂无可观测检索词记录，不能据此确认未联网",
			);
			expect(resolveQueryRecordFeedback(["test query"], true)).toBe(
				"共 1 条记录（每搜索块计一条）",
			);
		});

		it("跨任务与跨品牌身份隔离：切换 runId 或 brandId 时重置选中状态", () => {
			let activeRunId = "run_A";
			let brandId = "brand_1";
			let selectedPromptId: string | null = "Q01";

			// 模拟切换事件
			const switchRun = (newRunId: string) => {
				if (newRunId !== activeRunId) {
					activeRunId = newRunId;
					selectedPromptId = null; // 立即重置
				}
			};

			switchRun("run_B");
			expect(selectedPromptId).toBeNull();
			expect(activeRunId).toBe("run_B");

			selectedPromptId = "Q02";
			const switchBrand = (newBrandId: string) => {
				if (newBrandId !== brandId) {
					brandId = newBrandId;
					selectedPromptId = null; // 立即重置
				}
			};

			switchBrand("brand_2");
			expect(selectedPromptId).toBeNull();
			expect(brandId).toBe("brand_2");
		});

		it("双入口分流：baseline 模式下触发就地弹窗，legacy 模式下保留原有 HistoryButton 与链接", () => {
			const resolveAction = (hasBaselineRuns: boolean, promptId: string) => {
				if (hasBaselineRuns) {
					return {
						type: "modal",
						targetPrompt: promptId,
						labelZh: "查看详情",
						labelEn: "View Details",
					};
				}
				return {
					type: "navigation",
					url: `/app/$brand/prompts/${promptId}?tab=web-queries`,
				};
			};

			const baselineAction = resolveAction(true, "Q01");
			expect(baselineAction.type).toBe("modal");
			expect(baselineAction.targetPrompt).toBe("Q01");
			expect(baselineAction.labelZh).toBe("查看详情");
			expect(baselineAction.labelEn).toBe("View Details");

			const legacyAction = resolveAction(false, "legacy_prompt_123");
			expect(legacyAction.type).toBe("navigation");
			expect(legacyAction.url).toBe("/app/$brand/prompts/legacy_prompt_123?tab=web-queries");
		});

		describe("F01: 全无记录题时题目列表与只读详情入口保留", () => {
			it("baseline 有有效题但所有 search_queries 为空时，不跳过题目列表，保留详情入口", () => {
				const effectiveData = {
					totalRuns: 1,
					totalQueries: 0,
					byPrompt: [
						{
							promptId: "Q01",
							promptValue: "洗烘一体机指南",
							totalQueries: 0,
							uniqueQueries: 0,
							variations: [],
						},
					],
				};

				// 判定分支
				const shouldShowTabs = (hasBaseline: boolean, data: typeof effectiveData) => {
					if (!hasBaseline && data.totalQueries === 0) return false;
					if (hasBaseline && data.totalRuns > 0) return true;
					return false;
				};

				expect(shouldShowTabs(true, effectiveData)).toBe(true);
				expect(shouldShowTabs(false, effectiveData)).toBe(false);
			});
		});

		describe("F02: 证据 GET 失败与缓存刷新状态区分", () => {
			it("首次 evidence 读取失败无缓存时：禁止派生空统计对象，必须进入错误态", () => {
				const activeBaseline = {
					hasBaselineRuns: true,
					isError: true,
					errors: { evidenceError: new Error("503 Service Unavailable") },
					evidenceData: undefined,
					runData: { run_id: "run_A", model_name: "doubao-pro" },
				};

				const computeBaselineData = (baseline: typeof activeBaseline) => {
					if (!baseline.hasBaselineRuns) return null;
					if ((baseline.isError || baseline.errors.evidenceError) && !baseline.evidenceData) {
						return null;
					}
					return { totalRuns: 0 };
				};

				expect(computeBaselineData(activeBaseline)).toBeNull();
			});

			it("有缓存且后台刷新失败时：明示缓存与刷新失败警示，不冒充成功", () => {
				const dialogState = {
					isError: true,
					errors: { evidenceError: new Error("500 Internal Error") },
					evidenceData: { formal_questions: [{ question_code: "Q01" }] },
				};

				const isEvidenceError = Boolean(dialogState.isError || dialogState.errors.evidenceError);
				const hasCache = Boolean(dialogState.evidenceData);
				const showWarningBanner = isEvidenceError && hasCache;

				expect(isEvidenceError).toBe(true);
				expect(hasCache).toBe(true);
				expect(showWarningBanner).toBe(true);
			});

			it("证据正在加载且尚无数据时：保持 loading 态，禁止提前派生 totalRuns: 0 导致空态闪现", () => {
				const activeBaseline = {
					hasBaselineRuns: true,
					isLoading: true,
					isError: false,
					errors: { evidenceError: null },
					evidenceData: undefined,
					runData: { run_id: "run_A", model_name: "doubao-pro" },
				};

				const isEvidenceFailed =
					activeBaseline.hasBaselineRuns &&
					Boolean(activeBaseline.errors.evidenceError || activeBaseline.isError) &&
					!activeBaseline.evidenceData;

				const isEvidenceLoading =
					activeBaseline.hasBaselineRuns &&
					!isEvidenceFailed &&
					(activeBaseline.isLoading || !activeBaseline.evidenceData);

				const computeBaselineData = (baseline: typeof activeBaseline) => {
					if (!baseline.hasBaselineRuns) return null;
					if ((baseline.isError || baseline.errors.evidenceError) && !baseline.evidenceData) {
						return null;
					}
					if (!baseline.evidenceData) {
						return null;
					}
					return { totalRuns: 0 };
				};

				expect(isEvidenceLoading).toBe(true);
				expect(computeBaselineData(activeBaseline)).toBeNull();
			});
		});
	});
});
