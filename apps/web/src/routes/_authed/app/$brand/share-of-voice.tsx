/**
 * /app/$brand/share-of-voice - Share of Voice
 *
 * "Who do the AI engines mention instead of you?" A leaderboard of competitor
 * mention rates next to the brand's own, with the brand's overall share, a
 * donut of top competitors, and share of voice over time.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Badge } from "@workspace/ui/components/badge";
import { shareOfVoiceColorMap } from "@/lib/share-of-voice-palette";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { useShareOfVoice } from "@/hooks/use-share-of-voice";
import { usePromptsSummary } from "@/hooks/use-prompts-summary";
import { useBrand } from "@/hooks/use-brands";
import { PageHeader, FilterSection } from "@/components/page-header";
import { FilterBar, getAvailableModels, ALL_MODELS_VALUE } from "@/components/filter-bar";
import { useListFilters } from "@/hooks/use-list-filters";
import { ColHead } from "@/components/col-head";
import { ShareOfVoiceDonut } from "@/components/share-of-voice-donut";
import { TrendChart } from "@/components/trend-chart";
import { useLanguage } from "@/lib/language-context";
import { useActiveBaselineRun } from "@/hooks/use-active-baseline-run";
import { DiagnosisRunBanner } from "@/components/diagnosis-run-banner";
import { computeShareOfVoice } from "@/lib/visibility-stats";
import { useMemo } from "react";

export const Route = createFileRoute("/_authed/app/$brand/share-of-voice")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Share of Voice", { appName, brandName }) },
				{ name: "description", content: "See how often AI engines mention you versus your competitors." },
			],
		};
	},
	component: ShareOfVoicePage,
});

const formatPct = (share: number) => `${Math.round(share * 100)}%`;

/** Latest non-null point of the share-of-voice trend — the value the line ends on. */
function currentShareOf(series: Array<{ share: number | null }>): number | null {
	for (let i = series.length - 1; i >= 0; i--) {
		const v = series[i]?.share;
		if (typeof v === "number") return v;
	}
	return null;
}

const TIPS = {
	mentions: "Number of runs in which this brand was mentioned in the AI answer.",
	share: "This brand's share of all brand + competitor mentions.",
	prompts: "Number of distinct prompts this brand appeared in.",
};

