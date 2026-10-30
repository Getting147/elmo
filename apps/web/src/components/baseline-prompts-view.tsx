import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	IconCheck,
	IconX,
	IconChevronDown,
	IconChevronUp,
	IconWorld,
	IconExternalLink,
	IconSearch,
} from "@tabler/icons-react";
import { useLanguage } from "@/lib/language-context";
import { VisibilityBar, VisibilityBarEmpty } from "@/components/visibility-bar";
import { DiagnosisRunBanner } from "@/components/diagnosis-run-banner";
import { FilterBar, ALL_MODELS_VALUE } from "@/components/filter-bar";
import { FilteredListShell } from "@/components/filtered-list-shell";
import type { useListFilters } from "@/hooks/use-list-filters";
import type { ActiveBaselineRunResult } from "@/hooks/use-active-baseline-run";
import { isUnsupportedBaselineModel, isRunWithinLookback, getAvailableModels } from "@/lib/model-filter";
import { UnsupportedModelNotice } from "@/components/unsupported-model-notice";
import { IconAlertCircle } from "@tabler/icons-react";
import { useBrand } from "@/hooks/use-brands";

interface BaselinePromptsViewProps {
	brandId: string | undefined;
	activeBaseline: ActiveBaselineRunResult;
	filters: ReturnType<typeof useListFilters>;
}

