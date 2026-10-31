/**
 * /app/$brand/citations - Citations tracking page
 *
 * Shows citation statistics with filtering by model, tags, and lookback period.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useCitations } from "@/hooks/use-citations";
import { useBrand, brandKeys } from "@/hooks/use-brands";
import { useListFilters } from "@/hooks/use-list-filters";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { CitationsDisplay } from "@/components/citations-display";
import { FilteredListShell } from "@/components/filtered-list-shell";
import { getDaysFromLookback } from "@/lib/chart-utils";
import { PageHeader } from "@/components/page-header";
import { getAvailableModels, ALL_MODELS_VALUE } from "@/components/filter-bar";
import { useActiveBaselineRun } from "@/hooks/use-active-baseline-run";
import { DiagnosisRunBanner } from "@/components/diagnosis-run-banner";
import { useLanguage } from "@/lib/language-context";
import { type CitationCategory, emptyCategoryCounts, toRoundedPercentages } from "@/lib/domain-categories";
import type { CitationData } from "@/components/citations/types";
import { isUnsupportedBaselineModel, isRunWithinLookback, isModelMatch } from "@/lib/model-filter";
import { UnsupportedModelNotice } from "@/components/unsupported-model-notice";
import { Button } from "@workspace/ui/components/button";
import { IconAlertCircle } from "@tabler/icons-react";
import { FilterBar } from "@/components/filter-bar";

export const Route = createFileRoute("/_authed/app/$brand/citations")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Citations", { appName, brandName }) },
				{ name: "description", content: "See which sources LLMs cite in responses to your prompts." },
			],
		};
	},
	component: CitationsPage,
});

function CitationsPage() {
	const { brand: brandId } = Route.useParams();
	const queryClient = useQueryClient();

	const filters = useListFilters();
	const days = getDaysFromLookback(filters.lookback);

	const { brand } = useBrand(brandId);
	const activeBaseline = useActiveBaselineRun(brandId);
	const availableModels = getAvailableModels(brand?.effectiveModels ?? []);

	// Get citation data with tag and model filter
	const modelParam = filters.model === ALL_MODELS_VALUE ? undefined : filters.model;
	const {
		citations: citationData,
		isLoading,
		isError,
		revalidate: revalidateCitations,
	} = useCitations(brandId, {
		days,
		tags: filters.tags.length > 0 ? filters.tags : undefined,
		model: modelParam,
	});

	const { language } = useLanguage();
	const isZh = language === "zh";

	// Build baseline citation data when baseline run is active
	const baselineCitationData: CitationData | null = useMemo(() => {
		if (!activeBaseline.hasBaselineRuns) return null;
		const { runData, metricsData, evidenceData } = activeBaseline;

		// Model filter check
		if (!isModelMatch(modelParam, runData?.model_name)) {
			return {
				totalCitations: 0,
				uniqueDomains: 0,
				categoryCounts: emptyCategoryCounts(),
				domainDistribution: [],
				specificUrls: [],
				citationTimeSeries: [],
			};
		}

		// Lookback filter check
		if (!isRunWithinLookback(runData?.completed_at || runData?.created_at, filters.lookback)) {
			return {
				totalCitations: 0,
				uniqueDomains: 0,
				categoryCounts: emptyCategoryCounts(),
				domainDistribution: [],
				specificUrls: [],
				citationTimeSeries: [],
			};
		}

		const formalQuestions: any[] = evidenceData?.formal_questions || [];

		// Filter by tags if tags are specified
		const matchingQuestions = filters.tags.length > 0
			? formalQuestions.filter((q) => filters.tags.includes(q.dimension_name))
			: formalQuestions;

		const allCitations: any[] = [];
		for (const q of matchingQuestions) {
			if (Array.isArray(q.citations)) {
				for (const c of q.citations) {
					allCitations.push({
						...c,
						promptId: q.question_code || q.question_id,
						promptText: q.question_text,
					});
				}
			}
		}

		// Derive total citations strictly from the matching formal citation dataset
		const totalCitations = allCitations.length;

		const domainCounts = new Map<string, { count: number; category: CitationCategory; exampleTitle?: string }>();
		const urlCounts = new Map<string, { url: string; domain: string; title?: string; count: number; category: CitationCategory; pageType: any; promptCount: number }>();

		const categoryCounts = emptyCategoryCounts();

		// Known brand domains (prioritize immutable snapshot from baseline run metrics)
		const brandDomains = new Set<string>();
		if (Array.isArray(metricsData?.domain_metrics?.own_domains) && metricsData.domain_metrics.own_domains.length > 0) {
			for (const d of metricsData.domain_metrics.own_domains) {
				if (typeof d === "string" && d.trim()) {
					brandDomains.add(d.replace(/^www\./, "").toLowerCase().trim());
				}
			}
		} else {
			if (brand?.website) {
				try {
					const u = new URL(brand.website.startsWith("http") ? brand.website : `https://${brand.website}`);
					brandDomains.add(u.hostname.replace(/^www\./, "").toLowerCase());
				} catch {}
			}
			for (const d of brand?.additionalDomains || []) {
				brandDomains.add(d.replace(/^www\./, "").toLowerCase());
			}
		}

		// Known competitor domains from baseline metrics or brand competitors
		const competitorDomains = new Set<string>();
		for (const comp of metricsData?.competitors || []) {
			if (Array.isArray(comp.domains)) {
				for (const d of comp.domains) competitorDomains.add(d.replace(/^www\./, "").toLowerCase());
			}
			if (comp.website) {
				try {
					const u = new URL(comp.website.startsWith("http") ? comp.website : `https://${comp.website}`);
					competitorDomains.add(u.hostname.replace(/^www\./, "").toLowerCase());
				} catch {}
			}
		}

		for (const c of allCitations) {
			let domain = c.domain;
			if (!domain && c.url) {
				try {
					domain = new URL(c.url).hostname.replace(/^www\./, "").toLowerCase();
				} catch {
					domain = "unknown";
				}
			}
			domain = (domain || "unknown").toLowerCase();

			let cat: CitationCategory = "other";
			const raw = (c.source_type || c.category || "").toLowerCase();
			const isOwn =
				brandDomains.has(domain) ||
				raw === "own_domain" ||
				raw === "brand" ||
				raw === "official" ||
				c.category === "own_domain" ||
				c.source_type === "own_domain" ||
				c.category === "brand" ||
				c.source_type === "official";
			const isComp =
				competitorDomains.has(domain) ||
				raw === "competitor" ||
				c.category === "competitor" ||
				c.source_type === "competitor";

			if (isOwn) {
				cat = "brand";
			} else if (isComp) {
				cat = "competitor";
			} else {
				if (raw === "media" || raw === "news" || raw === "editorial") {
					cat = "editorial";
				} else if (raw === "social" || raw === "ugc_or_community" || raw === "community") {
					cat = "social";
				} else if (raw === "institutional" || raw === "gov_or_public" || raw === "industry_assoc") {
					cat = "institutional";
				} else if (raw === "ecommerce") {
					cat = "ecommerce";
				} else if (raw === "reviews") {
					cat = "reviews";
				} else if (raw === "pr" || raw === "b2b_or_directory") {
					cat = "pr";
				} else if (raw === "developer") {
					cat = "developer";
				} else if (raw === "reference") {
					cat = "reference";
				} else {
					cat = "other";
				}
			}

			categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

			const dEntry = domainCounts.get(domain) || { count: 0, category: cat, exampleTitle: c.title };
			dEntry.count += 1;
			if (c.title && !dEntry.exampleTitle) dEntry.exampleTitle = c.title;
			domainCounts.set(domain, dEntry);

			const u = c.url || domain;
			const uEntry = urlCounts.get(u) || { url: u, domain, title: c.title, count: 0, category: cat, pageType: c.page_type || "other", promptCount: 0 };
			uEntry.count += 1;
			uEntry.promptCount += 1;
			urlCounts.set(u, uEntry);
		}

		const domainDistribution = Array.from(domainCounts.entries())
			.map(([domain, info]) => ({
				domain,
				count: info.count,
				category: info.category,
				exampleTitle: info.exampleTitle,
			}))
			.sort((a, b) => b.count - a.count);

		const specificUrls = Array.from(urlCounts.values()).sort((a, b) => b.count - a.count);

		// Derive unique domains strictly from the matching formal citation domain counts
		const uniqueDomains = domainCounts.size;

		const rawSampleDate = (runData?.completed_at || runData?.created_at || "").slice(0, 10);
		const sampleDate = /^\d{4}-\d{2}-\d{2}$/.test(rawSampleDate) ? rawSampleDate : "";

		return {
			totalCitations,
			uniqueDomains,
			categoryCounts,
			domainDistribution,
			specificUrls,
			citationTimeSeries: sampleDate ? [{ date: sampleDate, ...toRoundedPercentages(categoryCounts) }] : [],
		};
	}, [activeBaseline, filters.tags, filters.lookback, brand, modelParam]);

	const baselineTags = useMemo(() => {
		const rawFormal = activeBaseline.evidenceData?.formal_questions;
		const rawQuestions: any[] = rawFormal || activeBaseline.metricsData?.questions?.filter((q: any) => !q.is_probe) || [];
		const set = new Set<string>();
		for (const q of rawQuestions) {
			if (q.dimension_name) set.add(q.dimension_name);
		}
		return Array.from(set);
	}, [activeBaseline.evidenceData?.formal_questions, activeBaseline.metricsData?.questions]);

	const baselineModels = useMemo(() => {
		const runModel = activeBaseline.runData?.model_name || "doubao-pro-32k";
		const brandModels = brand?.effectiveModels || [];
		const combined = Array.from(new Set([runModel, ...brandModels]));
		return getAvailableModels(combined);
	}, [activeBaseline.runData?.model_name, brand?.effectiveModels]);

	const probeCitationsCount = useMemo(() => {
		const probeQuestions: any[] = activeBaseline.evidenceData?.probe_questions || [];
		return probeQuestions.reduce((acc: number, q: any) => acc + (Array.isArray(q.citations) ? q.citations.length : 0), 0);
	}, [activeBaseline.evidenceData?.probe_questions]);

	const effectiveCitationData = activeBaseline.hasBaselineRuns ? baselineCitationData : citationData;
	const effectiveTags = activeBaseline.hasBaselineRuns ? baselineTags : citationData?.availableTags || [];
	const effectiveModels = activeBaseline.hasBaselineRuns ? baselineModels : availableModels;
	const effectiveLoading = activeBaseline.isLoadingRunsList || (activeBaseline.hasBaselineRuns
		? activeBaseline.isLoading && !activeBaseline.runData
		: isLoading);
	const effectiveError = activeBaseline.hasBaselineRuns ? activeBaseline.isError : isError;

	const infoContent = (
		<>
			<p className="mb-2">
				Citations are the links and sources that AI models include in their responses when answering your prompts. They
				show which websites the AI considers authoritative or relevant to your topics.
			</p>
			<p>
				<strong>Competitor</strong> domains are only those you&apos;ve added to your{" "}
				<Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">
					tracked competitors list
				</Link>
				. Other domains appear under their detected category (Google, Social Media, Institutional, or Other).
			</p>
		</>
	);

	const showFullSkeleton = effectiveLoading && !effectiveCitationData;

	if (activeBaseline.isRequestedRunMissing) {
		return (
			<PageHeader
				title="Citations"
				subtitle="See which sources LLMs cite when responding to your prompts."
				infoContent={infoContent}
			>
				<div className="space-y-6">
					<DiagnosisRunBanner
						activeRunId={activeBaseline.activeRunId}
						runsList={activeBaseline.runsList}
						runData={activeBaseline.runData}
						metricsData={activeBaseline.metricsData}
						onSelectRun={activeBaseline.selectRun}
						brandId={brandId}
						isRequestedRunMissing={true}
					/>
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
				</div>
			</PageHeader>
		);
	}

	if (isUnsupportedBaselineModel(filters.model)) {
		return (
			<PageHeader
				title="Citations"
				subtitle="See which sources LLMs cite when responding to your prompts."
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
					<FilterBar
						availableTags={effectiveTags}
						availableModels={effectiveModels}
						showSearch={false}
						showModelSelector={true}
					/>
					<UnsupportedModelNotice />
				</div>
			</PageHeader>
		);
	}

	const isFilteredOut =
		filters.tags.length > 0 ||
		(activeBaseline.hasBaselineRuns &&
			!isRunWithinLookback(
				activeBaseline.runData?.completed_at || activeBaseline.runData?.created_at,
				filters.lookback,
			));

	return (
		<PageHeader
			title="Citations"
			subtitle="See which sources LLMs cite when responding to your prompts."
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

				{activeBaseline.hasBaselineRuns && (
					<div className="text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-1">
						<span>
							{isZh
								? `当前信源统计基于核心正式题（共 ${effectiveCitationData?.totalCitations ?? 0} 条引用 / ${effectiveCitationData?.uniqueDomains ?? 0} 个独立域名，品牌份额 ${effectiveCitationData?.totalCitations ? Math.round(((effectiveCitationData.categoryCounts?.brand ?? 0) / effectiveCitationData.totalCitations) * 100) : 0}%）。`
								: `Statistics derived from core formal prompts (${effectiveCitationData?.totalCitations ?? 0} citations / ${effectiveCitationData?.uniqueDomains ?? 0} domains).`}
						</span>
						{probeCitationsCount > 0 && (
							<span className="text-muted-foreground/80">
								{isZh
									? `* 补充探针引用 ${probeCitationsCount} 条已按口径独立隔离。`
									: `* Supplemental probe citations (${probeCitationsCount}) are isolated.`}
							</span>
						)}
					</div>
				)}

				<FilteredListShell
					filters={filters}
					availableTags={effectiveTags}
					availableModels={effectiveModels}
					showModelSelector
					isLoading={showFullSkeleton}
					loadingState={
						<Card>
							<CardHeader>
								<Skeleton className="h-6 w-48" />
							</CardHeader>
							<CardContent>
								<div className="space-y-4">
									<Skeleton className="h-4 w-3/4" />
									<Skeleton className="h-4 w-1/2" />
									<Skeleton className="h-4 w-2/3" />
								</div>
							</CardContent>
						</Card>
					}
					isError={Boolean(effectiveError)}
					errorState={
						<Card>
							<CardContent className="pt-6">
								<div className="text-red-600 text-sm bg-red-50 p-3 rounded-md">
									{isZh ? "加载信源引用数据失败，请重试。" : "Failed to load citation data. Please try again."}
								</div>
							</CardContent>
						</Card>
					}
					totalCount={effectiveCitationData?.totalCitations}
					noMatchesTitle={
						isZh
							? isFilteredOut
								? "当前筛选无结果"
								: "当前筛选条件下未找到信源引用"
							: "No citations found for the selected filters."
					}
					noMatchesDescription={isZh ? "请尝试调整筛选标签或时间范围。" : "Try adjusting your filters or time period."}
					emptyState={
						<Card>
							<CardContent className="pt-6">
								<div className="text-muted-foreground text-center py-8">
									{isZh
										? "暂无信源引用数据。仅在启用联网检索时才能获得信源引用。"
										: "No citations found. Citations are only available from prompts evaluated with web search enabled."}
								</div>
							</CardContent>
						</Card>
					}
				>
					{effectiveCitationData && (
						<CitationsDisplay
							citationData={effectiveCitationData}
							brandId={brandId}
							brandName={brand?.name}
							showStats={true}
							maxDomains={10}
							maxUrls={20}
							days={days}
							onCompetitorAdded={() => {
								if (!activeBaseline.hasBaselineRuns) {
									revalidateCitations();
								}
								queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
								queryClient.invalidateQueries({ queryKey: brandKeys.competitors(brandId) });
								queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
							}}
						/>
					)}
				</FilteredListShell>
			</div>
		</PageHeader>
	);
}
