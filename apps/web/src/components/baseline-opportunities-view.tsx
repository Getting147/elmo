import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	IconBulb,
	IconCheck,
	IconAlertTriangle,
	IconFileText,
	IconSparkles,
	IconShieldCheck,
	IconClock,
	IconArrowRight,
	IconTarget,
	IconLayersSubtract,
	IconAlertCircle,
	IconRefresh,
} from "@tabler/icons-react";
import { useLanguage } from "@/lib/language-context";
import { DiagnosisRunBanner } from "@/components/diagnosis-run-banner";
import type { ActiveBaselineRunResult } from "@/hooks/use-active-baseline-run";
import { isUnsupportedBaselineModel, isRunWithinLookback } from "@/lib/model-filter";
import { UnsupportedModelNotice } from "@/components/unsupported-model-notice";

interface BaselineOpportunitiesViewProps {
	brandId: string;
	activeBaseline: ActiveBaselineRunResult;
	model?: string;
	lookback?: string;
}

export function BaselineOpportunitiesView({
	brandId,
	activeBaseline,
	model,
	lookback,
}: BaselineOpportunitiesViewProps) {
	const { language } = useLanguage();
	const isZh = language === "zh";

	const {
		runData,
		metricsData,
		analysisData,
		isLoading,
		isError,
		isLoadingAnalysis,
		isAnalysisError,
		isRequestedRunMissing,
	} = activeBaseline;

	const hasAnalysis = Boolean(analysisData && (analysisData.payload || analysisData.analysis_id));
	const payload = analysisData?.payload;

	const isApproved =
		analysisData?.status === "approved" ||
		analysisData?.review_status === "approved" ||
		payload?.status === "approved" ||
		payload?.review_status === "approved";
	const analystName = analysisData?.analyst_name || (isZh ? "Negency 分析团队" : "Negency Analytics Team");
	const modelName = payload?.ai_metadata?.model || "deepseek-chat";
	const evaluationDate = (analysisData?.updated_at || analysisData?.created_at || runData?.completed_at || "")
		.replace("T", " ")
		.slice(0, 16);

	const executiveConclusion = payload?.executive_conclusion;
	const keyFindings: string[] = Array.isArray(payload?.key_findings)
		? payload.key_findings
		: typeof payload?.key_findings === "string"
			? [payload.key_findings]
			: [];

	const actionPlan: any[] = Array.isArray(payload?.action_plan) ? payload.action_plan : [];
	const channelGaps: any[] = Array.isArray(payload?.channel_gaps) ? payload.channel_gaps : [];
	const contentGaps: string[] = Array.isArray(payload?.content_gaps)
		? payload.content_gaps
		: typeof payload?.content_gaps === "string"
			? [payload.content_gaps]
			: [];
	const rootCauses: any[] = Array.isArray(payload?.root_causes) ? payload.root_causes : [];

	if (isLoading && !runData) {
		return (
			<div className="space-y-6">
				<Skeleton className="h-24 w-full rounded-xl" />
				<Skeleton className="h-32 w-full rounded-xl" />
				<Skeleton className="h-64 w-full rounded-xl" />
			</div>
		);
	}

	if (isRequestedRunMissing) {
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
				<UnsupportedModelNotice />
			</div>
		);
	}

	if (!isRunWithinLookback(runData?.completed_at || runData?.created_at, lookback)) {
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
				<Card>
					<CardContent className="pt-6">
						<div className="text-muted-foreground text-center py-8">
							{isZh ? "当前筛选无结果" : "No results for the selected filters."}
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

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

			{/* F05: Four distinct states: Loading -> Fetch Error (503) -> Authentic Missing (404) -> Populated */}
			{isLoadingAnalysis && !hasAnalysis ? (
				<Card className="border border-border/80 shadow-sm">
					<CardContent className="p-6 space-y-4">
						<Skeleton className="h-6 w-48" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-32 w-full" />
					</CardContent>
				</Card>
			) : isAnalysisError && !hasAnalysis ? (
				<Card className="border border-destructive/40 shadow-sm bg-rose-50/20 dark:bg-rose-950/20">
					<CardContent className="py-10 px-6 text-center space-y-4">
						<div className="size-12 mx-auto rounded-full bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 dark:text-rose-400">
							<IconAlertTriangle size={24} />
						</div>
						<div className="space-y-1.5 max-w-md mx-auto">
							<h3 className="text-base font-semibold text-foreground">
								{isZh ? "加载机会分析建议失败" : "Failed to Load Opportunities Analysis"}
							</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								{isZh
									? "读取分析报告时服务器响应异常（如 503 服务暂不可用或网络超时）。请点击下方重试读取，此操作仅重新拉取已有数据，不会触发重新生成或额外扣费。"
									: "An error occurred while fetching analysis report (e.g. 503 service unavailable). Click below to retry reading."}
							</p>
						</div>
						<div className="pt-2 flex justify-center gap-3">
							<Button
								variant="outline"
								size="sm"
								className="gap-1.5"
								onClick={() => activeBaseline.refetchAnalysis()}
							>
								<IconRefresh size={15} />
								<span>{isZh ? "重试读取" : "Retry"}</span>
							</Button>
						</div>
					</CardContent>
				</Card>
			) : !hasAnalysis ? (
				<Card className="border border-border/80 shadow-sm">
					<CardContent className="py-12 px-6 text-center space-y-4">
						<div className="size-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
							<IconBulb size={24} />
						</div>
						<div className="space-y-1.5 max-w-md mx-auto">
							<h3 className="text-base font-semibold text-foreground">
								{isZh ? "当前诊断任务尚未生成增长机会建议" : "No Opportunities Generated Yet"}
							</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								{isZh
									? "当前选中的诊断任务尚未包含 DeepSeek 结构化机会分析与行动建议。您可前往诊断报告门户完成专业生成与审核。"
									: "The current diagnostic run has not generated structured DeepSeek opportunities. You can review and generate them in the Diagnostic Reports portal."}
							</p>
						</div>
						<div className="pt-2">
							<Button asChild size="sm" className="gap-1.5">
								<Link
									to="/app/$brand/reports"
									params={{ brand: brandId }}
									search={{ runId: activeBaseline.activeRunId }}
								>
									<IconFileText size={15} />
									<span>{isZh ? "前往诊断报告页面查看/生成 →" : "Go to Reports Portal →"}</span>
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-6">
					{/* Metadata Header Card */}
					<Card className="border border-border/80 shadow-sm bg-muted/20">
						<CardContent className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-semibold text-foreground">
									{isZh ? "分析版本:" : "Analysis Version:"}
								</span>
								<span className="font-mono text-muted-foreground">
									{analysisData.analysis_id || "v1"}
								</span>

								<span className="text-muted-foreground/40">|</span>

								<span className="font-semibold text-foreground">
									{isZh ? "分析团队/模型:" : "Analyst / Model:"}
								</span>
								<span>
									{analystName} ({modelName})
								</span>

								<span className="text-muted-foreground/40">|</span>

								{isApproved ? (
									<Badge
										variant="secondary"
										className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 gap-1 text-[11px]"
									>
										<IconShieldCheck size={12} />
										<span>{isZh ? "已审核" : "Approved"}</span>
									</Badge>
								) : (
									<Badge variant="outline" className="text-muted-foreground text-[11px]">
										{isZh ? "草稿 (待审核)" : "Draft (Pending Review)"}
									</Badge>
								)}
							</div>

							{evaluationDate && (
								<div className="flex items-center gap-1 text-muted-foreground">
									<IconClock size={13} />
									<span>{evaluationDate}</span>
								</div>
							)}
						</CardContent>
					</Card>

					{/* Executive Conclusion */}
					{executiveConclusion && (
						<Card className="border border-border/80 shadow-sm bg-gradient-to-br from-background to-blue-50/20 dark:to-blue-950/10">
							<CardHeader className="p-5 pb-2">
								<div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
									<IconSparkles size={16} />
									<span>{isZh ? "执行摘要与战略结论" : "Executive Conclusion"}</span>
								</div>
							</CardHeader>
							<CardContent className="p-5 pt-2">
								<p className="text-base text-foreground leading-relaxed whitespace-pre-wrap">
									{typeof executiveConclusion === "object"
										? (executiveConclusion as any).summary || JSON.stringify(executiveConclusion)
										: executiveConclusion}
								</p>
							</CardContent>
						</Card>
					)}

					{/* Key Findings */}
					{keyFindings.length > 0 && (
						<Card className="border border-border/80 shadow-sm">
							<CardHeader className="p-5 pb-2">
								<div className="flex items-center gap-2 text-foreground font-semibold text-sm">
									<IconTarget size={16} className="text-blue-600 dark:text-blue-400" />
									<span>{isZh ? "核心问题发现" : "Key Findings"}</span>
								</div>
							</CardHeader>
							<CardContent className="p-5 pt-2">
								<ul className="space-y-2">
									{keyFindings.map((finding, idx) => (
										<li key={idx} className="flex items-start gap-2.5 text-sm text-foreground leading-relaxed">
											<span className="size-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
											<span>{finding}</span>
										</li>
									))}
								</ul>
							</CardContent>
						</Card>
					)}

					{/* Priority Action Plan */}
					{actionPlan.length > 0 && (
						<div className="space-y-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2 font-semibold text-base text-foreground">
									<IconBulb size={18} className="text-amber-500" />
									<span>{isZh ? "优先增长机会与行动计划" : "Priority Action Plan"}</span>
								</div>
								<Badge variant="outline" className="text-xs font-normal">
									{actionPlan.length} {isZh ? "项待办行动" : "actions"}
								</Badge>
							</div>

							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{actionPlan.map((action, idx) => {
									const priority = action.priority || "P1";
									const isP0 = priority === "P0";
									const isP1 = priority === "P1";

									return (
										<Card
											key={idx}
											className="border border-border/80 shadow-sm flex flex-col justify-between overflow-hidden"
										>
											<CardHeader className="p-4 pb-2">
												<div className="flex items-center justify-between gap-2">
													<Badge
														variant="secondary"
														className={
															isP0
																? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-400 font-semibold text-[11px]"
																: isP1
																	? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 font-semibold text-[11px]"
																	: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400 font-semibold text-[11px]"
														}
													>
														{priority} {isP0 ? (isZh ? "· 核心阻断" : "Blocker") : (isZh ? "· 优先整改" : "Priority")}
													</Badge>

													{action.deliverable && (
														<span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
															{action.deliverable}
														</span>
													)}
												</div>

												<h4 className="text-sm font-semibold mt-2.5 leading-snug text-foreground">
													{action.action || action.finding || `Action #${idx + 1}`}
												</h4>
											</CardHeader>

											<CardContent className="p-4 pt-1 space-y-2 text-xs">
												{action.expected_impact && (
													<div className="text-muted-foreground">
														<span className="font-medium text-foreground">
															{isZh ? "预期效果: " : "Impact: "}
														</span>
														<span>{action.expected_impact}</span>
													</div>
												)}

												{Array.isArray(action.evidence_refs) && action.evidence_refs.length > 0 && (
													<div className="pt-2 border-t border-border/40 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
														<span className="font-medium">{isZh ? "关联问题:" : "Refs:"}</span>
														{action.evidence_refs.map((ref: string, rIdx: number) => (
															<span
																key={rIdx}
																className="font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground"
															>
																{ref}
															</span>
														))}
													</div>
												)}
											</CardContent>
										</Card>
									);
								})}
							</div>
						</div>
					)}

					{/* Channel Gaps & Content Gaps */}
					{(channelGaps.length > 0 || contentGaps.length > 0) && (
						<div className="grid gap-6 md:grid-cols-2">
							{channelGaps.length > 0 && (
								<Card className="border border-border/80 shadow-sm">
									<CardHeader className="p-4 pb-2">
										<div className="flex items-center gap-2 font-semibold text-sm">
											<IconLayersSubtract size={16} className="text-blue-500" />
											<span>{isZh ? "高价值引用位与渠道缺口" : "Channel Gaps"}</span>
										</div>
									</CardHeader>
									<CardContent className="p-4 pt-2">
										<div className="space-y-3">
											{channelGaps.map((cg, idx) => (
												<div key={idx} className="p-3 rounded-lg bg-muted/30 border border-border/40 text-xs space-y-1">
													<div className="flex items-center justify-between">
														<span className="font-semibold text-foreground">
															{cg.channel_type || cg.name}
														</span>
														{cg.actionability && (
															<Badge variant="outline" className="text-[10px]">
																{cg.actionability}
															</Badge>
														)}
													</div>
													{cg.strategic_note && (
														<p className="text-muted-foreground leading-relaxed">
															{cg.strategic_note}
														</p>
													)}
												</div>
											))}
										</div>
									</CardContent>
								</Card>
							)}

							{contentGaps.length > 0 && (
								<Card className="border border-border/80 shadow-sm">
									<CardHeader className="p-4 pb-2">
										<div className="flex items-center gap-2 font-semibold text-sm">
											<IconFileText size={16} className="text-amber-500" />
											<span>{isZh ? "缺失内容资产与知识缺口" : "Content Gaps"}</span>
										</div>
									</CardHeader>
									<CardContent className="p-4 pt-2">
										<ul className="space-y-2.5">
											{contentGaps.map((gap, idx) => (
												<li key={idx} className="flex items-start gap-2 text-xs text-foreground leading-relaxed">
													<span className="size-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
													<span>{gap}</span>
												</li>
											))}
										</ul>
									</CardContent>
								</Card>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
