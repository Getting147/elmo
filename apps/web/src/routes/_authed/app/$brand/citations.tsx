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
import type { CitationData } from "@/components/citations/types";
import { type CitationCategory, emptyCategoryCounts } from "@/lib/domain-categories";

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
		if (modelParam && modelParam !== runData?.model_name) {
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

		const totalCitations = filters.tags.length > 0
			? allCitations.length
			: (metricsData?.domain_metrics?.total_citations ?? allCitations.length);

		const domainCounts = new Map<string, { count: number; category: CitationCategory; exampleTitle?: string }>();
		const urlCounts = new Map<string, { url: string; domain: string; title?: string; count: number; category: CitationCategory; pageType: any; promptCount: number }>();

		const categoryCounts = emptyCategoryCounts();

		// Known brand domains
		const brandDomains = new Set<string>();
		if (brand?.website) {
			try {
				const u = new URL(brand.website.startsWith("http") ? brand.website : `https://${brand.website}`);
				brandDomains.add(u.hostname.replace(/^www\./, "").toLowerCase());
			} catch {}
		}
		for (const d of brand?.additionalDomains || []) {
			brandDomains.add(d.replace(/^www\./, "").toLowerCase());
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
			const isOwn = brandDomains.has(domain) || c.category === "own_domain" || c.source_type === "own_domain" || c.category === "brand";
			const isComp = competitorDomains.has(domain) || c.category === "competitor" || c.source_type === "competitor";

			if (isOwn) {
				cat = "brand";
			} else if (isComp) {
				cat = "competitor";
			} else {
				const raw = (c.source_type || c.category || "").toLowerCase();
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

		const uniqueDomains = filters.tags.length > 0
			? domainCounts.size
			: (metricsData?.domain_metrics?.unique_domains ?? domainCounts.size);

		const rawSampleDate = (runData?.completed_at || runData?.created_at || "").slice(0, 10);
		const sampleDate = /^\d{4}-\d{2}-\d{2}$/.test(rawSampleDate) ? rawSampleDate : "";

		return {
			totalCitations,
			uniqueDomains,
			categoryCounts,
			domainDistribution,
			specificUrls,
			citationTimeSeries: sampleDate ? [{ date: sampleDate, ...categoryCounts }] : [],
		};
	}, [activeBaseline, filters.tags, brand, modelParam]);

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
		return [activeBaseline.runData?.model_name || "doubao-pro-32k"];
	}, [activeBaseline.runData?.model_name]);

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
					isError={Boolean(effectiveError) || !effectiveCitationData}
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
					noMatchesTitle={isZh ? "当前筛选条件下未找到信源引用" : "No citations found for the selected filters."}
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
