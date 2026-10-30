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
import { useMemo, useState } from "react";
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
	const { model, lookback, tags } = useListFilters();
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
		const formalQuestions: any[] = evidenceData?.formal_questions || [];
		const validQuestions =
			metricsData?.p0_summary?.effective_sample_count ??
			metricsData?.p0_summary?.valid_questions ??
			runData?.valid_questions ??
			formalQuestions.length;

		// Filter by tags if selected
		const matchingQuestions = tags.length > 0
			? formalQuestions.filter((q) => tags.includes(q.dimension_name))
			: formalQuestions;

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

		const modelName = runData?.model_name || "doubao-pro-32k";
		const fanoutRuns = byPrompt.filter((p) => p.totalQueries > 0).length;
		const uniqueQueries = queryMap.size;
		const avgPerExecution = fanoutRuns > 0 ? +(totalQueries / fanoutRuns).toFixed(1) : 0;
		const coverageRate = validQuestions > 0 ? +(fanoutRuns / validQuestions).toFixed(2) : 0;
		const topByPrompts = [...topQueries].sort((a, b) => b.prompts - a.prompts);
		const topByRuns = [...topQueries].sort((a, b) => b.runs - a.runs);

		return {
			brandName: brand?.name || "Target Brand",
			model: modelName,
			totalRuns: validQuestions,
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
			byModel: [
				{
					model: modelName,
					runs: validQuestions,
					fanoutRuns,
					totalQueries,
					avgPerExecution,
					topQueries: topQueries.map((t) => ({ query: t.query, count: t.runs, brandMentionRate: 0 })),
				},
			],
		};
	}, [activeBaseline, brand?.name, tags]);

	const baselineTags = useMemo(() => {
		const questions: any[] = activeBaseline.evidenceData?.formal_questions || activeBaseline.metricsData?.questions || [];
		const set = new Set<string>();
		for (const q of questions) {
			if (q.dimension_name) set.add(q.dimension_name);
		}
		return Array.from(set);
	}, [activeBaseline.evidenceData?.formal_questions, activeBaseline.metricsData?.questions]);

	const baselineModels = useMemo(() => {
		return [activeBaseline.runData?.model_name || "doubao-pro-32k"];
	}, [activeBaseline.runData?.model_name]);

	const effectiveData = activeBaseline.hasBaselineRuns ? baselineData : data;
	const effectiveTags = activeBaseline.hasBaselineRuns ? baselineTags : availableTags;
	const effectiveModels = activeBaseline.hasBaselineRuns ? baselineModels : availableModels;
	const effectiveLoading = activeBaseline.hasBaselineRuns
		? activeBaseline.isLoading && !activeBaseline.runData
		: isLoading && !data;

	const infoContent = (
		<p>
			When an AI engine with web search capabilities responds to a prompt, it may choose to make a number of web
			searches before creating its answer. These underlying web searches, or web queries, are only available for some
			engines.
		</p>
	);

	let content: React.ReactNode;
	if (effectiveLoading) {
		content = <LoadingState />;
	} else if (isError && !effectiveData) {
		content = <EmptyState message={isZh ? "无法加载检索发散数据，请刷新页面重试。" : "Couldn't load query fan-out right now. Reload the page to try again."} />;
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
	} else if (effectiveData.totalQueries === 0) {
		content = (
			<TooltipProvider delayDuration={150}>
				<div className="space-y-6">
					<StatRow data={effectiveData as any} />
					<EmptyState
						message={
							isZh
								? "该轮未返回可用检索词（模型在生成回答时未在原始响应中暴露检索词详情）。"
								: "No web queries returned in this diagnostic run — the model did not expose search query details in the raw response."
						}
					/>
				</div>
			</TooltipProvider>
		);
	} else {
		content = (
			<TooltipProvider delayDuration={150}>
				<div className="space-y-6">
					<StatRow data={effectiveData as any} />
					<Tabs value={tab} onValueChange={(v) => setTab(v as FanoutTab)} className="gap-4">
						<TabsList>
							<TabsTrigger value="fanout">{isZh ? "问题发散明细 (Prompt Fan-Out)" : "Prompt Fan-Out"}</TabsTrigger>
							<TabsTrigger value="top-queries">{isZh ? "高频检索词 (Top Queries)" : "Top Queries"}</TabsTrigger>
							{!activeBaseline.hasBaselineRuns && <TabsTrigger value="words">Query Words</TabsTrigger>}
						</TabsList>
						<TabsContent value="fanout">
							<Prompts prompts={effectiveData.byPrompt} brandId={brandId} />
						</TabsContent>
						<TabsContent value="top-queries">
							<TopQueries data={effectiveData as any} brandId={brandId} />
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
			title="Query Fan-Out"
			subtitle="The web searches AI engines run when answering your prompts."
			infoContent={infoContent}
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
					/>
				)}
				<FilterSection>
					<FilterBar
						availableTags={effectiveTags}
						availableModels={effectiveModels}
						showSearch={false}
						showModelSelector
					/>
				</FilterSection>
				{content}
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

