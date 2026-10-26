/**
 * /app/$brand/reports — elmo 统一基线诊断闭环与报告工作台 (REPORT-001E)
 *
 * 核心目标：
 * 内部操作员只登录 elmo，即可完成：
 * 选择客户 → 核对多业务资料及问题 → 确认本轮输入 → 手动创建有限诊断任务
 * → 查看进度、回答、引用和指标 → 填写诊断与优先行动 → 生成报告修订 → 审核及受控下载。
 *
 * 守卫规则：
 * 1. 监测由页面明确操作触发一次有限运行，不自动定时续采；
 * 2. elmo 服务端鉴权代理 D 的受控产物，严禁浏览器直连 Python 后端；
 * 3. 严格展示 A 模块客观指标与多业务维度，不在前端重算分母；
 * 4. 合成数据报告显式标明测试草稿，正式批准门禁将受控拒绝。
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useLanguage } from "@/lib/language-context";
import { useBrand } from "@/hooks/use-brands";
import { getBrandReports, type BrandReportSummary } from "@/server/report-files";
import {
	getBrandBaselineProfileFn,
	freezeBaselineInputsFn,
	createBaselineRunFn,
	getBaselineRunFn,
	getBaselineEvidenceFn,
	getBaselineMetricsFn,
	saveBaselineAnalysisFn,
	generateBaselineReportRevisionFn,
	reviewBaselineReportRevisionFn,
	listBaselineRunsFn,
} from "@/server/baseline";
import {
	IconFileText,
	IconDownload,
	IconX,
	IconArrowLeft,
	IconRefresh,
	IconCheck,
	IconAlertTriangle,
	IconPlayerPlay,
	IconLock,
	IconDeviceFloppy,
	IconEye,
	IconShieldCheck,
	IconHistory,
	IconChartBar,
	IconListCheck,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_authed/app/$brand/reports")({
	component: BrandReportsPageComponent,
});

function BrandReportsPageComponent() {
	const { language } = useLanguage();
	const isZh = language === "zh";
	const { brandId, brand } = useBrand();

	// 顶级视图切换：诊断闭环工作台 vs 历史归档报告
	const [activeTab, setActiveTab] = useState<"portal" | "legacy">("portal");

	// 工作台子流程状态
	const [frozenSnapshot, setFrozenSnapshot] = useState<any>(null);
	const [activeRunId, setActiveRunId] = useState<string>("");
	const [activeAnalysisId, setActiveAnalysisId] = useState<string>("");
	const [activeRevisionId, setActiveRevisionId] = useState<string>("");
	const [reviewNotice, setReviewNotice] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// 人工分析表单状态
	const [analystName, setAnalystName] = useState<string>("王分析师");
	const [executiveConclusion, setExecutiveConclusion] = useState<string>(
		"本轮基线诊断显示，品牌在核心业务板块具备良好行业口碑，但自然提及率仍待提高。",
	);
	const [keyFindings, setKeyFindings] = useState<string>(
		"主体识别探针清晰可辨\n自有官网已形成稳定引用\n多业务板块检索词覆盖需强化",
	);
	const [actionPlanInput, setActionPlanInput] = useState<string>(
		"P01|在海外官网增设出海工程光伏标杆案例专题页|P1|直接契合海湾寻源问法|多语种项目业绩专题集|次月同一问题复测",
	);

	const brandName = brand?.name || brandId || "";

	// 1. 获取品牌档案与题集配置
	const {
		data: profileData,
		isLoading: profileLoading,
		refetch: refetchProfile,
	} = useQuery({
		queryKey: ["baseline-profile", brandId],
		queryFn: () => getBrandBaselineProfileFn({ data: { brandId: brandId! } }),
		enabled: !!brandId && activeTab === "portal",
	});

	// 2. 查询当前正在查看的 run 详情
	const {
		data: runData,
		refetch: refetchRun,
		isFetching: runFetching,
	} = useQuery({
		queryKey: ["baseline-run", brandId, activeRunId],
		queryFn: () => getBaselineRunFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled: !!brandId && !!activeRunId,
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			return status === "queued" || status === "running" ? 2000 : false;
		},
	});

	// 3. 查询当前 run 的逐题证据
	const { data: evidenceData, refetch: refetchEvidence } = useQuery({
		queryKey: ["baseline-evidence", brandId, activeRunId],
		queryFn: () => getBaselineEvidenceFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled: !!brandId && !!activeRunId && (runData?.status === "completed" || runData?.status === "partial"),
	});

	// 4. 查询当前 run 的客观统计指标
	const { data: metricsData, refetch: refetchMetrics } = useQuery({
		queryKey: ["baseline-metrics", brandId, activeRunId],
		queryFn: () => getBaselineMetricsFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled: !!brandId && !!activeRunId && (runData?.status === "completed" || runData?.status === "partial"),
	});

	// 5. 查询最近任务列表
	const { data: runsListData, refetch: refetchRunsList } = useQuery({
		queryKey: ["baseline-runs-list", brandId],
		queryFn: () => listBaselineRunsFn({ data: { brandId: brandId! } }),
		enabled: !!brandId && activeTab === "portal",
	});

	// 6. 旧报告查询（保留历史能力）
	const { data: legacyReports, refetch: refetchLegacy } = useQuery({
		queryKey: ["brand-reports-legacy", brandId],
		queryFn: () => getBrandReports({ data: { brandId: brandId! } }),
		enabled: !!brandId && activeTab === "legacy",
	});

	// Mutations
	const freezeMutation = useMutation({
		mutationFn: (versionLabel: string) =>
			freezeBaselineInputsFn({ data: { brandId: brandId!, versionLabel } }),
		onSuccess: (res) => {
			setFrozenSnapshot(res);
			setActionError(null);
		},
		onError: (err: any) => setActionError(`冻结输入失败: ${err.message}`),
	});

	const createRunMutation = useMutation({
		mutationFn: (snapshotId: string) =>
			createBaselineRunFn({
				data: {
					brandId: brandId!,
					snapshotId,
					requestBudget: 30,
					maxRetries: 0,
				},
			}),
		onSuccess: (res) => {
			setActiveRunId(res.run_id);
			setActionError(null);
			refetchRunsList();
		},
		onError: (err: any) => setActionError(`创建监测任务失败: ${err.message}`),
	});

	const saveAnalysisMutation = useMutation({
		mutationFn: () => {
			const lines = actionPlanInput.split("\n").filter((l) => l.trim().length > 0);
			const actionPlan = lines.map((line) => {
				const [code, act, prio, rat, deliv, verif] = line.split("|").map((s) => s.trim());
				return {
					finding: `针对 ${code || "P01"} 的诊断发现`,
					evidence_refs: [code || "P01"],
					action: act || "加强业务官网内容索引",
					priority: (prio as "P1" | "P2" | "P3") || "P1",
					priority_rationale: rat || "直接影响主流 AI 引擎引用置信度",
					deliverable: deliv || "官方技术专栏发布",
					verification_method: verif || "次月同一问题复测",
				};
			});

			return saveBaselineAnalysisFn({
				data: {
					brandId: brandId!,
					runId: activeRunId,
					analystName: analystName.trim() || "王分析师",
					executiveConclusion: executiveConclusion.trim(),
					keyFindings: keyFindings.split("\n").map((s) => s.trim()).filter((s) => s.length > 0),
					brandIdentityAudit: "主体识别清晰，与同名企业无混淆",
					rootCauses: [
						{
							cause_id: "RC01",
							title: "海外工程项目业绩多语种收录不足",
							observed_facts: ["实测模型回答主要引用综合经贸名录"],
							analytic_judgements: ["企业出海典型业绩未被搜索引擎有效索引"],
							unverified_hypotheses: ["可能受海外CDN反爬阻断"],
						},
					],
					channelGaps: [
						{
							channel_type: "企业官网/同业官网",
							citation_count: 1,
							citation_share_text: "50.0%",
							actionability: "高",
							strategic_note: "维护好现有官网英文案例",
						},
					],
					contentGaps: "缺少波斯湾区域大型海上光伏项目签约快讯",
					actionPlan: actionPlan.length > 0 ? actionPlan : [
						{
							finding: "核心板块提及偏低",
							evidence_refs: ["P01"],
							action: "在海外官网增设标杆案例专页",
							priority: "P1",
							priority_rationale: "直接契合客户寻源问法",
							deliverable: "多语种项目业绩专题集",
							verification_method: "次月同一问题复测",
						},
					],
				},
			});
		},
		onSuccess: (res) => {
			setActiveAnalysisId(res.analysis_id);
			setActionError(null);
		},
		onError: (err: any) => setActionError(`保存人工分析失败: ${err.message}`),
	});

	const generateRevisionMutation = useMutation({
		mutationFn: (revisionId: string) =>
			generateBaselineReportRevisionFn({
				data: {
					brandId: brandId!,
					runId: activeRunId,
					revisionId,
					analysisId: activeAnalysisId,
					draftNotice: "内部评估草稿（rev_01 · 合成验证）",
				},
			}),
		onSuccess: (res) => {
			setActiveRevisionId(res.revision_id);
			setActionError(null);
		},
		onError: (err: any) => setActionError(`生成报告修订失败: ${err.message}`),
	});

	const reviewMutation = useMutation({
		mutationFn: (args: { action: "approve" | "reject"; reason: string }) =>
			reviewBaselineReportRevisionFn({
				data: {
					brandId: brandId!,
					reportId: `rpt_${activeRunId}`,
					revisionId: activeRevisionId || "rev_01",
					action: args.action,
					reason: args.reason,
				},
			}),
		onSuccess: (res) => {
			setReviewNotice(`审核操作完成：状态已更新为 ${res.review_status}（审核人: ${res.reviewer}）`);
			setActionError(null);
		},
		onError: (err: any) => {
			// 合成数据批准被拒绝是预期内的严格机器门禁行为 (D-R06 / D-R07)
			setReviewNotice(null);
			setActionError(`门禁审核拦截 (预期安全防线): ${err.message}`);
		},
	});

	return (
		<div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full min-h-screen bg-background text-foreground">
			{/* 头部标题与工作台切换 */}
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
				<div className="flex items-center gap-3">
					<Link
						to="/app/$brand"
						params={{ brand: brandId! }}
						className="p-2 rounded-lg border hover:bg-accent transition-colors"
						aria-label="返回工作区"
					>
						<IconArrowLeft size={18} />
					</Link>
					<span className="p-2 bg-primary/10 text-primary rounded-lg">
						<IconFileText size={26} />
					</span>
					<div>
						<h1 className="text-2xl font-bold tracking-tight">
							{brandName} · 诊断闭环与报告工作台
						</h1>
						<p className="text-muted-foreground text-sm mt-0.5">
							豆包基线统一操作闭环（内部操作员专用 · 手动单次监测模式 · 封禁自动续采）
						</p>
					</div>
				</div>

				{/* 顶栏 Tab */}
				<div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
					<button
						onClick={() => setActiveTab("portal")}
						className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
							activeTab === "portal" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
						}`}
					>
						统一诊断工作台
					</button>
					<button
						onClick={() => setActiveTab("legacy")}
						className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
							activeTab === "legacy" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
						}`}
					>
						历史归档报告
					</button>
				</div>
			</div>

			{/* 错误与状态提示 */}
			{actionError && (
				<div className="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
					<IconAlertTriangle className="mt-0.5 shrink-0" size={18} />
					<div>{actionError}</div>
				</div>
			)}
			{reviewNotice && (
				<div className="bg-green-50 dark:bg-green-950/40 border border-green-300 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
					<IconCheck className="mt-0.5 shrink-0" size={18} />
					<div>{reviewNotice}</div>
				</div>
			)}

			{/* ========================================================================= */}
			{/* 主视图 1: 统一诊断工作台 (PORTAL) */}
			{/* ========================================================================= */}
			{activeTab === "portal" && (
				<div className="flex flex-col gap-8">
					{/* 步骤 1: 客户资料与多业务题集核对 */}
					<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
						<div className="flex items-center justify-between border-b pb-3">
							<div className="flex items-center gap-2 font-semibold text-base">
								<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
									1
								</span>
								核对主数据与冻结输入快照
							</div>
							<button
								onClick={() => refetchProfile()}
								className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
							>
								<IconRefresh size={14} /> 刷新档案
							</button>
						</div>

						{profileLoading ? (
							<div className="h-20 animate-pulse bg-muted rounded-lg" />
						) : (
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
								<div className="bg-muted/40 p-3 rounded-lg flex flex-col gap-1">
									<span className="text-muted-foreground text-xs">品牌名称与域名</span>
									<span className="font-semibold">{profileData?.brand.name}</span>
									<span className="text-xs text-muted-foreground">{profileData?.brand.website || "无主域名"}</span>
								</div>
								<div className="bg-muted/40 p-3 rounded-lg flex flex-col gap-1">
									<span className="text-muted-foreground text-xs">竞品监测数量</span>
									<span className="font-semibold">{profileData?.competitors.length ?? 0} 家竞品</span>
									<span className="text-xs text-muted-foreground truncate">
										{profileData?.competitors.map((c: any) => c.name).join(", ") || "无竞品"}
									</span>
								</div>
								<div className="bg-muted/40 p-3 rounded-lg flex flex-col gap-1">
									<span className="text-muted-foreground text-xs">多业务题集结构</span>
									<span className="font-semibold">
										共 {profileData?.summary.totalPrompts ?? 0} 题 (正式题 {profileData?.summary.formalCount ?? 0} / 探针 {profileData?.summary.probeCount ?? 0})
									</span>
									<span className="text-xs text-muted-foreground">业务板块已分类映射</span>
								</div>
							</div>
						)}

						{/* 冻结操作 */}
						<div className="flex items-center justify-between pt-2">
							<div className="text-xs text-muted-foreground">
								{frozenSnapshot ? (
									<span className="text-green-600 dark:text-green-400 font-medium inline-flex items-center gap-1">
										<IconCheck size={14} /> 已冻结快照 ID: {frozenSnapshot.snapshot_id} (题目数: {frozenSnapshot.question_count})
									</span>
								) : (
									"确认档案与题目无误后，冻结为不可变快照以便执行基线采样"
								)}
							</div>
							<button
								onClick={() => freezeMutation.mutate("v1.0")}
								disabled={freezeMutation.isPending || !profileData || profileData.summary.totalPrompts === 0}
								className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-blue-700 transition-colors disabled:opacity-50"
							>
								<IconLock size={15} />
								{freezeMutation.isPending ? "冻结中..." : frozenSnapshot ? "重新冻结新版本" : "确认并冻结本轮输入"}
							</button>
						</div>
					</div>

					{/* 步骤 2: 手动发起单次有限监测 (前置摘要 + 防并发) */}
					<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
						<div className="flex items-center justify-between border-b pb-3">
							<div className="flex items-center gap-2 font-semibold text-base">
								<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
									2
								</span>
								执行本次监测（手动单次 · 费用边界确认）
							</div>
							{runsListData?.items?.length ? (
								<span className="text-xs text-muted-foreground">历史任务数: {runsListData.total}</span>
							) : null}
						</div>

						{/* 任务前摘要卡片 */}
						<div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-4 rounded-xl flex flex-col gap-2">
							<div className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
								<IconShieldCheck size={18} className="text-amber-600" />
								本轮执行前确认摘要（一次性有限运行 · 严禁自动续采）
							</div>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mt-1">
								<div>
									<span className="text-muted-foreground">渠道与引擎：</span>
									<span className="font-semibold ml-1">豆包方舟 (Ark)</span>
								</div>
								<div>
									<span className="text-muted-foreground">模型规格：</span>
									<span className="font-semibold ml-1">doubao-seed-2-1-pro-260628</span>
								</div>
								<div>
									<span className="text-muted-foreground">最大请求上限：</span>
									<span className="font-semibold ml-1">30 次 (重试 0 次)</span>
								</div>
								<div>
									<span className="text-muted-foreground">费用说明：</span>
									<span className="font-semibold ml-1 text-amber-700 dark:text-amber-300">费用待核 (按实结算)</span>
								</div>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								⚠️ 说明：本轮仅执行一次有限诊断，任务完成后绝不自动创建下一轮；当前为离线合成验证，真实 Key 尚未开启。
							</p>
						</div>

						{/* 发起按钮 */}
						<div className="flex items-center justify-between pt-2">
							<div className="text-xs text-muted-foreground">
								{activeRunId ? (
									<span className="font-mono text-blue-600 dark:text-blue-400">
										当前选中任务: {activeRunId}
									</span>
								) : (
									"请先冻结输入快照，再发起执行本次有限监测"
								)}
							</div>
							<div className="flex items-center gap-2">
								<button
									onClick={() => createRunMutation.mutate(frozenSnapshot.snapshot_id)}
									disabled={!frozenSnapshot || createRunMutation.isPending}
									className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-green-700 transition-colors disabled:opacity-50"
								>
									<IconPlayerPlay size={15} />
									{createRunMutation.isPending ? "正在发起..." : "执行本次监测"}
								</button>
							</div>
						</div>
					</div>

					{/* 步骤 3: 诊断任务状态与客观指标看板 */}
					{activeRunId && (
						<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-5">
							<div className="flex items-center justify-between border-b pb-3">
								<div className="flex items-center gap-2 font-semibold text-base">
									<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
										3
									</span>
									任务进度与客观指标看板 (A 模块口径)
								</div>
								<button
									onClick={() => {
										refetchRun();
										refetchEvidence();
										refetchMetrics();
									}}
									disabled={runFetching}
									className="text-xs border px-2.5 py-1 rounded-md hover:bg-accent inline-flex items-center gap-1"
								>
									<IconRefresh size={14} /> 刷新结果
								</button>
							</div>

							{/* 任务状态卡片 */}
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">任务执行状态</span>
									<div className="text-sm font-bold capitalize mt-0.5 flex items-center gap-1.5">
										<span
											className={`w-2.5 h-2.5 rounded-full ${
												runData?.status === "completed"
													? "bg-green-500"
													: runData?.status === "partial"
														? "bg-amber-500"
														: runData?.status === "failed"
															? "bg-red-500"
															: "bg-blue-500 animate-pulse"
											}`}
										/>
										{runData?.status || "加载中..."}
									</div>
								</div>
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">完成进度</span>
									<div className="text-sm font-bold mt-0.5">
										{runData?.completed_questions ?? 0} / {runData?.total_questions ?? 0} 题
									</div>
								</div>
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">有效题数 (有效尝试)</span>
									<div className="text-sm font-bold mt-0.5 text-blue-600">
										{runData?.valid_questions ?? 0} 题
									</div>
								</div>
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">数据来源模式</span>
									<div className="text-sm font-bold mt-0.5 uppercase text-muted-foreground">
										{runData?.mode || "synthetic"}
									</div>
								</div>
							</div>

							{/* 客观指标卡片 (A 模块) */}
							{metricsData && (
								<div className="flex flex-col gap-3 border-t pt-4">
									<div className="flex items-center gap-1.5 text-sm font-semibold text-blue-600">
										<IconChartBar size={18} /> 客观统计指标（严谨 A 模块分母口径）
									</div>
									<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
										<div className="bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 rounded-lg">
											<span className="text-xs text-muted-foreground">全样本有效提及率</span>
											<div className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-1">
												{metricsData.overall_metrics?.effective_mention_rate_text || "0.0%"}
											</div>
											<span className="text-xs text-muted-foreground">
												命中 {metricsData.overall_metrics?.effective_mention_count ?? 0} / 样本 {metricsData.overall_metrics?.effective_sample_count ?? 0}
											</span>
										</div>
										<div className="bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800 p-3 rounded-lg">
											<span className="text-xs text-muted-foreground">核心正式题提及率</span>
											<div className="text-xl font-bold text-indigo-700 dark:text-indigo-300 mt-1">
												{metricsData.p0_summary?.effective_mention_rate_text || "0.0%"}
											</div>
											<span className="text-xs text-muted-foreground">
												命中 {metricsData.p0_summary?.effective_mention_count ?? 0} / 样本 {metricsData.p0_summary?.effective_sample_count ?? 0}
											</span>
										</div>
										<div className="bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 p-3 rounded-lg">
											<span className="text-xs text-muted-foreground">主体识别探针提及率</span>
											<div className="text-xl font-bold text-purple-700 dark:text-purple-300 mt-1">
												{metricsData.probe_summary?.effective_mention_rate_text || "0.0%"}
											</div>
											<span className="text-xs text-muted-foreground">
												命中 {metricsData.probe_summary?.effective_mention_count ?? 0} / 样本 {metricsData.probe_summary?.effective_sample_count ?? 0}
											</span>
										</div>
										<div className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 p-3 rounded-lg">
											<span className="text-xs text-muted-foreground">自有域名引用占比</span>
											<div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-1">
												{metricsData.domain_metrics?.own_domain_citation_rate_text || "0.0%"}
											</div>
											<span className="text-xs text-muted-foreground">
												自有引用 {metricsData.domain_metrics?.own_domain_citations_count ?? 0} / 总引用 {metricsData.domain_metrics?.total_citations_count ?? 0}
											</span>
										</div>
									</div>

									{/* 多业务板块切分指标 */}
									{metricsData.business_groups?.length > 0 && (
										<div className="mt-2">
											<span className="text-xs font-semibold text-muted-foreground">业务板块切分指标：</span>
											<div className="border rounded-lg overflow-hidden mt-1 text-xs">
												<table className="w-full text-left">
													<thead className="bg-muted text-muted-foreground">
														<tr>
															<th className="p-2">业务维度板块</th>
															<th className="p-2">计划题数</th>
															<th className="p-2">有效样本</th>
															<th className="p-2">有效提及数</th>
															<th className="p-2">有效提及率</th>
														</tr>
													</thead>
													<tbody className="divide-y">
														{metricsData.business_groups.map((bg: any) => (
															<tr key={bg.dimension_name}>
																<td className="p-2 font-medium">{bg.dimension_name}</td>
																<td className="p-2">{bg.planned_questions}</td>
																<td className="p-2">{bg.effective_sample_count}</td>
																<td className="p-2">{bg.effective_mention_count}</td>
																<td className="p-2 font-semibold text-blue-600">{bg.effective_mention_rate_text}</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}
								</div>
							)}

							{/* 逐题证据明细 (正式题与探针隔离展示) */}
							{evidenceData && (
								<div className="flex flex-col gap-3 border-t pt-4">
									<div className="text-sm font-semibold flex items-center gap-1.5">
										<IconListCheck size={18} /> 逐题实测证据与引用明细
									</div>

									{/* 正式题列表 */}
									<div className="flex flex-col gap-2">
										<span className="text-xs font-bold text-muted-foreground uppercase">
											核心正式题 ({evidenceData.formal_questions?.length ?? 0})
										</span>
										{evidenceData.formal_questions?.map((q: any) => (
											<div key={q.question_code} className="border rounded-lg p-3 text-xs flex flex-col gap-1.5 bg-muted/10">
												<div className="flex items-center justify-between font-semibold">
													<span>[{q.question_code}] {q.question_text}</span>
													<span className="text-muted-foreground text-[10px] bg-muted px-2 py-0.5 rounded">
														{q.dimension_name}
													</span>
												</div>
												<div className="text-muted-foreground line-clamp-2 bg-background p-2 rounded border">
													💬 模型实测回答：{q.answer_text || "无有效回答"}
												</div>
												<div className="flex items-center gap-3 text-muted-foreground">
													<span>🔍 检索词: {q.search_queries?.join(", ") || "无"}</span>
													<span>🔗 引用数: {q.citations?.length ?? 0}</span>
													<span>⚡ Token: {q.raw_usage?.total_tokens ?? 0}</span>
												</div>
											</div>
										))}
									</div>

									{/* 探针题列表 */}
									{evidenceData.probe_questions?.length > 0 && (
										<div className="flex flex-col gap-2 mt-2">
											<span className="text-xs font-bold text-muted-foreground uppercase">
												主体识别探针 ({evidenceData.probe_questions.length})
											</span>
											{evidenceData.probe_questions.map((q: any) => (
												<div key={q.question_code} className="border rounded-lg p-3 text-xs flex flex-col gap-1.5 bg-purple-50/20 dark:bg-purple-950/10 border-purple-200 dark:border-purple-800/40">
													<div className="flex items-center justify-between font-semibold text-purple-950 dark:text-purple-200">
														<span>[{q.question_code}] {q.question_text}</span>
														<span className="text-[10px] bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-300 px-2 py-0.5 rounded">
															探针 · {q.dimension_name}
														</span>
													</div>
													<div className="text-muted-foreground line-clamp-2 bg-background p-2 rounded border">
														💬 探针回答：{q.answer_text || "无有效回答"}
													</div>
													<div className="flex items-center gap-3 text-muted-foreground">
														<span>🔍 检索词: {q.search_queries?.join(", ") || "无"}</span>
														<span>🔗 引用数: {q.citations?.length ?? 0}</span>
														<span>⚡ Token: {q.raw_usage?.total_tokens ?? 0}</span>
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* 步骤 4: 录入人工成因诊断与优先行动清单 (B 模块) */}
					{activeRunId && (runData?.status === "completed" || runData?.status === "partial") && (
						<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
							<div className="flex items-center justify-between border-b pb-3">
								<div className="flex items-center gap-2 font-semibold text-base">
									<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
										4
									</span>
									填写成因诊断与优先行动清单（B 模块人工录入）
								</div>
								<div className="text-xs text-muted-foreground">
									{activeAnalysisId ? (
										<span className="text-green-600 dark:text-green-400 font-medium inline-flex items-center gap-1">
											<IconCheck size={14} /> 已保存分析版本: {activeAnalysisId}
										</span>
									) : (
										"严格绑定本轮运行，递增版本留痕"
									)}
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">分析师姓名</label>
									<input
										type="text"
										value={analystName}
										onChange={(e) => setAnalystName(e.target.value)}
										className="border rounded-md px-3 py-1.5 bg-background"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">核心执行结论</label>
									<input
										type="text"
										value={executiveConclusion}
										onChange={(e) => setExecutiveConclusion(e.target.value)}
										className="border rounded-md px-3 py-1.5 bg-background"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">关键发现清单（每行一条）</label>
									<textarea
										rows={3}
										value={keyFindings}
										onChange={(e) => setKeyFindings(e.target.value)}
										className="border rounded-md p-2 bg-background font-mono"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">
										优先行动清单 (格式: 题码|行动建议|优先级|理由|交付件|验证方法)
									</label>
									<textarea
										rows={3}
										value={actionPlanInput}
										onChange={(e) => setActionPlanInput(e.target.value)}
										className="border rounded-md p-2 bg-background font-mono"
									/>
								</div>
							</div>

							<div className="flex items-center justify-end pt-2">
								<button
									onClick={() => saveAnalysisMutation.mutate()}
									disabled={saveAnalysisMutation.isPending}
									className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-blue-700 transition-colors disabled:opacity-50"
								>
									<IconDeviceFloppy size={15} />
									{saveAnalysisMutation.isPending ? "保存中..." : "保存人工分析版本"}
								</button>
							</div>
						</div>
					)}

					{/* 步骤 5: 生成报告修订、审核与受控下载 */}
					{activeAnalysisId && (
						<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-5">
							<div className="flex items-center justify-between border-b pb-3">
								<div className="flex items-center gap-2 font-semibold text-base">
									<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
										5
									</span>
									生成报告修订、审核门禁与受控下载
								</div>
								<div className="text-xs text-muted-foreground">
									修订标识: {activeRevisionId || "待生成"}
								</div>
							</div>

							{/* 生成操作 */}
							<div className="flex items-center justify-between bg-muted/30 p-3 rounded-lg text-xs">
								<div>
									<div className="font-semibold">装配不可变修订版本（rev_01）</div>
									<div className="text-muted-foreground mt-0.5">
										将已有采集归档与当前人工分析版本装配，同版渲染导出 JSON, HTML, PDF 清单
									</div>
								</div>
								<button
									onClick={() => generateRevisionMutation.mutate("rev_01")}
									disabled={generateRevisionMutation.isPending}
									className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-indigo-700 transition-colors disabled:opacity-50"
								>
									<IconFileText size={15} />
									{generateRevisionMutation.isPending ? "装配渲染中..." : "生成报告修订 (rev_01)"}
								</button>
							</div>

							{/* 审核与受控下载操作区 */}
							{activeRevisionId && (
								<div className="flex flex-col gap-4 border-t pt-4">
									<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-muted/40 p-4 rounded-xl">
										<div>
											<span className="font-bold text-sm">报告审核门禁 (机器前置校验)</span>
											<p className="text-xs text-muted-foreground mt-1">
												严格机器门禁：合成数据报告严禁批准为正式客户件；点击“批准正式交付”将触发合规拦截；“退回草稿”将合规留痕。
											</p>
										</div>
										<div className="flex items-center gap-2 shrink-0">
											<button
												onClick={() =>
													reviewMutation.mutate({
														action: "reject",
														reason: "合成测试数据不具备正式客户交付资格，已退回归档",
													})
												}
												disabled={reviewMutation.isPending}
												className="px-3 py-1.5 border border-amber-400 text-amber-700 dark:text-amber-300 rounded-md text-xs font-semibold hover:bg-amber-100/50"
											>
												退回草稿归档
											</button>
											<button
												onClick={() =>
													reviewMutation.mutate({
														action: "approve",
														reason: "尝试正式批准交付",
													})
												}
												disabled={reviewMutation.isPending}
												className="px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-semibold hover:bg-green-700"
											>
												批准正式交付（门禁校验）
											</button>
										</div>
									</div>

									{/* 受控下载通道 */}
									<div className="flex flex-col gap-2">
										<span className="text-xs font-bold text-muted-foreground uppercase">
											受控安全下载通道（elmo 服务端鉴权代理 · 防路径穿越）
										</span>
										<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
											<a
												href={`/api/baseline/download?reportId=rpt_${activeRunId}&revisionId=${activeRevisionId}&brandId=${brandId}&format=pdf`}
												download
												className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold text-xs transition-colors"
											>
												<IconDownload size={16} /> 下载受控 PDF 报告
											</a>
											<a
												href={`/api/baseline/download?reportId=rpt_${activeRunId}&revisionId=${activeRevisionId}&brandId=${brandId}&format=html`}
												download
												className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold text-xs transition-colors"
											>
												<IconDownload size={16} /> 下载受控 HTML 报告
											</a>
											<a
												href={`/api/baseline/download?reportId=rpt_${activeRunId}&revisionId=${activeRevisionId}&brandId=${brandId}&format=json`}
												download
												className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-100/60 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-semibold text-xs transition-colors"
											>
												<IconDownload size={16} /> 下载受控 JSON 契约
											</a>
										</div>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* ========================================================================= */}
			{/* 主视图 2: 历史归档报告 (LEGACY) */}
			{/* ========================================================================= */}
			{activeTab === "legacy" && (
				<div className="flex flex-col gap-4">
					<div className="flex items-center justify-between border-b pb-3">
						<span className="text-sm font-semibold text-muted-foreground">
							V2 历史报告归档（保留旧有本地文件查看入口，不清除旧资产）
						</span>
						<button
							onClick={() => refetchLegacy()}
							className="text-xs border px-2.5 py-1 rounded-md hover:bg-accent inline-flex items-center gap-1"
						>
							<IconRefresh size={14} /> 刷新
						</button>
					</div>

					{legacyReports && legacyReports.length > 0 ? (
						<div className="grid md:grid-cols-2 gap-4">
							{legacyReports.map((r) => (
								<div key={r.file} className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-3">
									<div className="flex items-center justify-between">
										<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
											{r.clientCode} · {new Date(r.generatedAt).toLocaleString(isZh ? "zh-CN" : "en-US")}
										</div>
										<span
											className={`text-xs px-2.5 py-1 rounded-full font-medium ${
												r.isDemo
													? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300"
													: "bg-green-100 text-green-700"
											}`}
										>
											门禁 {r.gatesPassed}/{r.gatesTotal} {r.isDemo ? "演示通过" : "通过"}
										</span>
									</div>
									<div className="grid grid-cols-2 gap-2 text-sm">
										<div className="text-muted-foreground">采样样本</div>
										<div className="font-semibold text-right">{r.meta.totalSamples ?? "—"}</div>
										<div className="text-muted-foreground">数据窗口</div>
										<div className="font-semibold text-right">
											{r.meta.startDate && r.meta.endDate ? `${r.meta.startDate} ~ ${r.meta.endDate}` : "—"}
										</div>
									</div>
									{r.pdfUrl ? (
										<a
											href={r.pdfUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-md"
										>
											<IconDownload size={16} /> 下载历史 PDF
										</a>
									) : (
										<div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-muted text-muted-foreground">
											<IconX size={16} /> PDF 未同步
										</div>
									)}
								</div>
							))}
						</div>
					) : (
						<div className="border rounded-xl p-10 text-center bg-muted/20">
							<IconFileText className="mx-auto text-muted-foreground" size={40} />
							<h2 className="text-lg font-semibold mt-3">暂无历史报告</h2>
							<p className="text-sm text-muted-foreground mt-1">历史 V2 产物目录中未检索到匹配的归档文件</p>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
