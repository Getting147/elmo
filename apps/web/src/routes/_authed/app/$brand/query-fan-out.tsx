/**
 * /app/$brand/query-fan-out - Query Fan-Out
 *
 * "What are the answer engines really searching for?" When an engine answers a
 * tracked prompt it may run several web searches first. KPIs summarize how much
 * prompts expand, then three tabs: Prompt Fan-Out (each prompt's searches, with
 * its keywords bolded), Query Words (the cloud + which words engines add/drop/keep),
 * and Query Visibility (searches you're missing vs win).
 *
 * Read-only from `prompt_runs.web_queries`; engines that don't expose their
 * searches contribute runs but no queries. See `server/query-fanout.ts` and
 * `lib/fanout-analysis.ts`.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { cn } from "@workspace/ui/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { Input } from "@workspace/ui/components/input";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { IconChevronDown, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { getModelDisplayName } from "@/lib/utils";
import { usePromptsSummary } from "@/hooks/use-prompts-summary";
import { useQueryFanout } from "@/hooks/use-query-fanout";
import { PageHeader, FilterSection } from "@/components/page-header";
import { FilterBar, getAvailableModels, ALL_MODELS_VALUE } from "@/components/filter-bar";
import { useListFilters } from "@/hooks/use-list-filters";
import { useBrand } from "@/hooks/use-brands";
import { HistoryButton } from "@/components/history-button";
import { InfoTip, QueryWordsSection, VariationLine } from "@/components/fanout-sections";
import { promptKeywords, type PromptFanoutStat, type TopQueryStat, type QueryPromptRef, type FanoutQueryStat } from "@/lib/fanout-analysis";
import { useActiveBaselineRun } from "@/hooks/use-active-baseline-run";
import { DiagnosisRunBanner } from "@/components/diagnosis-run-banner";
import { useLanguage } from "@/lib/language-context";
import {
	getBaselineModelAliases,
	getBaselineModelOptions,
	isBaselineModelMismatch,
	isUnsupportedBaselineModel,
	isRunWithinLookback,
	isModelMatch,
} from "@/lib/model-filter";
import { UnsupportedModelNotice } from "@/components/unsupported-model-notice";
import { BaselineModelMismatchNotice } from "@/components/baseline-model-mismatch-notice";
import { effectiveQueryQuestions } from "@/lib/baseline-query-observations";
import { IconAlertCircle } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@workspace/ui/components/dialog";
import { GoStack } from "react-icons/go";
import { formatBeijingTime } from "@/lib/baseline-task-name";

/** The active tab lives in `?tab=` so each tab is directly linkable. */
const FANOUT_TABS = ["fanout", "top-queries", "words"] as const;
type FanoutTab = (typeof FANOUT_TABS)[number];

export const Route = createFileRoute("/_authed/app/$brand/query-fan-out")({
	validateSearch: (search: Record<string, unknown>): { tab?: FanoutTab } => ({
		tab: FANOUT_TABS.includes(search.tab as FanoutTab) ? (search.tab as FanoutTab) : undefined,
	}),
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Query Fan-Out", { appName, brandName }) },
				{
					name: "description",
					content:
						"See the web searches AI engines run when answering your prompts, and how they rewrite your wording.",
				},
			],
		};
	},
	component: QueryFanoutPage,
});