function StatRow({ data }: { data: FanoutData }) {
	// Only models that actually produced fan-out — the tooltip describes runs that
	// "produced at least one web search", so engines that ran but exposed none (e.g.
	// OpenRouter) are left off rather than listed as 0.
	const breakdown = data.byModel.filter((m) => m.fanoutRuns > 0).sort((a, b) => b.fanoutRuns - a.fanoutRuns);
	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard
				label="Search Prompt Runs"
				value={data.totalRuns.toLocaleString()}
				tip="How many times your prompts were run against engines configured with web search. An engine may still choose not to execute a search on a given run."
			/>
			<StatCard
				label="Prompt Runs w/ Unknown Queries"
				value={(data.totalRuns - data.fanoutRuns).toLocaleString()}
				tip={<UnknownRunsTooltip byModel={data.byModel} />}
			/>
			<StatCard
				label="Prompt Runs w/ Known Queries"
				value={data.fanoutRuns.toLocaleString()}
				tip={<RunsTooltip breakdown={breakdown} />}
			/>
			<StatCard
				label="Average Fan-Out"
				value={data.avgPerExecution.toLocaleString()}
				tip="Average queries per run that had at least one web query."
			/>
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

function Prompts({ prompts, brandId }: { prompts: PromptFanoutStat[]; brandId: string }) {
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
							Prompts
							<InfoTip>
								Each prompt's fan-out: how many searches it generates (Queries) and how many per run that searched
								(Avg/Prompt Run). Expand a prompt to see the searches, with your prompt's keywords bolded.
							</InfoTip>
						</CardTitle>
						<CardDescription>The web searches each prompt triggers.</CardDescription>
					</div>
					<div className="relative w-64 shrink-0">
						<IconSearch className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
						<Input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search prompts..."
							className="h-8 pl-8 text-sm"
						/>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className={cn(GRID, "text-muted-foreground/80 border-b py-2 text-[11px] font-medium")}>
					<span />
					<span className="uppercase tracking-wide">Prompt</span>
					<span className="text-right">
						<SortHead k="queries" label="Queries" sort={sort} setSort={setSort} />
					</span>
					<span className="text-right">
						<SortHead k="avg" label="Avg/Prompt Run" sort={sort} setSort={setSort} />
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
										<span className="text-muted-foreground text-xs">{p.uniqueQueries.toLocaleString()} variations</span>
									</span>
									<span className="text-right text-sm tabular-nums">{p.totalQueries.toLocaleString()}</span>
									<span className="text-right text-sm tabular-nums">{p.avgPerExecution.toLocaleString()}</span>
								</button>
								{isOpen && keywords && (
									<div className="border-border mb-3 ml-8 mr-2 space-y-2 border-l pl-4">
										{p.variations.map((v) => (
											<VariationLine key={v.query} variation={v} keywords={keywords} />
										))}
										{p.uniqueQueries > p.variations.length && (
											<div className="text-muted-foreground text-xs">
												Top {p.variations.length} of {p.uniqueQueries.toLocaleString()} variations shown
											</div>
										)}
										<div className="pt-1">
											<HistoryButton
												brandId={brandId}
												promptId={p.promptId}
												promptName={p.promptValue}
												tab="web-queries"
											/>
										</div>
									</div>
								)}
							</div>
						);
					})}
					{rows.length === 0 && (
						<div className="text-muted-foreground py-6 text-center text-sm">No prompts match your search.</div>
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

function TopQueries({ data, brandId }: { data: FanoutData; brandId: string }) {
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
					Top Queries
					<InfoTip>
						The searches with the widest reach — sort by how many distinct prompts triggered them, or how many prompt
						runs issued them. Expand a query to see the prompts behind it.
					</InfoTip>
				</CardTitle>
				<CardDescription>The searches that recur across your prompts.</CardDescription>
			</CardHeader>
			<CardContent>
				<div className={cn(TOP_GRID, "text-muted-foreground/80 border-b py-2 text-[11px] font-medium")}>
					<span />
					<span className="uppercase tracking-wide">Query</span>
					<span className="text-right">
						<SortHead k="prompts" label="Prompts" sort={sort} setSort={setSort} />
					</span>
					<span className="text-right">
						<SortHead k="runs" label="Prompt Runs" sort={sort} setSort={setSort} />
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
												<Link
													to="/app/$brand/prompts/$promptId"
													params={{ brand: brandId, promptId: p.promptId }}
													search={{ tab: "web-queries" }}
													className="min-w-0 truncate text-sm hover:underline"
													title={p.promptValue}
												>
													{p.promptValue || "(untitled prompt)"}
												</Link>
												<span
													className="text-muted-foreground shrink-0 text-sm tabular-nums"
													title="Runs of this prompt that issued the search"
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
						<div className="text-muted-foreground py-6 text-center text-sm">No queries for this period.</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