function ShareOfVoicePage() {
	const { brand: brandId } = Route.useParams();
	const { model, lookback, tags } = useListFilters();
	const { language } = useLanguage();
	const isZh = language === "zh";

	const { brand } = useBrand(brandId);
	const activeBaseline = useActiveBaselineRun(brandId);
	const availableModels = getAvailableModels(brand?.effectiveModels ?? []);
	const modelParam = model === ALL_MODELS_VALUE ? undefined : model;

	const { promptsSummary } = usePromptsSummary(brandId, { lookback, model: modelParam });
	const availableTags = promptsSummary?.availableTags ?? [];

	const { data, isLoading } = useShareOfVoice(brandId, { lookback, model: modelParam, tags });

	// Compute baseline SOV data when baseline runs exist
	const baselineData = useMemo(() => {
		if (!activeBaseline.hasBaselineRuns) return null;
		const { runData, metricsData } = activeBaseline;

		// Model filter check
		if (model && model !== ALL_MODELS_VALUE && model !== runData?.model_name) {
			return {
				brandName: brand?.name || "Target Brand",
				totalRuns: 0,
				totalMentions: 0,
				entries: [],
				brandShare: null,
				shareTimeSeries: [],
			};
		}

		const p0Summary = metricsData?.p0_summary;
		const validQuestions =
			p0Summary?.effective_sample_count ??
			p0Summary?.planned_questions ??
			runData?.valid_questions ??
			0;
		const rawSampleDate = (runData?.completed_at || runData?.created_at || "").slice(0, 10);
		const sampleDate = /^\d{4}-\d{2}-\d{2}$/.test(rawSampleDate) ? rawSampleDate : "";
		const brandName = brand?.name || "Target Brand";

		// Strictly isolate formal questions only (!is_probe)
		const rawQuestions: any[] = metricsData?.questions || [];
		const allQuestions = rawQuestions.filter((q: any) => !q.is_probe);
		const matchingQuestions = tags.length > 0
			? allQuestions.filter((q) => tags.includes(q.dimension_name))
			: allQuestions;

		let brandMentions =
			p0Summary?.broad_mention_count ??
			p0Summary?.effective_mention_count ??
			0;
		const rawCompetitors: any[] = metricsData?.competitors || [];

		if (tags.length > 0) {
			brandMentions = matchingQuestions.filter((q) => q.effective_mention).length;
		}

		const competitorList = rawCompetitors.map((c: any) => {
			let mentions = c.p0_mention_count ?? c.overall_mention_count ?? 0;
			if (tags.length > 0 && Array.isArray(c.dimension_hits)) {
				mentions = c.dimension_hits
					.filter((d: any) => tags.includes(d.dimension_name || d.name))
					.reduce((sum: number, d: any) => sum + (d.mention_count || d.count || 0), 0);
			}
			return { name: c.name, mentions };
		});

		const sovResult = computeShareOfVoice(
			{ name: brandName, mentions: brandMentions },
			competitorList,
		);

		const entries = sovResult.entries.map((e) => ({
			...e,
			prompts: e.mentions,
		}));

		const totalRuns = tags.length > 0 ? matchingQuestions.length : validQuestions;

		return {
			brandName,
			totalRuns,
			totalMentions: sovResult.total,
			entries,
			brandShare: sovResult.brandShare,
			shareTimeSeries: sampleDate
				? [{ date: sampleDate, share: sovResult.brandShare !== null ? Math.round(sovResult.brandShare * 100) : null }]
				: [],
		};
	}, [activeBaseline, brand?.name, tags, model]);

	const baselineTags = useMemo(() => {
		const rawQuestions: any[] = activeBaseline.metricsData?.questions || [];
		const questions = rawQuestions.filter((q: any) => !q.is_probe);
		const set = new Set<string>();
		for (const q of questions) {
			if (q.dimension_name) set.add(q.dimension_name);
		}
		return Array.from(set);
	}, [activeBaseline.metricsData?.questions]);

	const baselineModels = useMemo(() => {
		return [activeBaseline.runData?.model_name || "doubao-pro-32k"];
	}, [activeBaseline.runData?.model_name]);

	const effectiveData = activeBaseline.hasBaselineRuns ? baselineData : data;
	const effectiveTags = activeBaseline.hasBaselineRuns ? baselineTags : availableTags;
	const effectiveModels = activeBaseline.hasBaselineRuns ? baselineModels : availableModels;
	const effectiveLoading = activeBaseline.isLoadingRunsList || (activeBaseline.hasBaselineRuns
		? activeBaseline.isLoading && !activeBaseline.runData
		: isLoading && !data);

	const infoContent = (
		<>
			<p className="mb-2">
				Share of voice is how often each brand is mentioned in the AI answers to your prompts. Mentions are counted per
				run, so the brand and competitor figures use the same unit and are directly comparable.
			</p>
			<p>Competitors are the ones you track in settings. Switch the model filter to compare engines.</p>
		</>
	);

	const maxMentions = effectiveData?.entries.reduce((m, e) => Math.max(m, e.mentions), 0) ?? 0;
	const barColors = shareOfVoiceColorMap(effectiveData?.entries ?? []);

	let content: React.ReactNode;
	if (effectiveLoading) {
		content = (
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
		);
	} else if (!effectiveData || effectiveData.totalRuns === 0 || effectiveData.entries.length === 0) {
		content = (
			<Card>
				<CardContent className="pt-6">
					<div className="text-muted-foreground text-center py-8">
						{isZh
							? "当前筛选条件下暂无评测数据。发起诊断任务后将在此展现。"
							: "No mention data yet for the selected filters. Mentions appear once your prompts have been run."}
					</div>
				</CardContent>
			</Card>
		);
	} else if (maxMentions === 0 || effectiveData.entries.every((e) => e.mentions === 0)) {
		content = (
			<Card>
				<CardContent className="pt-6">
					<div className="text-muted-foreground text-center py-8">
						{isZh
							? "本轮未产生品牌或竞品有效提及，声量份额不可计算（总提及数为 0）。"
							: "No brand or competitor mentions recorded in this diagnostic run. Share of voice cannot be computed."}
					</div>
				</CardContent>
			</Card>
		);
	} else {
		// Whole-window cumulative raw SOV to strictly align with reports (e.g. 70.6%)
		const cumulativeShare = effectiveData.brandShare !== null && effectiveData.brandShare !== undefined
			? (effectiveData.brandShare * 100).toFixed(1)
			: null;
		content = (
			<TooltipProvider delayDuration={150}>
				<div className="grid gap-6 lg:grid-cols-2">
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<CardTitle>Share of Voice</CardTitle>
								<Badge variant="secondary" className="text-xs font-normal">
									{isZh
										? activeBaseline.hasBaselineRuns
											? "当前诊断任务"
											: "近 30 天累计"
										: activeBaseline.hasBaselineRuns
											? "Current diagnostic run"
											: "Last 30 days cumulative"}
								</Badge>
							</div>
						</CardHeader>
						<CardContent className="flex items-center justify-between gap-4">
							<div>
								<div className="text-3xl sm:text-4xl font-bold tabular-nums">
									{cumulativeShare !== null ? `${cumulativeShare}%` : "—"}
								</div>
								<p className="text-sm text-muted-foreground mt-1 max-w-[18rem]">
									{effectiveData.brandName} across {effectiveData.totalRuns.toLocaleString()}{" "}
									{isZh ? "道评测题" : "runs"}
									{effectiveData.entries.length > 1
										? isZh
											? ` 及 ${effectiveData.entries.length - 1} 家对比竞品`
											: ` and ${effectiveData.entries.length - 1} competitors`
										: ""}.
								</p>
							</div>
							<ShareOfVoiceDonut entries={effectiveData.entries} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<CardTitle>Share of Voice Trends</CardTitle>
								<Badge variant="outline" className="text-xs font-normal text-muted-foreground">
									{isZh
										? activeBaseline.hasBaselineRuns
											? "单点截面"
											: "逐日截面趋势 (LVCF)"
										: activeBaseline.hasBaselineRuns
											? "Single snapshot"
											: "Daily snapshot trend (LVCF)"}
								</Badge>
							</div>
						</CardHeader>
						<CardContent>
							<TrendChart
								data={effectiveData.shareTimeSeries.map((p) => ({ date: p.date, value: p.share }))}
								label="Share of Voice"
								color="#2563eb"
								className="aspect-auto h-[180px] w-full"
							/>
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Share of Voice Leaderboard</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10">#</TableHead>
									<TableHead>Brand</TableHead>
									<TableHead className="text-right">
										<ColHead label="Mentions" tip={TIPS.mentions} right />
									</TableHead>
									<TableHead className="w-[34%]">
										<ColHead label="Share" tip={TIPS.share} />
									</TableHead>
									<TableHead className="text-right">
										<ColHead label="Prompts" tip={TIPS.prompts} right />
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{effectiveData.entries.map((e, i) => (
									<TableRow key={e.name} className={e.isBrand ? "bg-muted/40" : undefined}>
										<TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
										<TableCell className="font-medium">
											<span className="inline-flex items-center gap-2">
												{e.name}
												{e.isBrand && (
													<Badge variant="secondary" className="text-xs">
														You
													</Badge>
												)}
											</span>
										</TableCell>
										<TableCell className="text-right tabular-nums">{e.mentions.toLocaleString()}</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
													<div
														className="h-full rounded-full"
														style={{
															width: `${maxMentions > 0 ? (e.mentions / maxMentions) * 100 : 0}%`,
															backgroundColor: barColors.get(e.name) ?? "#cbd5e1",
														}}
													/>
												</div>
												<span className="tabular-nums text-sm text-muted-foreground w-10 text-right">
													{formatPct(e.share)}
												</span>
											</div>
										</TableCell>
										<TableCell className="text-right tabular-nums text-muted-foreground">{e.prompts}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</TooltipProvider>
		);
	}

	return (
		<PageHeader
			title="Share of Voice"
			subtitle="How often AI engines mention you versus your competitors."
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
						isRequestedRunMissing={activeBaseline.isRequestedRunMissing}
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
				<div className="space-y-6">{content}</div>
			</div>
		</PageHeader>
	);
}