export function BaselinePromptsView({
	brandId,
	activeBaseline,
	filters,
}: BaselinePromptsViewProps) {
	const { language } = useLanguage();
	const isZh = language === "zh";
	const { model, lookback, tags, search } = filters;

	const { runData, metricsData, evidenceData, isLoading, isError } = activeBaseline;

	// Questions list: merge formal questions from metrics and evidence
	// Strictly exclude probe questions (!is_probe) to prevent polluting formal question denominator (Task 4.3 & 5.2)
	const questions = useMemo(() => {
		const rawMetricsQuestions: any[] = metricsData?.questions || [];
		const metricsQuestions: any[] = rawMetricsQuestions.filter((q: any) => !q.is_probe);
		const evidenceQuestions: any[] = evidenceData?.formal_questions || [];

		// Create a map by question code or question text
		const evidenceMap = new Map<string, any>();
		for (const eq of evidenceQuestions) {
			const key = eq.question_code || eq.question_id || eq.question_text;
			if (key) evidenceMap.set(key, eq);
		}

		if (metricsQuestions.length > 0) {
			return metricsQuestions.map((mq: any) => {
				const key = mq.code || mq.question_id || mq.text || mq.question_text;
				const ev = evidenceMap.get(key) || {};
				return {
					id: mq.code || mq.question_id || mq.text,
					code: mq.code || ev.question_code || "Q",
					text: mq.text || mq.question_text || ev.question_text || "",
					dimension_name: mq.dimension_name || ev.dimension_name || "综合",
					effective_mention: mq.effective_mention ?? ev.effective_mention ?? false,
					citation_count: mq.citation_count ?? ev.citations?.length ?? 0,
					citations: ev.citations || [],
					search_queries: ev.search_queries || [],
					answer_excerpt: mq.answer_excerpt || ev.answer_text?.slice(0, 200) || "",
					full_answer_text: mq.full_answer_text || ev.answer_text || "",
				};
			});
		}

		// Fallback to evidence questions if metrics questions are not yet populated
		return evidenceQuestions.map((eq: any, index: number) => ({
			id: eq.question_code || eq.question_id || `q-${index}`,
			code: eq.question_code || `Q${index + 1}`,
			text: eq.question_text || "",
			dimension_name: eq.dimension_name || "综合",
			effective_mention: eq.effective_mention ?? false,
			citation_count: eq.citations?.length ?? 0,
			citations: eq.citations || [],
			search_queries: eq.search_queries || [],
			answer_excerpt: eq.answer_text?.slice(0, 200) || "",
			full_answer_text: eq.answer_text || "",
		}));
	}, [metricsData?.questions, evidenceData?.formal_questions]);

	// Extract available dimensions as tags
	const availableTags = useMemo(() => {
		const tagSet = new Set<string>();
		for (const q of questions) {
			if (q.dimension_name) tagSet.add(q.dimension_name);
		}
		return Array.from(tagSet);
	}, [questions]);

	const { brand } = useBrand(brandId);
	const availableModels = useMemo(() => {
		const runModel = runData?.model_name || "doubao-pro-32k";
		const brandModels = brand?.effectiveModels || [];
		const combined = Array.from(new Set([runModel, ...brandModels]));
		return getAvailableModels(combined);
	}, [runData?.model_name, brand?.effectiveModels]);

	// Filter questions by selected search, tags, lookback, and model
	const filteredQuestions = useMemo(() => {
		return questions.filter((q) => {
			// Lookback filter
			if (!isRunWithinLookback(runData?.completed_at || runData?.created_at, lookback)) {
				return false;
			}
			// Tag filter
			if (tags.length > 0 && !tags.includes(q.dimension_name)) {
				return false;
			}
			// Search filter
			if (search) {
				const lower = search.toLowerCase();
				const matchText = q.text.toLowerCase().includes(lower);
				const matchDimension = q.dimension_name.toLowerCase().includes(lower);
				if (!matchText && !matchDimension) return false;
			}
			// Model filter
			if (model && model !== ALL_MODELS_VALUE && model !== runData?.model_name) {
				return false;
			}
			return true;
		});
	}, [questions, tags, search, model, lookback, runData?.model_name, runData?.completed_at, runData?.created_at]);

	const p0Summary = metricsData?.p0_summary;
	const domainMetrics = metricsData?.domain_metrics;
	const validQuestions =
		p0Summary?.effective_sample_count ??
		p0Summary?.planned_questions ??
		runData?.valid_questions ??
		runData?.total_questions ??
		0;
	const mentionCount =
		p0Summary?.broad_mention_count ??
		p0Summary?.effective_mention_count ??
		0;
	const mentionRate = validQuestions > 0 ? mentionCount / validQuestions : 0;
	const sampleDate = (runData?.completed_at || runData?.created_at || "").slice(0, 10);

	const visibilityBarElement = useMemo(() => {
		// F05: Suppress visibility bar on error or missing metrics data
		if (isError || !metricsData) {
			return null;
		}

		if (!isRunWithinLookback(runData?.completed_at || runData?.created_at, lookback)) {
			return (
				<VisibilityBarEmpty
					message={
						isZh
							? "当前筛选无结果"
							: "No prompts match your selected filters."
					}
				/>
			);
		}

		if (filters.isFiltered) {
			if (filteredQuestions.length === 0) {
				return (
					<VisibilityBarEmpty
						message={
							isZh
								? "当前筛选无结果"
								: "No prompts or visibility data match your selected filters."
						}
					/>
				);
			}
			const filteredCount = filteredQuestions.length;
			const filteredMentions = filteredQuestions.filter((q) => q.effective_mention).length;
			const filteredRate = filteredCount > 0 ? filteredMentions / filteredCount : 0;
			const filteredCitations = filteredQuestions.reduce((sum, q) => sum + (q.citation_count || 0), 0);
			return (
				<VisibilityBar
					currentVisibility={Math.round(filteredRate * 100)}
					totalRuns={filteredCount}
					totalPrompts={filteredCount}
					totalCitations={filteredCitations}
					visibilityTimeSeries={
						sampleDate ? [{ date: sampleDate, visibility: Math.round(filteredRate * 100) }] : []
					}
					lookback={lookback}
				/>
			);
		}

		if (validQuestions === 0) {
			return (
				<VisibilityBarEmpty
					message={
						isZh
							? "当前诊断任务无有效正式题样本，可见度不可计算"
							: "No valid formal questions in this diagnostic run. Visibility is not computable."
					}
				/>
			);
		}
		return (
			<VisibilityBar
				currentVisibility={Math.round(mentionRate * 100)}
				totalRuns={validQuestions}
				totalPrompts={validQuestions}
				totalCitations={domainMetrics?.total_citations ?? 0}
				visibilityTimeSeries={
					sampleDate ? [{ date: sampleDate, visibility: Math.round(mentionRate * 100) }] : []
				}
				lookback={lookback}
			/>
		);
	}, [
		isError,
		metricsData,
		filters.isFiltered,
		filteredQuestions,
		validQuestions,
		mentionRate,
		domainMetrics?.total_citations,
		sampleDate,
		lookback,
		isZh,
		runData?.completed_at,
		runData?.created_at,
	]);

	if (isLoading && !runData && !metricsData) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-24 w-full rounded-xl" />
				<Skeleton className="h-12 w-full rounded-lg" />
				<div className="space-y-4">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-32 w-full rounded-xl" />
					))}
				</div>
			</div>
		);
	}

	if (activeBaseline.isRequestedRunMissing) {
		return (
			<div className="space-y-6">
				<DiagnosisRunBanner
					activeRunId={activeBaseline.activeRunId}
					runsList={activeBaseline.runsList}
					runData={runData}
					metricsData={metricsData}
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
		);
	}

	if (isUnsupportedBaselineModel(model)) {
		return (
			<div className="space-y-6">
				<DiagnosisRunBanner
					activeRunId={activeBaseline.activeRunId}
					runsList={activeBaseline.runsList}
					runData={runData}
					metricsData={metricsData}
					onSelectRun={activeBaseline.selectRun}
					brandId={brandId}
					isRequestedRunMissing={activeBaseline.isRequestedRunMissing}
				/>
				<FilterBar
					availableTags={availableTags}
					availableModels={availableModels}
					showSearch
					showModelSelector
				/>
				<UnsupportedModelNotice />
			</div>
		);
	}

	const isFilteredOut =
		tags.length > 0 ||
		Boolean(search) ||
		(activeBaseline.hasBaselineRuns &&
			!isRunWithinLookback(
				activeBaseline.runData?.completed_at || activeBaseline.runData?.created_at,
				lookback,
			));

	return (
		<div className="space-y-6">
			<DiagnosisRunBanner
				activeRunId={activeBaseline.activeRunId}
				runsList={activeBaseline.runsList}
				runData={runData}
				metricsData={metricsData}
				onSelectRun={activeBaseline.selectRun}
				brandId={brandId}
				isRequestedRunMissing={activeBaseline.isRequestedRunMissing}
			/>

			<FilteredListShell
				filters={filters}
				availableTags={availableTags}
				availableModels={availableModels}
				showSearch
				showModelSelector
				showResultCount
				filterSectionExtras={visibilityBarElement}
				totalCount={questions.length}
				filteredCount={filteredQuestions.length}
				noMatchesTitle={
					isZh
						? isFilteredOut
							? "当前筛选无结果"
							: "未找到符合筛选条件的问题"
						: "No prompts match your filters."
				}
				noMatchesDescription={
					isZh
						? "请尝试放宽标签或搜索关键词筛选。"
						: "Try adjusting your search or tag filters."
				}
				isLoading={isLoading}
				isError={isError}
				errorState={
					<Card className="p-6">
						<div className="text-center text-muted-foreground">
							<p className="mb-2">
								{isZh ? "加载诊断评测数据失败" : "Failed to load diagnostic run data"}
							</p>
							<p className="text-sm">
								{isZh ? "请刷新页面重试" : "Try refreshing the page"}
							</p>
						</div>
					</Card>
				}
				emptyState={
					<Card className="p-6">
						<div className="text-center text-muted-foreground py-8">
							<p className="mb-2">
								{isZh ? "当前诊断任务未包含有效题目" : "No questions in this diagnostic run"}
							</p>
						</div>
					</Card>
				}
			>
				<div className="space-y-4">
					{filteredQuestions.map((q, idx) => (
						<QuestionCard key={q.id || idx} question={q} index={idx + 1} isZh={isZh} />
					))}
				</div>
			</FilteredListShell>
		</div>
	);
}