function QueryFanoutPage() {
	const { brand: brandId } = Route.useParams();
	const { model, lookback, tags, setFilters } = useListFilters();
	const { language } = useLanguage();
	const isZh = language === "zh";

	const tab = Route.useSearch({ select: (s) => s.tab ?? "fanout" });
	const navigate = Route.useNavigate();
	const setTab = (next: FanoutTab) =>
		navigate({
			search: (prev) => ({ ...prev, tab: next === "fanout" ? undefined : next }),
			replace: true,
			resetScroll: false,
		});

	const { brand } = useBrand(brandId);
	const activeBaseline = useActiveBaselineRun(brandId);
	const availableModels = getAvailableModels(brand?.effectiveModels ?? []);
	const modelParam = model === ALL_MODELS_VALUE ? undefined : model;

	const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);

	// 切换 run 或 brand 时立即重置详情选择，防止跨任务数据串用
	useEffect(() => {
		setSelectedPromptId(null);
	}, [activeBaseline.activeRunId, brandId]);

	const { promptsSummary } = usePromptsSummary(brandId, { lookback, model: modelParam });
	const availableTags = promptsSummary?.availableTags ?? [];

	const { data, isLoading, isError } = useQueryFanout(brandId, {
		lookback,
		tags,
		model: modelParam,
	});

	// Compute baseline query fan-out data when baseline run is active
	const baselineData = useMemo(() => {
		if (!activeBaseline.hasBaselineRuns) return null;
		const { runData, metricsData, evidenceData } = activeBaseline;

		// 若 evidence 读取出错且当前没有 evidenceData，返回 null 触发错误态展示，避免派生出空统计对象误报为“无评测任务”
		if ((activeBaseline.isError || activeBaseline.errors.evidenceError) && !evidenceData) {
			return null;
		}

		// 若 evidence 仍在加载且尚无数据，返回 null 避免提前派生出 totalRuns: 0 闪现空态
		if (!evidenceData) {
			return null;
		}

		const modelName = runData?.model_name?.trim() || "";

		// Model filter check
		if (!isModelMatch(model, modelName)) {
			return {
				brandName: brand?.name || "Target Brand",
				model: modelName,
				totalRuns: 0,
				totalQueries: 0,
				uniqueQueries: 0,
				fanoutRuns: 0,
				avgPerExecution: 0,
				coverageRate: 0,
				byPrompt: [],
				topQueries: [],
				topByPrompts: [],
				topByRuns: [],
				terms: [],
				wordChanges: { added: [], dropped: [], preserved: [] },
				byModel: [],
			};
		}

		// Lookback filter check
		if (!isRunWithinLookback(runData?.completed_at || runData?.created_at, lookback)) {
			return {
				brandName: brand?.name || "Target Brand",
				model: modelName,
				totalRuns: 0,
				totalQueries: 0,
				uniqueQueries: 0,
				fanoutRuns: 0,
				avgPerExecution: 0,
				coverageRate: 0,
				byPrompt: [],
				topQueries: [],
				topByPrompts: [],
				topByRuns: [],
				terms: [],
				wordChanges: { added: [], dropped: [], preserved: [] },
				byModel: [],
			};
		}

		const formalQuestions: any[] = evidenceData?.formal_questions || [];
		const matchingQuestions = effectiveQueryQuestions(
			formalQuestions, metricsData?.sample_summary?.zero_effective_questions, tags,
		);

		let totalQueries = 0;
		const byPrompt: PromptFanoutStat[] = [];
		const queryMap = new Map<string, { query: string; prompts: Set<string>; runs: number; promptRefs: Map<string, QueryPromptRef> }>();

		for (const q of matchingQuestions) {
			const queries: string[] = Array.isArray(q.search_queries) ? q.search_queries : [];
			totalQueries += queries.length;

			const variations: FanoutQueryStat[] = queries.map((sq) => ({
				query: sq,
				count: 1,
				brandMentionRate: q.effective_mention ? 100 : 0,
			}));

			const promptStat: PromptFanoutStat = {
				promptId: q.question_code || q.question_id || q.question_text,
				promptValue: q.question_text || "",
				totalQueries: queries.length,
				uniqueQueries: new Set(queries).size,
				runs: 1,
				avgPerExecution: queries.length,
				variations,
			};
			byPrompt.push(promptStat);

			for (const sq of queries) {
				let item = queryMap.get(sq);
				if (!item) {
					item = { query: sq, prompts: new Set(), runs: 0, promptRefs: new Map() };
					queryMap.set(sq, item);
				}
				item.prompts.add(promptStat.promptId);
				item.runs += 1;
				let ref = item.promptRefs.get(promptStat.promptId);
				if (!ref) {
					ref = { promptId: promptStat.promptId, promptValue: promptStat.promptValue, runs: 0 };
					item.promptRefs.set(promptStat.promptId, ref);
				}
				ref.runs += 1;
			}
		}

		const topQueries: TopQueryStat[] = Array.from(queryMap.values()).map((item) => ({
			query: item.query,
			prompts: item.prompts.size,
			runs: item.runs,
			promptRefs: Array.from(item.promptRefs.values()).sort((a, b) => b.runs - a.runs),
		})).sort((a, b) => b.runs - a.runs);

		const effectiveRunsCount = matchingQuestions.length;
		const fanoutRuns = byPrompt.filter((p) => p.totalQueries > 0).length;
		const uniqueQueries = queryMap.size;
		const avgPerExecution = fanoutRuns > 0 ? +(totalQueries / fanoutRuns).toFixed(1) : 0;
		const coverageRate = effectiveRunsCount > 0 ? +(fanoutRuns / effectiveRunsCount).toFixed(2) : 0;
		const topByPrompts = [...topQueries].sort((a, b) => b.prompts - a.prompts);
		const topByRuns = [...topQueries].sort((a, b) => b.runs - a.runs);

		return {
			brandName: brand?.name || "Target Brand",
			model: modelName,
			totalRuns: effectiveRunsCount,
			totalQueries,
			uniqueQueries,
			fanoutRuns,
			avgPerExecution,
			coverageRate,
			byPrompt,
			topQueries,
			topByPrompts,
			topByRuns,
			terms: [],
			wordChanges: { added: [], dropped: [], preserved: [] },
			byModel: modelName
				? [
						{
							model: modelName,
							runs: effectiveRunsCount,
							fanoutRuns,
							totalQueries,
							avgPerExecution,
							topQueries: topQueries.map((t) => ({ query: t.query, count: t.runs, brandMentionRate: 0 })),
						},
					]
				: [],
		};
	}, [activeBaseline, brand?.name, tags, model, lookback]);

	const baselineTags = useMemo(() => {
		const rawFormal = activeBaseline.evidenceData?.formal_questions;
		const rawQuestions: any[] = rawFormal || activeBaseline.metricsData?.questions?.filter((q: any) => !q.is_probe) || [];
		const set = new Set<string>();
		for (const q of rawQuestions) {
			if (q.dimension_name) set.add(q.dimension_name);
		}
		return Array.from(set);
	}, [activeBaseline.evidenceData?.formal_questions, activeBaseline.metricsData?.questions]);

	const baselineRunModel = activeBaseline.runData?.model_name?.trim() || "";
	const baselineModels = useMemo(
		() => getBaselineModelOptions(baselineRunModel),
		[baselineRunModel],
	);
	const baselineModelAliases = useMemo(
		() => getBaselineModelAliases(baselineRunModel),
		[baselineRunModel],
	);

	const effectiveData = activeBaseline.hasBaselineRuns ? baselineData : data;
	const effectiveTags = activeBaseline.hasBaselineRuns ? baselineTags : availableTags;
	const effectiveModels = activeBaseline.hasBaselineRuns ? baselineModels : availableModels;
	const effectiveModelAliases = activeBaseline.hasBaselineRuns ? baselineModelAliases : undefined;
	const isEvidenceFailed = activeBaseline.hasBaselineRuns && Boolean(activeBaseline.errors.evidenceError || activeBaseline.isError) && !activeBaseline.evidenceData;
	const isEvidenceLoading = activeBaseline.hasBaselineRuns && !isEvidenceFailed && !activeBaseline.isRequestedRunMissing && (activeBaseline.isLoading || !activeBaseline.evidenceData);
	const effectiveLoading = activeBaseline.isLoadingRunsList || (activeBaseline.hasBaselineRuns
		? isEvidenceLoading
		: isLoading && !data);
	const effectiveError = activeBaseline.hasBaselineRuns
		? Boolean(activeBaseline.isError || activeBaseline.errors.evidenceError)
		: isError;

	const infoContent = (
		<p>
			{isZh
				? "当具备联网搜索能力的 AI 模型在回答评测问题时，可能会在生成回答前发起多次网络检索。这些底层的网络检索词仅在部分模型中可获取。"
				: "When an AI engine with web search capabilities responds to a prompt, it may choose to make a number of web searches before creating its answer. These underlying web searches, or web queries, are only available for some engines."}
		</p>
	);

	const isFilteredOut =
		tags.length > 0 ||
		(activeBaseline.hasBaselineRuns &&
			!isRunWithinLookback(
				activeBaseline.runData?.completed_at || activeBaseline.runData?.created_at,
				lookback,
			));

	let content: React.ReactNode;
	if (activeBaseline.isRequestedRunMissing) {
		content = (
			<Card className="border border-destructive/40 shadow-sm bg-rose-50/20 dark:bg-rose-950/20">
				<CardContent className="py-10 px-6 text-center space-y-4">
					<div className="size-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
						<IconAlertCircle size={24} />
					</div>
					<div className="space-y-1.5 max-w-md mx-auto">
						<h3 className="text-base font-semibold text-foreground">
							{isZh ? "指定的诊断任务不存在或无权访问" : "Diagnostic Run Not Found or Access Denied"}
						</h3>
						<p className="text-sm text-muted-foreground leading-relaxed">
							{isZh
								? `URL 指定的任务编号 (${activeBaseline.requestedRunId || activeBaseline.activeRunId}) 未在当前品牌记录中找到，系统已严格阻断任务替换。`
								: `The requested task was not found or access is denied.`}
						</p>
					</div>
					{activeBaseline.runsList.length > 0 && (
						<div className="pt-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => activeBaseline.selectRun(activeBaseline.runsList[0].run_id)}
							>
								{isZh ? "切换至最近一次诊断任务" : "Switch to Latest Run"}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		);
	} else if (isUnsupportedBaselineModel(model)) {
		content = <UnsupportedModelNotice />;
	} else if (effectiveLoading) {
		content = <LoadingState />;
	} else if (isEvidenceFailed || (effectiveError && !effectiveData)) {
		content = (
			<EmptyState
				message={
					isZh
						? "读取本轮检索词归档失败，请刷新页面重试。"
						: "Failed to load query fan-out archive. Please reload the page to try again."
				}
			/>
		);
	} else if (activeBaseline.runData && isBaselineModelMismatch(model, baselineRunModel)) {
		content = (
			<BaselineModelMismatchNotice
				runModel={baselineRunModel}
				selectedModel={model}
				onClearModel={() => setFilters({ model: undefined })}
			/>
		);
	} else if (isFilteredOut && (!effectiveData || effectiveData.totalRuns === 0)) {
		content = (
			<EmptyState
				message={
					isZh
						? "当前筛选无结果"
						: "No results for the selected filters."
				}
			/>
		);
	} else if (!effectiveData || effectiveData.totalRuns === 0) {
		content = (
			<EmptyState
				message={
					isZh
						? "当前筛选条件下无启用联网搜索的评测任务。评测任务启用联网后将在此展现。"
						: "No runs with web search enabled for the selected filters. Fan-out appears once your prompts have been run by an engine with web search."
				}
			/>
		);
	} else if (!activeBaseline.hasBaselineRuns && effectiveData.totalQueries === 0) {
		content = (
			<TooltipProvider delayDuration={150}>
				<div className="space-y-6">
					<StatRow data={effectiveData as any} baseline={activeBaseline.hasBaselineRuns} />
					<EmptyState
						message={
							isZh
								? "当前有效正式题未提供可观测检索词记录；检索次数及平均值未知，不代表未搜索或免费。"
								: "No observable query records for the effective formal samples; search counts and averages are unknown, not zero or free."
						}
					/>
				</div>
			</TooltipProvider>
		);
	} else {
		content = (
			<TooltipProvider delayDuration={150}>
				<div className="space-y-6">
					{/* 后台刷新失败但当前保留有有效缓存记录时的警示条 */}
					{effectiveError && effectiveData && (
						<div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2" role="alert">
							<IconAlertCircle className="size-4 shrink-0" />
							<span>
								{isZh
									? "后台刷新检索词归档失败，当前展示为本地缓存记录；请刷新重试。"
									: "Failed to refresh query archive in background; currently displaying cached data. Please reload the page."}
							</span>
						</div>
					)}
					<StatRow data={effectiveData as any} baseline={activeBaseline.hasBaselineRuns} />
					{/* Baseline 模式下，若全部有效题均未提供检索词，展示全局未知说明，不阻断下方题目列表 */}
					{activeBaseline.hasBaselineRuns && effectiveData.totalQueries === 0 && (
						<div className="rounded-lg border border-border/80 bg-muted/40 p-3 text-xs text-muted-foreground flex items-center gap-2">
							<IconAlertCircle className="size-4 shrink-0 text-muted-foreground" />
							<span>
								{isZh
									? "当前有效正式题未提供可观测检索词记录；检索次数及平均值未知，不代表未搜索或免费。"
									: "No observable query records for the effective formal samples; search counts and averages are unknown, not zero or free."}
							</span>
						</div>
					)}
					<Tabs value={tab} onValueChange={(v) => setTab(v as FanoutTab)} className="gap-4">
						<TabsList>
							<TabsTrigger value="fanout">{isZh ? "问题发散明细 (Prompt Fan-Out)" : "Prompt Fan-Out"}</TabsTrigger>
							<TabsTrigger value="top-queries">{isZh ? "高频检索词 (Top Queries)" : "Top Queries"}</TabsTrigger>
							{!activeBaseline.hasBaselineRuns && <TabsTrigger value="words">Query Words</TabsTrigger>}
						</TabsList>
						<TabsContent value="fanout">
							<Prompts
								prompts={effectiveData.byPrompt}
								brandId={brandId}
								hasBaselineRuns={activeBaseline.hasBaselineRuns}
								onOpenDetail={setSelectedPromptId}
							/>
						</TabsContent>
						<TabsContent value="top-queries">
							<TopQueries
								data={effectiveData as any}
								brandId={brandId}
								hasBaselineRuns={activeBaseline.hasBaselineRuns}
								onOpenDetail={setSelectedPromptId}
							/>
						</TabsContent>
						{!activeBaseline.hasBaselineRuns && (
							<TabsContent value="words">
								<QueryWordsSection terms={effectiveData.terms} wordChanges={effectiveData.wordChanges} />
							</TabsContent>
						)}
					</Tabs>
				</div>
			</TooltipProvider>
		);
	}

	return (
		<PageHeader
			title={isZh ? "联网检索发散" : "Query Fan-Out"}
			subtitle={
				isZh
					? "查看 AI 回答问题时可观测到的联网检索词，为内容选题提供线索；不代表完整检索过程或计费次数。"
					: "Observable query records: one query text per search block, not provider billable tool calls."
			}
			infoContent={activeBaseline.hasBaselineRuns ? (isZh ? "仅统计当前任务的有效正式题；失败题与探针不参与。未提供检索词不代表未搜索，分号文本保持原样。" : "Only effective formal samples in this run. Failed samples and probes are excluded. Missing queries do not imply no search; semicolons are preserved.") : infoContent}
		>
			<div className="space-y-6">
				{activeBaseline.hasBaselineRuns && (
					<DiagnosisRunBanner
						activeRunId={activeBaseline.activeRunId}
						runsList={activeBaseline.runsList}
						runData={activeBaseline.runData}
						metricsData={activeBaseline.metricsData}
						onSelectRun={activeBaseline.selectRun}
						brandId={brandId}
						isRequestedRunMissing={activeBaseline.isRequestedRunMissing}
					/>
				)}
				<FilterSection>
					<FilterBar
						availableTags={effectiveTags}
						availableModels={effectiveModels}
						modelAliases={effectiveModelAliases}
						showSearch={false}
						showModelSelector
					/>
				</FilterSection>
				{content}
				{activeBaseline.hasBaselineRuns && (
					<QueryFanoutDetailDialog
						brandId={brandId}
						brandName={brand?.name}
						promptId={selectedPromptId}
						isOpen={selectedPromptId !== null}
						onClose={() => setSelectedPromptId(null)}
						activeBaseline={activeBaseline}
						isZh={isZh}
					/>
				)}
			</div>
		</PageHeader>
	);
}

type FanoutData = NonNullable<ReturnType<typeof useQueryFanout>["data"]>;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function StatCard({ label, value, tip }: { label: string; value: React.ReactNode; tip: React.ReactNode }) {
	return (
		<Card className="py-4">
			<CardContent>
				<div className="text-muted-foreground flex items-center gap-1 text-sm">
					{label}
					<InfoTip>{tip}</InfoTip>
				</div>
				<div className="mt-1.5 text-3xl font-bold tabular-nums">{value}</div>
			</CardContent>
		</Card>
	);
}

function RunsTooltip({ breakdown }: { breakdown: FanoutData["byModel"] }) {
	return (
		<>
			<p>
				Prompt runs that produced at least one web search. Some engines do not expose web searches, so this number may
				be lower than expected.
			</p>
			{breakdown.length > 0 && (
				<div className="border-border/60 mt-2 space-y-0.5 border-t pt-2">
					{breakdown.map((m) => (
						<div key={m.model} className="flex items-center justify-between gap-3">
							<span>{getModelDisplayName(m.model)}</span>
							<span className="tabular-nums">{m.fanoutRuns.toLocaleString()}</span>
						</div>
					))}
				</div>
			)}
		</>
	);
}

function UnknownRunsTooltip({ byModel }: { byModel: FanoutData["byModel"] }) {
	const rows = byModel
		.map((m) => ({ model: m.model, unknown: m.runs - m.fanoutRuns }))
		.filter((m) => m.unknown > 0)
		.sort((a, b) => b.unknown - a.unknown);
	return (
		<>
			<p>
				Search-enabled runs without known queries. The engine may have chosen not to search at all, searched with just
				the prompt itself, or searched without revealing its queries.
			</p>
			{rows.length > 0 && (
				<div className="border-border/60 mt-2 space-y-0.5 border-t pt-2">
					{rows.map((m) => (
						<div key={m.model} className="flex items-center justify-between gap-3">
							<span>{getModelDisplayName(m.model)}</span>
							<span className="tabular-nums">{m.unknown.toLocaleString()}</span>
						</div>
					))}
				</div>
			)}
		</>
	);
}

function StatRow({ data, baseline = false }: { data: FanoutData; baseline?: boolean }) {
	const { language } = useLanguage();
	const isZh = language === "zh";
	// Only models that actually produced fan-out — the tooltip describes runs that
	// "produced at least one web search", so engines that ran but exposed none (e.g.
	// OpenRouter) are left off rather than listed as 0.
	const breakdown = data.byModel.filter((m) => m.fanoutRuns > 0).sort((a, b) => b.fanoutRuns - a.fanoutRuns);
	return (
		<div className="space-y-3">
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard
				label={baseline ? (isZh ? "有效正式题样本" : "Effective Formal Samples") : "Search Prompt Runs"}
				value={data.totalRuns.toLocaleString()}
				tip={baseline ? (isZh ? "当前筛选内的有效正式题样本数，不是供应商工具调用或计费次数。" : "Effective formal samples in the current filters, not provider tool calls or billable searches.") : "Runs against search-enabled engines."}
			/>
			<StatCard
				label={isZh ? "检索词未知样本" : "Samples with Unknown Queries"}
				value={(data.totalRuns - data.fanoutRuns).toLocaleString()}
				tip={isZh ? "这些样本未返回可观测检索词，无法据此判断未搜索或实际搜索次数。" : <UnknownRunsTooltip byModel={data.byModel} />}
			/>
			<StatCard
				label={isZh ? "检索词已知样本" : "Samples with Known Queries"}
				value={data.fanoutRuns.toLocaleString()}
				tip={isZh ? "至少返回一条原始查询文本的样本数。" : <RunsTooltip breakdown={breakdown} />}
			/>
			<StatCard
				label={isZh ? "已知样本平均检索记录" : "Average Records per Known Sample"}
				value={baseline && data.fanoutRuns === 0 ? (isZh ? "未知" : "Unknown") : data.avgPerExecution.toLocaleString()}
				tip={isZh ? "仅以检索词已知样本为分母；未知样本不补零。每个搜索块返回的原始 query 文本计一条，不拆分分号，不等于计费次数。" : "Known-query samples only; unknown samples are not zero-filled. One raw query string per search block, not billable tool calls."}
			/>
		</div>
		{baseline && <p className="text-sm text-muted-foreground">{isZh ? `已知范围：${data.fanoutRuns} / ${data.totalRuns} 个有效正式题样本，共 ${data.totalQueries} 条可观测检索词记录；未知样本未补零。` : `Known coverage: ${data.fanoutRuns} / ${data.totalRuns} effective formal samples, ${data.totalQueries} observable query records. Unknown samples are not zero-filled.`}</p>}
		</div>
	);
}

function LoadingState() {
	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{["a", "b", "c", "d"].map((k) => (
					<Card key={k} className="py-4">
						<CardContent className="space-y-2">
							<Skeleton className="h-4 w-28" />
							<Skeleton className="h-8 w-16" />
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
				</CardHeader>
				<CardContent className="space-y-4">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-1/2" />
				</CardContent>
			</Card>
		</div>
	);
}

function EmptyState({ message }: { message: string }) {
	return (
		<Card>
			<CardContent className="py-8">
				<div className="text-muted-foreground text-center">{message}</div>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Prompt Fan-Out — per-prompt searches with the prompt's keywords bolded
// ---------------------------------------------------------------------------

type SortKey = "queries" | "avg";

function SortHead<K extends string>({
	k,
	label,
	sort,
	setSort,
}: {
	k: K;
	label: string;
	sort: K;
	setSort: (k: K) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => setSort(k)}
			className={cn(
				"hover:text-foreground cursor-pointer uppercase tracking-wide",
				sort === k ? "text-foreground" : "",
			)}
		>
			{label}
		</button>
	);
}

const GRID = "grid grid-cols-[1.25rem_1fr_4.5rem_7rem] items-center gap-3";

function Prompts({
	prompts,
	brandId,
	hasBaselineRuns = false,
	onOpenDetail,
}: {
	prompts: PromptFanoutStat[];
	brandId: string;
	hasBaselineRuns?: boolean;
	onOpenDetail?: (promptId: string) => void;
}) {
	const { language } = useLanguage();
	const isZh = language === "zh";
	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set(prompts.length === 1 ? [prompts[0].promptId] : []),
	);
	const [sort, setSort] = useState<SortKey>("queries");
	const [search, setSearch] = useState("");

	const rows = useMemo(() => {
		const s = search.trim().toLowerCase();
		const list = s ? prompts.filter((p) => p.promptValue.toLowerCase().includes(s)) : prompts;
		return [...list].sort((a, b) =>
			sort === "avg"
				? b.avgPerExecution - a.avgPerExecution || b.totalQueries - a.totalQueries
				: b.totalQueries - a.totalQueries,
		);
	}, [prompts, search, sort]);

	const toggle = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<Card className="gap-4">
			<CardHeader>
				<div className="flex items-center justify-between gap-4">
					<div>
						<CardTitle className="flex items-center gap-1.5 text-base">
							{isZh ? "评测问题 (Prompts)" : "Prompts"}
							<InfoTip>
								{isZh
									? "每道问题的检索发散：生成的搜索词数（检索词数）及发起搜索的评测平均值（次均检索数）。展开问题可查看搜索词，其中问题关键词已加粗显示。"
									: "Each prompt's fan-out: how many searches it generates (Queries) and how many per run that searched (Avg/Prompt Run). Expand a prompt to see the searches, with your prompt's keywords bolded."}
							</InfoTip>
						</CardTitle>
						<CardDescription>
							{isZh ? "每道评测问题触发的联网搜索检索词明细。" : "The web searches each prompt triggers."}
						</CardDescription>
					</div>
					<div className="relative w-64 shrink-0">
						<IconSearch className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
						<Input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={isZh ? "搜索评测问题..." : "Search prompts..."}
							className="h-8 pl-8 text-sm"
						/>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className={cn(GRID, "text-muted-foreground/80 border-b py-2 text-[11px] font-medium")}>
					<span />
					<span className="uppercase tracking-wide">{isZh ? "评测问题 (Prompt)" : "Prompt"}</span>
					<span className="text-right">
						<SortHead k="queries" label={isZh ? "检索词数" : "Queries"} sort={sort} setSort={setSort} />
					</span>
					<span className="text-right">
						<SortHead k="avg" label={isZh ? "次均检索数" : "Avg/Prompt Run"} sort={sort} setSort={setSort} />
					</span>
				</div>
				<div className="divide-border divide-y">
					{rows.map((p) => {
						const isOpen = expanded.has(p.promptId);
						const keywords = isOpen ? promptKeywords(p.promptValue) : null;
						return (
							<div key={p.promptId} className="py-1">
								<button
									type="button"
									onClick={() => toggle(p.promptId)}
									className={cn(GRID, "hover:bg-muted/50 w-full cursor-pointer rounded-sm py-2 text-left")}
									aria-expanded={isOpen}
								>
									<span className="text-muted-foreground">
										{isOpen ? <IconChevronDown className="size-4" /> : <IconChevronRight className="size-4" />}
									</span>
									<span className="min-w-0">
										<span className="block truncate text-sm font-medium" title={p.promptValue}>
											{p.promptValue || "(untitled prompt)"}
										</span>
										<span className="text-muted-foreground text-xs">
											{isZh
												? `${p.uniqueQueries.toLocaleString()} 种检索词记录`
												: `${p.uniqueQueries.toLocaleString()} ${p.uniqueQueries === 1 ? "variation" : "variations"}`}
										</span>
									</span>
									<span className="text-right text-sm tabular-nums">{p.totalQueries.toLocaleString()}</span>
									<span className="text-right text-sm tabular-nums">{p.totalQueries ? p.avgPerExecution.toLocaleString() : "—"}</span>
								</button>
								{isOpen && keywords && (
									<div className="border-border mb-3 ml-8 mr-2 space-y-2 border-l pl-4">
										{p.variations.map((v) => (
											<VariationLine key={v.query} variation={v} keywords={keywords} />
										))}
										{p.uniqueQueries > p.variations.length && (
											<div className="text-muted-foreground text-xs">
												{isZh
													? `展示前 ${p.variations.length} / 共 ${p.uniqueQueries.toLocaleString()} 条变体`
													: `Top ${p.variations.length} of ${p.uniqueQueries.toLocaleString()} variations shown`}
											</div>
										)}
										<div className="pt-1">
											{hasBaselineRuns ? (
												<Button
													size="sm"
													variant="secondary"
													className="text-xs cursor-pointer h-6 flex items-center px-2"
													onClick={() => onOpenDetail?.(p.promptId)}
													data-testid={`view-detail-${p.promptId}`}
												>
													<GoStack className="size-3 mr-0.5" />
													<span className="text-xs font-normal">{isZh ? "查看详情" : "View Details"}</span>
												</Button>
											) : (
												<HistoryButton
													brandId={brandId}
													promptId={p.promptId}
													promptName={p.promptValue}
													tab="web-queries"
												/>
											)}
										</div>
									</div>
								)}
							</div>
						);
					})}
					{rows.length === 0 && (
						<div className="text-muted-foreground py-6 text-center text-sm">
							{isZh ? "未找到符合搜索条件的问题。" : "No prompts match your search."}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Top Queries — the searches with the widest reach, with the prompts behind them
// ---------------------------------------------------------------------------

type TopSort = "prompts" | "runs";

const TOP_GRID = "grid grid-cols-[1.25rem_1fr_5rem_5.5rem] items-center gap-3";

function TopQueries({
	data,
	brandId,
	hasBaselineRuns = false,
	onOpenDetail,
}: {
	data: FanoutData;
	brandId: string;
	hasBaselineRuns?: boolean;
	onOpenDetail?: (promptId: string) => void;
}) {
	const { language } = useLanguage();
	const isZh = language === "zh";
	const [sort, setSort] = useState<TopSort>("prompts");
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const rows: TopQueryStat[] = sort === "prompts" ? data.topByPrompts : data.topByRuns;

	const toggle = (query: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(query)) next.delete(query);
			else next.add(query);
			return next;
		});

	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-base">
					{isZh ? "高频检索词 (Top Queries)" : "Top Queries"}
					<InfoTip>
						{isZh
							? "覆盖面最广的检索词——按触发它们的不同评测问题数或发起它们的评测次数排序。展开检索词可查看背后的具体问题。"
							: "The searches with the widest reach — sort by how many distinct prompts triggered them, or how many prompt runs issued them. Expand a query to see the prompts behind it."}
					</InfoTip>
				</CardTitle>
				<CardDescription>
					{isZh ? "在多道评测问题中反复出现的联网搜索词。" : "The searches that recur across your prompts."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className={cn(TOP_GRID, "text-muted-foreground/80 border-b py-2 text-[11px] font-medium")}>
					<span />
					<span className="uppercase tracking-wide">{isZh ? "检索词 (Query)" : "Query"}</span>
					<span className="text-right">
						<SortHead k="prompts" label={isZh ? "关联问题数" : "Prompts"} sort={sort} setSort={setSort} />
					</span>
					<span className="text-right">
						<SortHead k="runs" label={isZh ? "发起次数" : "Prompt Runs"} sort={sort} setSort={setSort} />
					</span>
				</div>
				<div className="divide-border divide-y">
					{rows.map((q) => {
						const isOpen = expanded.has(q.query);
						return (
							<div key={q.query} className="py-1">
								<button
									type="button"
									onClick={() => toggle(q.query)}
									className={cn(TOP_GRID, "hover:bg-muted/50 w-full cursor-pointer rounded-sm py-2 text-left")}
									aria-expanded={isOpen}
								>
									<span className="text-muted-foreground">
										{isOpen ? <IconChevronDown className="size-4" /> : <IconChevronRight className="size-4" />}
									</span>
									<span className="min-w-0 truncate text-sm" title={q.query}>
										{q.query}
									</span>
									<span className="text-right text-sm tabular-nums">{q.prompts.toLocaleString()}</span>
									<span className="text-right text-sm tabular-nums">{q.runs.toLocaleString()}</span>
								</button>
								{isOpen && (
									<div className="border-border mb-3 ml-8 mr-2 space-y-1.5 border-l pl-4">
										{q.promptRefs.map((p) => (
											<div key={p.promptId} className="flex items-baseline justify-between gap-4">
												{hasBaselineRuns ? (
													<button
														type="button"
														onClick={() => onOpenDetail?.(p.promptId)}
														className="min-w-0 truncate text-sm hover:underline text-left cursor-pointer font-medium"
														title={p.promptValue}
														data-testid={`query-ref-${p.promptId}`}
													>
														{p.promptValue || "(untitled prompt)"}
													</button>
												) : (
													<Link
														to="/app/$brand/prompts/$promptId"
														params={{ brand: brandId, promptId: p.promptId }}
														search={{ tab: "web-queries" }}
														className="min-w-0 truncate text-sm hover:underline"
														title={p.promptValue}
													>
														{p.promptValue || "(untitled prompt)"}
													</Link>
												)}
												<span
													className="text-muted-foreground shrink-0 text-sm tabular-nums"
													title={isZh ? "触发该检索词的评测次数" : "Runs of this prompt that issued the search"}
												>
													{p.runs.toLocaleString()}×
												</span>
											</div>
										))}
									</div>
								)}
							</div>
						);
					})}
					{rows.length === 0 && (
						<div className="text-muted-foreground py-6 text-center text-sm">
							{isZh ? "当前所选周期内暂无检索词记录。" : "No queries for this period."}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Query Fan-Out Detail Dialog — In-place read-only evidence viewer for active baseline run
// ---------------------------------------------------------------------------

function QueryFanoutDetailDialog({
	brandId,
	brandName,
	promptId,
	isOpen,
	onClose,
	activeBaseline,
	isZh,
}: {
	brandId: string;
	brandName?: string;
	promptId: string | null;
	isOpen: boolean;
	onClose: () => void;
	activeBaseline: ReturnType<typeof useActiveBaselineRun>;
	isZh: boolean;
}) {
	if (!isOpen || !promptId) return null;

	const {
		isRequestedRunMissing,
		isLoading,
		isError,
		errors,
		activeRunId,
		runData,
		evidenceData,
	} = activeBaseline;

	const formalQuestions: any[] = evidenceData?.formal_questions || [];
	const question = formalQuestions.find(
		(q: any) => (q.question_code || q.question_id || q.question_text) === promptId,
	);

	const platform = runData?.model_name?.trim() || (isZh ? "未知平台" : "Unknown Engine");
	const sampleTime = formatBeijingTime(runData?.completed_at || runData?.created_at, isZh);
	const queries: string[] = Array.isArray(question?.search_queries) ? question.search_queries : [];

	let body: React.ReactNode;

	const isEvidenceError = Boolean(isError || errors.evidenceError);

	if (isRequestedRunMissing) {
		body = (
			<div className="py-6 text-center text-sm text-destructive" role="alert">
				{isZh ? "指定的诊断任务不存在或无权访问" : "Diagnostic Run Not Found or Access Denied"}
			</div>
		);
	} else if (isLoading && !evidenceData) {
		body = (
			<div className="py-8 text-center text-sm text-muted-foreground">
				{isZh ? "正在读取本轮检索词归档..." : "Loading query records..."}
			</div>
		);
	} else if (isEvidenceError && !evidenceData) {
		body = (
			<div className="py-6 text-center text-sm text-destructive" role="alert">
				{isZh ? "读取本轮检索词归档失败，请刷新重试。" : "Failed to load query records. Please refresh to try again."}
			</div>
		);
	} else if (!question) {
		body = (
			<div className="py-6 text-center text-sm text-muted-foreground">
				{isZh ? "未在当前诊断任务中找到该题目记录。" : "Prompt record not found in the current diagnostic run."}
			</div>
		);
	} else {
		body = (
			<div className="space-y-4">
				{/* 刷新失败但保留有效缓存记录时的警示条 */}
				{isEvidenceError && (
					<div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2" role="alert">
						<IconAlertCircle className="size-4 shrink-0" />
						<span>
							{isZh
								? "后台刷新检索词归档失败，当前展示为本地缓存记录；请稍后重试。"
								: "Failed to refresh query archive in background; currently displaying cached data. Please try again later."}
						</span>
					</div>
				)}

				{/* 题目与任务元信息 */}
				<div className="bg-muted/40 p-3 rounded-lg text-xs space-y-1.5 border">
					<div className="flex justify-between items-center text-muted-foreground">
						<span>{isZh ? "当前品牌" : "Brand"}: <strong className="text-foreground">{brandName || brandId}</strong></span>
						<span>{isZh ? "任务编号" : "Run"}: <span className="font-mono text-foreground">{activeRunId || "—"}</span></span>
					</div>
					<div className="flex justify-between items-center text-muted-foreground">
						<span>{isZh ? "评测平台" : "Engine"}: <span className="text-foreground">{platform}</span></span>
						<span>{isZh ? "采样时间" : "Time"}: <span className="text-foreground">{sampleTime}</span></span>
					</div>
					<div className="pt-1 border-t text-muted-foreground">
						<span className="font-semibold text-foreground mr-1.5">[{question.question_code || promptId}]</span>
						<span className="text-foreground">{question.question_text || question.text || promptId}</span>
					</div>
				</div>

				{/* 检索词记录 */}
				<div className="space-y-2">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span className="font-medium text-foreground">
							{isZh ? "可观测检索词记录" : "Observable Web Queries"}
						</span>
						{queries.length > 0 && (
							<span>
								{isZh
									? `共 ${queries.length} 条记录（每搜索块计一条）`
									: `${queries.length} record(s)`}
							</span>
						)}
					</div>

					{queries.length === 0 ? (
						<div className="p-4 rounded-lg border bg-muted/20 text-center text-sm text-muted-foreground">
							{isZh
								? "本题暂无可观测检索词记录，不能据此确认未联网"
								: "No observable query records for this prompt; this does not confirm web search was unused."}
						</div>
					) : (
						<div className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
							{queries.map((q, idx) => (
								<div
									key={`${idx}-${q}`}
									className="p-3 bg-muted/30 border rounded-md text-xs font-mono break-words whitespace-pre-wrap leading-relaxed"
								>
									{q}
								</div>
							))}
						</div>
					)}
				</div>

				{/* 原回答证据只读参考（如有） */}
				{question.answer_text && (
					<div className="space-y-1.5 pt-2 border-t text-xs">
						<span className="font-medium text-muted-foreground">
							{isZh ? "原始回答节选" : "Response Excerpt"}
						</span>
						<div className="p-2.5 bg-muted/20 border rounded text-xs text-muted-foreground line-clamp-3 break-words whitespace-pre-wrap">
							{question.answer_text}
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="text-base font-semibold">
						{isZh ? "联网检索详情" : "Web Query Fan-Out Details"}
					</DialogTitle>
					<DialogDescription className="text-xs">
						{isZh
							? "查看 AI 回答此题时可观测到的联网检索词记录；不代表完整检索过程或计费次数。"
							: "Observable search queries triggered by the AI when responding to this prompt."}
					</DialogDescription>
				</DialogHeader>

				{body}

				<DialogFooter className="pt-2">
					<Button variant="outline" size="sm" onClick={onClose}>
						{isZh ? "关闭" : "Close"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