function QuestionCard({
	question,
	index,
	isZh,
}: {
	question: any;
	index: number;
	isZh: boolean;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<Card className="overflow-hidden border border-border/80 shadow-sm transition-all hover:border-border">
			<CardHeader className="p-4 pb-2">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
							#{question.code || index}
						</span>
						{question.dimension_name && (
							<Badge variant="outline" className="text-xs font-normal">
								{question.dimension_name}
							</Badge>
						)}
					</div>

					<div>
						{question.effective_mention ? (
							<Badge
								variant="secondary"
								className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 gap-1 text-xs"
							>
								<IconCheck size={13} />
								<span>{isZh ? "100% 可见度 · 品牌已提及" : "100% Visibility · Mentioned"}</span>
							</Badge>
						) : (
							<Badge
								variant="outline"
								className="text-muted-foreground gap-1 text-xs"
							>
								<IconX size={13} />
								<span>{isZh ? "0% 可见度 · 品牌未提及" : "0% Visibility · Not Mentioned"}</span>
							</Badge>
						)}
					</div>
				</div>

				<h3 className="text-base font-medium mt-2 leading-snug text-foreground">
					{question.text}
				</h3>
			</CardHeader>

			<CardContent className="p-4 pt-1 space-y-3">
				{/* Metrics Summary Row */}
				<div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground border-t border-border/40 pt-2.5">
					<span className="flex items-center gap-1">
						<IconWorld size={13} />
						<span>
							{question.citation_count}{" "}
							{isZh ? "个信源引用" : `citation${question.citation_count !== 1 ? "s" : ""}`}
						</span>
					</span>

					{question.search_queries?.length > 0 && (
						<>
							<span>•</span>
							<span className="flex items-center gap-1">
								<IconSearch size={13} />
								<span>
									{question.search_queries.length}{" "}
									{isZh ? "条搜索检索" : "web searches"}
								</span>
							</span>
						</>
					)}

					{(question.full_answer_text || question.answer_excerpt) && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setExpanded(!expanded)}
							className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
						>
							<span>{expanded ? (isZh ? "收起回答" : "Collapse") : (isZh ? "查看模型回答" : "View Response")}</span>
							{expanded ? <IconChevronUp size={14} className="ml-1" /> : <IconChevronDown size={14} className="ml-1" />}
						</Button>
					)}
				</div>

				{/* Expandable Model Response */}
				{expanded && (question.full_answer_text || question.answer_excerpt) && (
					<div className="rounded-lg bg-muted/40 p-3 text-xs space-y-2 border border-border/40">
						<div className="font-semibold text-muted-foreground">
							{isZh ? "模型原始回答摘要:" : "Model Response:"}
						</div>
						<div className="whitespace-pre-wrap leading-relaxed text-foreground font-sans max-h-96 overflow-y-auto">
							{question.full_answer_text || question.answer_excerpt}
						</div>

						{/* Attached Citations */}
						{question.citations?.length > 0 && (
							<div className="mt-3 pt-2 border-t border-border/40 space-y-1">
								<div className="font-semibold text-muted-foreground">
									{isZh ? "引用信源明细:" : "Citations:"}
								</div>
								<div className="flex flex-wrap gap-1.5">
									{question.citations.map((c: any, i: number) => {
										const isSafeUrl = typeof c.url === "string" && /^https?:\/\//i.test(c.url);
										const label = c.title || c.domain || c.url || "Source";
										if (isSafeUrl) {
											return (
												<a
													key={i}
													href={c.url}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border border-border/60 text-[11px] text-blue-600 dark:text-blue-400 hover:underline max-w-xs truncate"
												>
													<span className="truncate">{label}</span>
													<IconExternalLink size={10} className="shrink-0 opacity-60" />
												</a>
											);
										}
										return (
											<span
												key={i}
												className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background border border-border/60 text-[11px] text-muted-foreground max-w-xs truncate"
											>
												<span className="truncate">{label}</span>
											</span>
										);
									})}
								</div>
							</div>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
