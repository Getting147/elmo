import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { INVALID_REPORT_TASK_LINK, validateReportSearch } from "@/lib/baseline-report-search";
import { formatActionPlan, parseActionPlan, inspectActionPlan, type AnalysisAction } from "@/lib/analysis-action-editor";
import { analysisRequestErrorMessage, baselineBrowserFetch } from "@/lib/baseline-request-error";
import { analysisRecoveryStatus } from "@/lib/analysis-recovery";
import { formatDiagnosticTaskName } from "@/lib/baseline-task-name";
import { useAuth } from "@/hooks/use-auth";
import { DiagnosisDimensionInput } from "@/components/diagnosis-dimension-input";
import { DefaultErrorComponent } from "@/router-default-components";
import { useDiagnosisDraft } from "@/hooks/use-diagnosis-draft";
import { DiagnosisStages } from "@/components/diagnosis-stages";
import { AnswerMarkdown } from "@/components/answer-markdown";
import { DEFAULT_SAMPLING_OUTPUT_TOKENS, samplingOutputTokens, samplingUsageCount } from "@/lib/baseline-sampling";
import { diagnosisStages } from "@/lib/baseline-stages";
import { questionObservationMessage, diagnosisAnalysisFailureMessage, diagnosisAnalysisFormStatus, diagnosisCountText, diagnosisStatusText, diagnosisTaskSection, isBaselineRunActive, isDiagnosisInProgress } from "@/lib/baseline-status";
import { createFileRoute, Link, useLoaderData, type ErrorComponentProps } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBrand } from "@/hooks/use-brands";
import { getBrandReports } from "@/server/report-files";
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
	deleteBaselineReportRevisionFn,
	listBaselineRunsFn,
	getBaselineAnalysisFn,
	auditBaselineAnalysisEvidenceFn,
	getBaselineReportFn,
	getBaselineActiveAuthFn,
	registerBaselineServerAuthFn,
	retryBaselineAnalysisFn,
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
	IconChartBar,
	IconListCheck,
	IconDeviceFloppy,
	IconShieldCheck,
	IconChevronDown,
	IconChevronUp,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_authed/app/$brand/reports")({
	component: BrandReportsPage,
	errorComponent: ReportsError,
	validateSearch: validateReportSearch,
});

function ReportsError(props: ErrorComponentProps) {
	const { brand } = Route.useParams();
	if (props.error.message !== INVALID_REPORT_TASK_LINK) return <DefaultErrorComponent {...props} />;
	return <section data-no-i18n="true" role="alert" className="p-6 space-y-3">
		<h2 className="text-lg font-semibold">任务链接参数无效</h2>
		<p>任务编号必须使用合法的字母、数字、下划线或连字符。请返回报告页重新选择已有任务；此操作不会启动采集。</p>
		<Link to="/app/$brand/reports" params={{ brand }} search={{}} reloadDocument className="text-primary underline">返回诊断报告页</Link>
	</section>;
}

class FrozenDimensionInputError extends Error {}

type ReviewFeedback = { tone: "success" | "error"; runId: string; revisionId: string; message: string };
type GenerateRevisionArgs = {
	revisionId: string;
	analysisId?: string;
	origin: "auto" | "manual" | "retry";
	runId: string;
};
type SaveAnalysisArgs = { runId: string; nextRevisionId: string };
type ReviewArgs = { action: "approve" | "reject"; reason: string; revisionId: string; runId: string };
type UnsavedAnalysisDraft = {
	activeAnalysisId: string;
	analystName: string;
	executiveConclusion: string;
	keyFindings: string;
	rawBrandIdentityAudit: unknown;
	brandIdentityAudit: string;
	contentGapsInput: string;
	actionPlanInput: string;
	rawActionPlan: AnalysisAction[];
	actionItems: AnalysisAction[];
};

type AutoEvidenceAuditEntry = {
	runId: string;
	analysisId: string;
	state: "pending" | "done" | "failed";
	unsupported: number;
	unverified: number;
	evidenceReady: boolean;
	audited: number;
	verdicts: Map<string, string> | null;
};

type ActionFilterProvenance = {
	sourceAnalysisId: string;
	sourceVersion: number | null;
	filteredNoRef: number;
	backendFiltered: number;
	audited: number;
	unsupported: number;
	unverified: number;
	evidenceReady: boolean | null;
};

function revisionStatusLabel(status: string | undefined): string {
	if (status === "ready") return "已就绪";
	if (status === "rendering") return "生成中";
	if (status === "failed") return "失败";
	return status || "未知";
}

function BrandReportsPage() {
	const { brand } = Route.useParams();
	return <BrandReportsWorkspace key={brand} />;
}

function BrandReportsWorkspace() {
	const { brand: brandId } = Route.useParams();
	const { runId: requestedRunId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { brand } = useBrand(brandId);
	// R01-F03: 删除入口按组织角色控制（未知/加载中一律不给入口），服务端强校验仍独立生效
	const { canDeleteRevisions } = useLoaderData({ from: "/_authed/app/$brand" });
	const isZh = typeof navigator !== "undefined" ? navigator.language?.startsWith("zh") : true;

	// 顶栏 Tab: portal (诊断工作台) vs legacy (历史报告)
	const [activeTab, setActiveTab] = useState<"portal" | "legacy">("portal");

	// 工作台状态机
	const [activeRunId, setActiveRunId] = useState<string>("");
	const [activeAnalysisId, setActiveAnalysisId] = useState<string>("");
	const [activeRevisionId, setActiveRevisionId] = useState<string>("rev_01");
	const [revisionInput, setRevisionInput] = useState<string>("rev_01");
	const [reviewNotice, setReviewNotice] = useState<string | null>(null);
	const [reviewFeedback, setReviewFeedback] = useState<ReviewFeedback | null>(null);
	// 草稿/已退回修订受控删除：二次确认与结果反馈均绑定点击时的任务与修订 (B18-CORE)
	const [deleteConfirm, setDeleteConfirm] = useState<{ runId: string; revisionId: string } | null>(null);
	const [deleteFeedback, setDeleteFeedback] = useState<{ tone: "success" | "error"; runId: string; revisionId: string; message: string } | null>(null);
	// AI 自动分析载入编辑副本时的无依据建议过滤提示 (B18-CORE)
	const [autoActionFilter, setAutoActionFilter] = useState<{ runId: string; filteredCount: number; sourceVersion: number | null } | null>(null);
	// 历史自动建议依据核验状态（R01-F01）：pending 时禁止保存，避免未核验项混入新产物
	const [autoEvidenceAudit, setAutoEvidenceAudit] = useState<AutoEvidenceAuditEntry | null>(null);
	// 核验结果按 run+analysis 缓存：切任务返回后恢复完成结果或接续只读核验 (R02-F01-b)
	const auditStateCacheRef = useRef(new Map<string, AutoEvidenceAuditEntry>());
	const auditInFlightRef = useRef(new Set<string>());
	const autoActionFilterByRunRef = useRef(new Map<string, { runId: string; filteredCount: number; sourceVersion: number | null }>());
	const actionFilterProvenanceRef = useRef<ActionFilterProvenance | null>(null);
	const actionFilterProvenanceByRunRef = useRef(new Map<string, ActionFilterProvenance>());
	const [actionError, setActionError] = useState<string | null>(null);
	const [downloadError, setDownloadError] = useState<string | null>(null);
	const [saveWorkflowPhase, setSaveWorkflowPhase] = useState<"idle" | "saving" | "assembling">("idle");
	// 保存/装配工作流必须绑定发起任务：切换任务后不得把阶段、分析编号或反馈写到别的任务上 (B08-R02 F01/F02)
	const [saveWorkflowRunId, setSaveWorkflowRunId] = useState<string>("");
	const saveWorkflowRef = useRef(false);
	const analysisDirtyRef = useRef(false);
	const unsavedAnalysisDraftsRef = useRef(new Map<string, UnsavedAnalysisDraft>());
	const loadedAnalysisIdentityRef = useRef("");
	const progressPanelRef = useRef<HTMLElement | null>(null);
	const analysisPanelRef = useRef<HTMLElement | null>(null);
	const reportPanelRef = useRef<HTMLElement | null>(null);
	const pendingPanelScrollRef = useRef<{ runId: string; section: 3 | 4 | 5 } | null>(null);
	const [focusRequest, setFocusRequest] = useState<{ runId: string; sequence: number } | null>(null);
	const [locationNotice, setLocationNotice] = useState<{ runId: string; message: string } | null>(null);
	const retryAnalysisRunRef = useRef<string | null>(null);
	const [retryAnalysisFeedback, setRetryAnalysisFeedback] = useState<Record<string, { message: string; after: number }>>({});
	const activeRevisionIdRef = useRef(activeRevisionId);
	const activeRunIdRef = useRef(activeRunId);
	const queryClient = useQueryClient();

	// 题库分类人工补齐状态 (E-R04)

	const brandIdRef = useRef(brandId);
	brandIdRef.current = brandId;

	// 逐题回答展开状态 (E-R06 / B18-UI Task A)
	const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});
	// 逐条建议依据展开状态 (B18-UI Task D)
	const [expandedActionEvidences, setExpandedActionEvidences] = useState<Record<number, boolean>>({});

	useEffect(() => {
		setExpandedQuestions({});
		setExpandedActionEvidences({});
	}, [activeRunId, brandId]);

	// 人工分析表单状态 (E-R05: 移除一切预填伪造数据，全部默认空或显式占位)
	const [analystName, setAnalystName] = useState<string>("");
	const [executiveConclusion, setExecutiveConclusion] = useState<string>("");
	const [keyFindings, setKeyFindings] = useState<string>("");
	const [rawBrandIdentityAudit, setRawBrandIdentityAudit] = useState<any>(null);
	const [brandIdentityAudit, setBrandIdentityAudit] = useState<string>("");
	const [contentGapsInput, setContentGapsInput] = useState<string>("");
	const [actionPlanInput, setActionPlanInput] = useState<string>("");
	const [rawActionPlan, setRawActionPlan] = useState<AnalysisAction[]>([]);
	const [actionItems, setActionItems] = useState<AnalysisAction[]>([]);

	const currentAnalysisFormRef = useRef<UnsavedAnalysisDraft>({
		activeAnalysisId,
		analystName,
		executiveConclusion,
		keyFindings,
		rawBrandIdentityAudit,
		brandIdentityAudit,
		contentGapsInput,
		actionPlanInput,
		rawActionPlan,
		actionItems,
	});
	currentAnalysisFormRef.current = {
		activeAnalysisId,
		analystName,
		executiveConclusion,
		keyFindings,
		rawBrandIdentityAudit,
		brandIdentityAudit,
		contentGapsInput,
		actionPlanInput,
		rawActionPlan,
		actionItems,
	};

	const brandName = brand?.name || brandId || "";
	const markAnalysisDirty = () => {
		analysisDirtyRef.current = true;
	};

	// 1. 获取品牌档案与题集配置
	const {
		data: profileData,
		isLoading: profileLoading,
		isFetching: profileFetching,
		error: profileError,
		refetch: refetchProfile,
	} = useQuery({
		queryKey: ["baseline-profile", brandId],
		queryFn: () => getBrandBaselineProfileFn({ data: { brandId: brandId! } }),
		enabled: !!brandId && activeTab === "portal",
	});

	const { user } = useAuth();
	const { draft, transact } = useDiagnosisDraft(user?.id ?? "", brandId, profileData);
	const frozenSnapshot = draft.snapshot;
	const executionMode = draft.mode;
	const dimensionOverrides = draft.dimensions;
	const pendingDimensionWrites = useRef(new Set<Promise<void>>());
	const dimensionSaveError = useRef<Error | null>(null);
	const [dimensionComposing, setDimensionComposing] = useState(false);
	const saveDimension = (id: string, value: string) => {
		const write = transact((current) => {
			if (current.snapshot || current.runId) throw new FrozenDimensionInputError("输入已在本页或其他标签页冻结，请显式重新准备后编辑。");
			return { ...current, dimensions: { ...current.dimensions, [id]: value } };
		}).then(() => { dimensionSaveError.current = null; }, (err: Error) => {
			if (!(err instanceof FrozenDimensionInputError)) dimensionSaveError.current = err;
			setActionError(err.message);
			throw err;
		});
		pendingDimensionWrites.current.add(write);
		void write.then(() => pendingDimensionWrites.current.delete(write), () => pendingDimensionWrites.current.delete(write));
		return write;
	};
	// 2. 查询最近任务列表 (E-R06)
	const {
		data: runsListData,
		isFetching: runsListFetching,
		error: runsListError,
		refetch: refetchRunsList,
	} = useQuery({
		queryKey: ["baseline-runs-list", brandId],
		queryFn: () => listBaselineRunsFn({ data: { brandId: brandId! } }),
		enabled: !!brandId && activeTab === "portal",
	});

	// 3. 查询当前正在查看的 run 详情
	const {
		data: runData,
		error: runError,
		refetch: refetchRun,
		isFetching: runFetching,
		dataUpdatedAt: runUpdatedAt,
		errorUpdatedAt: runErrorAt,
	} = useQuery({
		queryKey: ["baseline-run", brandId, activeRunId],
		queryFn: () => getBaselineRunFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled: !!brandId && !!activeRunId,
		refetchInterval: (query) => query.state.data && isDiagnosisInProgress(query.state.data) ? 2000 : false,
	});

	// 3.1. 当前准备任务的独立状态，用于“查看本次任务”的准确禁用与恢复 (B08-06)
	const { data: preparedRunData } = useQuery({
		queryKey: ["baseline-run", brandId, draft.runId],
		queryFn: () => getBaselineRunFn({ data: { brandId: brandId!, runId: draft.runId! } }),
		enabled: !!brandId && !!draft.runId && draft.runId !== activeRunId,
		refetchInterval: (query) =>
			query.state.data && isBaselineRunActive(query.state.data) ? 2000 : false,
	});

	// 4. 查询当前 run 的逐题证据
	const { data: evidenceData, error: evidenceError, refetch: refetchEvidence, isFetching: evidenceFetching } = useQuery({
		queryKey: ["baseline-evidence", brandId, activeRunId],
		queryFn: () => getBaselineEvidenceFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled:
			!!brandId &&
			!!activeRunId &&
			Boolean(runData),
		refetchInterval: runData && isDiagnosisInProgress(runData) ? 2000 : false,
		retry: false,
	});

	const collectionError = evidenceData?.run_id === runData?.run_id
		? [...(evidenceData?.formal_questions ?? []), ...(evidenceData?.probe_questions ?? [])].find((item) => item.error_message)?.error_message
		: null;

	// 5. 查询当前 run 的客观统计指标
	const { data: metricsData, error: metricsError, refetch: refetchMetrics, isFetching: metricsFetching } = useQuery({
		queryKey: ["baseline-metrics", brandId, activeRunId],
		queryFn: () => getBaselineMetricsFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled:
			!!brandId &&
			!!activeRunId &&
			(runData?.valid_questions > 0),
		refetchInterval: runData && isDiagnosisInProgress(runData) ? 2000 : false,
		retry: false,
	});

	// 5.1. 查询当前 run 的最新人工分析版本 (E2-R04: 刷新恢复与版本切换)
	const {
		data: analysisData,
		error: analysisQueryError,
		isLoading: analysisQueryLoading,
		isFetching: analysisFetching,
		dataUpdatedAt: analysisUpdatedAt,
		errorUpdatedAt: analysisErrorAt,
		refetch: refetchAnalysis,
	} = useQuery({
		queryKey: ["baseline-analysis", brandId, activeRunId],
		queryFn: () => getBaselineAnalysisFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled: !!brandId && !!activeRunId,
		retry: 1,
		refetchInterval: runData && isDiagnosisInProgress(runData) ? 2000 : false,
	});

	// 5.2. 查询当前 run 的报告及其修订版本列表 (E2-R04)
	const {
		data: reportData,
		isFetching: reportFetching,
		error: reportQueryError,
		refetch: refetchReport,
	} = useQuery({
		queryKey: ["baseline-report", brandId, activeRunId],
		queryFn: () => getBaselineReportFn({ data: { brandId: brandId!, reportId: `rpt_${activeRunId}` } }),
		enabled: !!brandId && !!activeRunId,
		retry: 1,
		refetchInterval: runData && isDiagnosisInProgress(runData) ? 2000 : false,
	});

	// 6. 旧报告查询（保留历史能力）
	const { data: legacyReports, refetch: refetchLegacy } = useQuery({
		queryKey: ["brand-reports-legacy", brandId],
		queryFn: () => getBrandReports({ data: { brandId: brandId! } }),
		enabled: !!brandId && activeTab === "legacy",
	});

	// 历史自动建议依据核验（R01-F01 / R02-F01）：按每条建议自身 refs+action 匹配后端结论，
	// 不按数组下标套用其他条目的核验信息；资料不足/读取失败保留并标记“尚未核实”。
	// 核验状态按 run+analysis 缓存，切任务回来后恢复结果或接续只读核验 (R02-F01-b)。
	const auditVerdictKey = (action: unknown, refs: unknown) =>
		JSON.stringify([action ?? "", Array.isArray(refs) ? refs : []]);

	const computeAuditItems = (items: AnalysisAction[], entry: AutoEvidenceAuditEntry) => {
		let unsupported = 0;
		let unverified = 0;
		const next: AnalysisAction[] = [];
		for (const item of items) {
			const hasRefs = Array.isArray(item.evidence_refs) && item.evidence_refs.length > 0;
			if (entry.state === "failed" || !entry.evidenceReady) {
				if (hasRefs) {
					next.push({ ...item, audit_status: "unverified" as const });
					unverified += 1;
				} else {
					next.push(item);
				}
				continue;
			}
			const status = hasRefs && entry.verdicts
				? entry.verdicts.get(auditVerdictKey(item.action, item.evidence_refs))
				: undefined;
			if (status === "unsupported") {
				unsupported += 1;
				continue;
			}
			if (status === "unverified") {
				unverified += 1;
				next.push({ ...item, audit_status: "unverified" as const });
				continue;
			}
			next.push(item);
		}
		return { items: next, unsupported, unverified };
	};

	const applyAuditToCurrentItems = (entry: AutoEvidenceAuditEntry) => {
		const result = computeAuditItems(currentAnalysisFormRef.current.actionItems, entry);
		setActionItems(result.items);
		setRawActionPlan(result.items);
		setActionPlanInput(formatActionPlan(result.items));
		return { unsupported: result.unsupported, unverified: result.unverified };
	};

	const updateAuditProvenance = (
		entry: AutoEvidenceAuditEntry,
		counts: { unsupported: number; unverified: number },
	) => {
		const provenance = entry.runId === activeRunIdRef.current
			? actionFilterProvenanceRef.current
			: actionFilterProvenanceByRunRef.current.get(entry.runId) ?? null;
		if (!provenance) return;
		const next = {
			...provenance,
			audited: entry.audited,
			unsupported: counts.unsupported,
			unverified: counts.unverified,
			evidenceReady: entry.evidenceReady,
		};
		actionFilterProvenanceByRunRef.current.set(entry.runId, next);
		if (entry.runId === activeRunIdRef.current) actionFilterProvenanceRef.current = next;
	};

	const runHistoryEvidenceAudit = async (args: {
		runId: string;
		analysisId: string;
		identity: string;
		loadedCount: number;
	}) => {
		const auditKey = `${args.runId}:${args.analysisId}`;
		const active = () =>
			activeRunIdRef.current === args.runId &&
			(loadedAnalysisIdentityRef.current === args.identity ||
				currentAnalysisFormRef.current.activeAnalysisId === args.analysisId);

		const cached = auditStateCacheRef.current.get(auditKey);
		if (cached && cached.state !== "pending" && !auditInFlightRef.current.has(auditKey)) {
			if (!active()) return;
			const counts = applyAuditToCurrentItems(cached);
			setAutoEvidenceAudit({ ...cached, ...counts });
			updateAuditProvenance(cached, counts);
			return;
		}
		if (auditInFlightRef.current.has(auditKey)) return;
		auditInFlightRef.current.add(auditKey);
		auditStateCacheRef.current.set(auditKey, {
			runId: args.runId,
			analysisId: args.analysisId,
			state: "pending",
			unsupported: 0,
			unverified: 0,
			evidenceReady: true,
			audited: args.loadedCount,
			verdicts: null,
		});
		try {
			const res: any = await auditBaselineAnalysisEvidenceFn({
				data: { brandId: brandId!, runId: args.runId, analysisId: args.analysisId },
			});
			const rank: Record<string, number> = { unsupported: 3, unverified: 2, supported: 1, no_refs: 0 };
			const verdicts = new Map<string, string>();
			for (const verdict of Array.isArray(res?.items) ? res.items : []) {
				const status = String(verdict?.status || "");
				if (!(status in rank)) continue;
				const key = auditVerdictKey(verdict.action, verdict.evidence_refs);
				const previous = verdicts.get(key);
				// 同一条建议出现多个结论时取更保守的结果，避免把不确定项当成已支持
				if (!previous || rank[status] > rank[previous]) verdicts.set(key, status);
			}
			const entry: AutoEvidenceAuditEntry = {
				runId: args.runId,
				analysisId: args.analysisId,
				state: "done",
				unsupported: 0,
				unverified: 0,
				evidenceReady: res?.evidence_ready !== false,
				audited: args.loadedCount,
				verdicts,
			};
			auditStateCacheRef.current.set(auditKey, entry);
			if (!active()) return;
			const counts = applyAuditToCurrentItems(entry);
			entry.unsupported = counts.unsupported;
			entry.unverified = counts.unverified;
			setAutoEvidenceAudit({ ...entry });
			updateAuditProvenance(entry, counts);
		} catch {
			const entry: AutoEvidenceAuditEntry = {
				runId: args.runId,
				analysisId: args.analysisId,
				state: "failed",
				unsupported: 0,
				unverified: 0,
				evidenceReady: false,
				audited: args.loadedCount,
				verdicts: null,
			};
			auditStateCacheRef.current.set(auditKey, entry);
			if (!active()) return;
			const counts = applyAuditToCurrentItems(entry);
			entry.unverified = counts.unverified;
			setAutoEvidenceAudit({ ...entry });
			updateAuditProvenance(entry, counts);
		} finally {
			auditInFlightRef.current.delete(auditKey);
		}
	};
	const runHistoryEvidenceAuditRef = useRef(runHistoryEvidenceAudit);
	runHistoryEvidenceAuditRef.current = runHistoryEvidenceAudit;

	// 恢复服务端持久化的人工分析；轮询不得覆盖当前页面尚未保存的人工修改 (E2-R04 / B08-08)
	useEffect(() => {
		if (!activeRunId || analysisData?.run_id !== activeRunId || analysisDirtyRef.current) return;
		const identity = `${analysisData.analysis_id}:${analysisData.version ?? ""}`;
		if (loadedAnalysisIdentityRef.current === identity) return;
		setActiveAnalysisId(analysisData.analysis_id || "");
		const analyst = analysisData.analyst_name;
		setAnalystName(
			analyst === "DeepSeek 自动分析 (待人工审核)"
				? "Negency-Agent 自动分析（待人工审核）"
				: analyst || "",
		);
		setExecutiveConclusion(analysisData.payload?.executive_conclusion || "");
		setKeyFindings(
			Array.isArray(analysisData.payload?.key_findings)
				? analysisData.payload.key_findings.join("\n")
				: analysisData.payload?.key_findings || "",
		);
		const audit = analysisData.payload?.brand_identity_audit;
		if (typeof audit === "object" && audit !== null) {
			setRawBrandIdentityAudit(audit);
			setBrandIdentityAudit(audit.analysis || audit.summary || "");
		} else {
			setRawBrandIdentityAudit(null);
			setBrandIdentityAudit(typeof audit === "string" ? audit : "");
		}
		setContentGapsInput(
			Array.isArray(analysisData.payload?.content_gaps)
				? analysisData.payload.content_gaps.join("\n")
				: analysisData.payload?.content_gaps || "",
		);
		if (Array.isArray(analysisData.payload?.action_plan)) {
			// B18-CORE: AI 自动分析（未经人工修订 human_refined）进入编辑副本时，
			// 无题目引用的自动建议不进入编辑清单；人工保存过的版本原样保留，
			// 人工编辑中的未完成草稿不受影响。原始分析记录不被改动。
			// 提示计数 = 后端生成时已剔除数（ai_metadata.action_filter）+ 旧版本载入时
			// 前端过滤出的无引用数，两者不重叠。
			const aiMeta = analysisData.payload?.ai_metadata;
			const isAutoAnalysis = Boolean(aiMeta && typeof aiMeta === "object") && !aiMeta.human_refined;
			const rawPlan: AnalysisAction[] = analysisData.payload.action_plan;
			const keptItems = isAutoAnalysis
				? rawPlan.filter((item) => Array.isArray(item.evidence_refs) && item.evidence_refs.length > 0)
				: rawPlan;
			const frontendFilteredCount = rawPlan.length - keptItems.length;
			const backendFilteredCount =
				isAutoAnalysis && Array.isArray(aiMeta?.action_filter?.filtered)
					? aiMeta.action_filter.filtered.length
					: 0;
			const filteredCount = backendFilteredCount + frontendFilteredCount;
			setRawActionPlan(keptItems);
			setActionItems(keptItems);
			setActionPlanInput(formatActionPlan(keptItems));
			if (isAutoAnalysis) {
				const filterState = { runId: activeRunId, filteredCount, sourceVersion: analysisData.version ?? null };
				const provenance: ActionFilterProvenance = {
					sourceAnalysisId: analysisData.analysis_id || "",
					sourceVersion: analysisData.version ?? null,
					filteredNoRef: frontendFilteredCount,
					backendFiltered: backendFilteredCount,
					audited: 0,
					unsupported: 0,
					unverified: 0,
					evidenceReady: null,
				};
				setAutoActionFilter(filterState);
				autoActionFilterByRunRef.current.set(activeRunId, filterState);
				actionFilterProvenanceRef.current = provenance;
				actionFilterProvenanceByRunRef.current.set(activeRunId, provenance);
				// R01-F01: 有引用的历史自动建议需与本轮归档依据复核后才进入编辑清单
				if (keptItems.length > 0 && analysisData.analysis_id) {
					setAutoEvidenceAudit({
						runId: activeRunId,
						analysisId: analysisData.analysis_id,
						state: "pending",
						unsupported: 0,
						unverified: 0,
						evidenceReady: true,
						audited: keptItems.length,
						verdicts: null,
					});
					void runHistoryEvidenceAudit({
						runId: activeRunId,
						analysisId: analysisData.analysis_id,
						identity,
						loadedCount: keptItems.length,
					});
				} else {
					setAutoEvidenceAudit(null);
				}
			} else {
				setAutoActionFilter(null);
				setAutoEvidenceAudit(null);
				actionFilterProvenanceRef.current = null;
				autoActionFilterByRunRef.current.delete(activeRunId);
				actionFilterProvenanceByRunRef.current.delete(activeRunId);
			}
		} else {
			setAutoActionFilter(null);
			setAutoEvidenceAudit(null);
			actionFilterProvenanceRef.current = null;
			autoActionFilterByRunRef.current.delete(activeRunId);
			actionFilterProvenanceByRunRef.current.delete(activeRunId);
		}
		loadedAnalysisIdentityRef.current = identity;
	}, [analysisData, activeRunId]);

	// 恢复报告修订版本列表及建议下一修订编号 (E2-R04 / E3-R04: 避免旧 reportData effect 覆盖刚生成或明确选择的新修订)
	// B18-CORE: 已删除修订只作为编号占位，不可被选中；下一修订号按含删除历史的最大序号分配
	useEffect(() => {
		if (reportData?.run_id === activeRunId && reportData.revisions?.length > 0) {
			const revs = reportData.revisions;
			const latestAlive = [...revs].reverse().find((r: any) => !r.deleted_at);
			setActiveRevisionId((current) => {
				const currentRev = revs.find((r: any) => r.revision_id === current);
				if (currentRev?.deleted_at) {
					return latestAlive ? latestAlive.revision_id : "";
				}
				if (!current || !currentRev) {
					return latestAlive ? latestAlive.revision_id : "";
				}
				return current;
			});
			const maxRevNum = revs.reduce((max: number, r: any) => {
				const n = parseInt(String(r.revision_id).replace(/^rev_/, ""), 10);
				return Number.isFinite(n) && n > max ? n : max;
			}, 0);
			const nextNum = maxRevNum + 1;
			setRevisionInput(`rev_${nextNum < 10 ? `0${nextNum}` : nextNum}`);
		}
	}, [reportData, activeRunId]);

	useEffect(() => {
		setDownloadError(null);
	}, [activeRunId, activeRevisionId]);

	useEffect(() => {
		activeRevisionIdRef.current = activeRevisionId;
		setReviewFeedback(null);
		setReviewNotice(null);
	}, [activeRevisionId]);

	useEffect(() => {
		activeRunIdRef.current = activeRunId;
	}, [activeRunId]);

	useEffect(() => {
		if (!focusRequest || focusRequest.runId !== activeRunId || activeTab !== "portal") return;
		// Read-only panels above the target can change its position when their queries finish.
		if (runFetching || profileFetching || runsListFetching || evidenceFetching || metricsFetching || analysisFetching || reportFetching) return;
		if (!runError && runData?.run_id !== focusRequest.runId) return;
		const section = diagnosisTaskSection(runError ? null : runData);
		const message = runError
			? "任务状态读取失败，已定位板块3状态区；未重发任务，请只读刷新后确认。"
			: !runData || !["queued", "collecting", "analyzing", "analysis_failed", "rendering_report", "report_render_failed", "ready_for_review", "completed", "failed", "exception", "auth_guard_rejected", "network_guard_blocked"].includes(runData.current_step)
				? "当前处理阶段尚未确认，已定位板块3状态区；不会重发任务。"
				: `已定位本任务当前处理位置：板块${section}。此查看操作不会启动采样、分析或报告生成。`;
		pendingPanelScrollRef.current = { runId: focusRequest.runId, section };
		setLocationNotice({ runId: focusRequest.runId, message });
		setFocusRequest(null);
	}, [focusRequest, activeRunId, activeTab, runFetching, profileFetching, runsListFetching, evidenceFetching, metricsFetching, analysisFetching, reportFetching, runError, runData]);

	useLayoutEffect(() => {
		const target = pendingPanelScrollRef.current;
		pendingPanelScrollRef.current = null;
		if (!target || target.runId !== activeRunId || activeTab !== "portal") return;
		// Commit the status notice above the panels before measuring the final scroll position.
		const panel = target.section === 4 ? analysisPanelRef.current : target.section === 5 ? reportPanelRef.current : progressPanelRef.current;
		panel?.scrollIntoView({ behavior: "instant", block: "start" });
	}, [locationNotice, activeRunId, activeTab]);

	// 任务达到待审核或终态时自动刷新分析与报告数据 (REPORT-001F)
	useEffect(() => {
		if (
			runData?.current_step === "ready_for_review" ||
			runData?.status === "completed" ||
			runData?.status === "partial"
		) {
			refetchAnalysis();
			refetchReport();
			refetchEvidence();
			refetchMetrics();
		}
	}, [runData?.current_step, runData?.status]);

	// 未保存表单按 run 隔离，返回原任务时恢复，不混入另一任务。
	const handleSelectRun = useCallback((runId: string) => {
		// 路由与选择器可能在同一轮渲染中重复选中同一 run；保留已恢复的分析与未保存修改。
		if (runId === activeRunIdRef.current) return;
		const previousRunId = activeRunIdRef.current;
		if (previousRunId && analysisDirtyRef.current) {
			unsavedAnalysisDraftsRef.current.set(previousRunId, {
				...currentAnalysisFormRef.current,
			});
		} else if (previousRunId) {
			unsavedAnalysisDraftsRef.current.delete(previousRunId);
		}
		const unsaved = unsavedAnalysisDraftsRef.current.get(runId);
		setFocusRequest(null);
		setLocationNotice(null);
		activeRunIdRef.current = runId;
		setActiveRunId(runId);
		setActiveAnalysisId(unsaved?.activeAnalysisId ?? "");
		setAnalystName(unsaved?.analystName ?? "");
		setExecutiveConclusion(unsaved?.executiveConclusion ?? "");
		setKeyFindings(unsaved?.keyFindings ?? "");
		setRawBrandIdentityAudit(unsaved?.rawBrandIdentityAudit ?? null);
		setBrandIdentityAudit(unsaved?.brandIdentityAudit ?? "");
		setContentGapsInput(unsaved?.contentGapsInput ?? "");
		setActionPlanInput(unsaved?.actionPlanInput ?? "");
		setRawActionPlan(unsaved?.rawActionPlan ?? []);
		const restoredItems = unsaved?.actionItems ?? (unsaved?.actionPlanInput ? inspectActionPlan(unsaved.actionPlanInput, unsaved.rawActionPlan).items : []);
		setActionItems(restoredItems);
		setActiveRevisionId("rev_01");
		setRevisionInput("rev_01");
		analysisDirtyRef.current = unsaved !== undefined;
		loadedAnalysisIdentityRef.current = "";
		setActionError(null);
		setReviewNotice(null);
		setReviewFeedback(null);
		setDeleteConfirm(null);
		setDeleteFeedback(null);
		setAutoActionFilter(autoActionFilterByRunRef.current.get(runId) ?? null);
		actionFilterProvenanceRef.current = actionFilterProvenanceByRunRef.current.get(runId) ?? null;

		// R02-F01-b: 核验状态与恢复的草稿/分析身份绑定；完成结果直接恢复，pending 则接续只读核验。
		const draftAnalysisId = unsaved?.activeAnalysisId ?? "";
		const cachedAudit = draftAnalysisId ? auditStateCacheRef.current.get(`${runId}:${draftAnalysisId}`) : undefined;
		if (!unsaved) {
			// 无未保存草稿时由 hydrate 重新判断是否自动分析并触发核验
			setAutoEvidenceAudit(null);
		} else if (!cachedAudit) {
			setAutoEvidenceAudit(null);
		} else if (cachedAudit.state === "pending") {
			setAutoEvidenceAudit({ ...cachedAudit });
			// 同步草稿身份，避免刚恢复时迟到的核验响应被当作别的任务丢弃
			currentAnalysisFormRef.current = {
				...currentAnalysisFormRef.current,
				activeAnalysisId: draftAnalysisId,
				actionItems: restoredItems,
				rawActionPlan: unsaved.rawActionPlan,
				actionPlanInput: unsaved.actionPlanInput,
			};
			void runHistoryEvidenceAuditRef.current({
				runId,
				analysisId: draftAnalysisId,
				identity: "",
				loadedCount: cachedAudit.audited,
			});
		} else {
			// 离开期间已完成/失败：在恢复的草稿副本上应用结论，保留人工输入
			const applied = computeAuditItems(restoredItems, cachedAudit);
			setActionItems(applied.items);
			setRawActionPlan(applied.items);
			setActionPlanInput(formatActionPlan(applied.items));
			setAutoEvidenceAudit({ ...cachedAudit, unsupported: applied.unsupported, unverified: applied.unverified });
			updateAuditProvenance(cachedAudit, applied);
		}
	}, []);

	const requestTaskFocus = useCallback((runId: string) => {
		handleSelectRun(runId);
		setActiveTab("portal");
		setFocusRequest((previous) => ({ runId, sequence: (previous?.sequence ?? 0) + 1 }));
	}, [handleSelectRun]);

	const lastRequestedRunIdRef = useRef<string | null>(null);
	useEffect(() => {
		if (requestedRunId && requestedRunId !== lastRequestedRunIdRef.current) {
			lastRequestedRunIdRef.current = requestedRunId;
			requestTaskFocus(requestedRunId);
		}
	}, [requestedRunId, requestTaskFocus]);

	const lastDraftRunIdRef = useRef<string | null>(null);
	useEffect(() => {
		if (draft.runId && !requestedRunId && draft.runId !== lastDraftRunIdRef.current) {
			lastDraftRunIdRef.current = draft.runId;
			requestTaskFocus(draft.runId);
		}
	}, [draft.runId, requestedRunId, requestTaskFocus]);

	// Restore the persisted task when returning from overview or reloading; never create work on mount.
	useEffect(() => {
		if (!activeRunId && !requestedRunId && runsListData?.items?.[0]?.run_id) {
			const targetRunId = draft.runId ?? runsListData.items[0].run_id;
			lastRequestedRunIdRef.current = targetRunId;
			requestTaskFocus(targetRunId);
		}
	}, [runsListData, activeRunId, requestedRunId, draft.runId, requestTaskFocus]);

	// 5.3. 查询当前快照的有效服务端预授权 (E5-R01)
	const { data: activeAuthData, refetch: refetchActiveAuth } = useQuery({
		queryKey: ["baselineActiveAuth", brandId, frozenSnapshot?.snapshot_id],
		queryFn: () =>
			frozenSnapshot
				? getBaselineActiveAuthFn({
						data: { brandId: brandId!, snapshotId: frozenSnapshot.snapshot_id },
					})
				: Promise.resolve({ authorization: null }),
		enabled: Boolean(brandId && frozenSnapshot?.snapshot_id && executionMode === "real"),
	});

	// Mutations
	const freezeMutation = useMutation({
		mutationFn: async () => {
			await Promise.all([...pendingDimensionWrites.current].map((write) => write.catch((err: Error) => {
				// A rejected frozen edit never changed the draft; genuine persistence failures still block.
				if (!(err instanceof FrozenDimensionInputError)) throw err;
			})));
			if (dimensionSaveError.current) throw dimensionSaveError.current;
			return transact(async (current) => {
			if (current.runId) {
				const existing = await getBaselineRunFn({ data: { brandId, runId: current.runId } });
				if (isDiagnosisInProgress(existing)) throw new Error("本次任务仍在执行，请先查看结果，不能准备下一轮。");
			} else if (current.snapshot) return { ...current, snapshot: null, authorizedRunId: undefined };
			const snapshot = await freezeBaselineInputsFn({ data: { brandId, versionLabel: "v1.0", dimensionOverrides: current.dimensions } });
			return { ...current, snapshot, runId: undefined, authorizedRunId: undefined, parameters: undefined, submitted: false };
			});
		},
		onSuccess: () => { setActionError(null); refetchActiveAuth(); },
		onError: (err: Error) => setActionError(`冻结输入失败: ${err.message}`),
	});

	const authorizeMutation = useMutation({
		mutationFn: () => transact(async (current, save) => {
			if (!current.snapshot) throw new Error("请先核对分类并冻结本轮输入。");
			if (current.snapshot.snapshot_id !== frozenSnapshot?.snapshot_id || current.mode !== executionMode) throw new Error("准备信息已在其他标签页变更，请重新核对后确认。");
			const auth = await getBaselineActiveAuthFn({ data: { brandId, snapshotId: current.snapshot.snapshot_id } });
			if (auth.authorization?.run_id) return { ...current, authorizedRunId: auth.authorization.run_id };
			if (current.submitted) throw new Error("本轮已经发起，请查看本次任务；下一轮需重新准备并授权。");
			const runId = current.authorizedRunId ?? `run_${crypto.randomUUID()}`;
			save({ ...current, authorizedRunId: runId });
			await registerBaselineServerAuthFn({ data: { brandId, snapshotId: current.snapshot.snapshot_id, runId, snapshotHash: current.snapshot.content_sha256, requestLimit: current.snapshot.question_count, retryLimit: 0, maxOutputTokens: samplingOutputTokens(current.parameters?.maxOutputTokens) } });
			return { ...current, authorizedRunId: runId };
		}),
		onSuccess: () => { setActionError(null); refetchActiveAuth(); },
		onError: (err: Error) => setActionError(`本次授权未完成：${err.message}`),
	});

	const createRunMutation = useMutation({
		mutationFn: () => transact(async (current, save) => {
			if (current.submitted && current.runId) {
				await getBaselineRunFn({ data: { brandId, runId: current.runId } });
				return current;
			}
			if (!current.snapshot) throw new Error("请先核对分类并冻结本轮输入。");
			if (current.snapshot.snapshot_id !== frozenSnapshot?.snapshot_id || current.mode !== executionMode) throw new Error("准备信息已在其他标签页变更，请重新核对后确认。");
			const auth = current.mode === "real" ? await getBaselineActiveAuthFn({ data: { brandId, snapshotId: current.snapshot.snapshot_id } }) : null;
			if (current.mode === "real" && !auth?.authorization && !current.runId) throw new Error("尚未授权本次真实诊断，请先核对费用并明确授权。");
			const activeAuth = auth?.authorization;
			const runId = current.runId ?? activeAuth?.run_id ?? `run_${crypto.randomUUID()}`;
			const parameters = current.parameters ?? { modelName: activeAuth?.model_name, webSearch: activeAuth?.web_search === undefined ? undefined : Boolean(activeAuth.web_search), maxOutputTokens: undefined };
			const resolvedParameters = {
				...parameters,
				maxOutputTokens: samplingOutputTokens(parameters.maxOutputTokens, activeAuth ? activeAuth.max_output_tokens ?? null : undefined),
			};
			const prepared = { ...current, runId, parameters: resolvedParameters };
			// Keep the same request identity if its response is lost or another tab repeats the action.
			save(prepared);
			const result = await createBaselineRunFn({ data: {
				brandId, snapshotId: current.snapshot.snapshot_id, mode: current.mode, runId,
				idempotencyKey: `idemp_${runId}`, requestBudget: current.snapshot.question_count, maxRetries: 0,
				...resolvedParameters,
			} });
			return { ...prepared, runId: result.run_id, submitted: true };
		}),
		onSuccess: (current) => {
			if (current.runId) {
				requestTaskFocus(current.runId);
				void navigate({ search: { runId: current.runId }, replace: true, resetScroll: false });
			}
			refetchRunsList();
		},
		onError: (err: Error) => {
			setActionError(
				draft.submitted && draft.runId
					? `本次任务状态查询未完成：${err.message}。已保留原任务身份，不会重新启动或重复计费。`
					: `本次任务未确认启动：${err.message}。请查看本次任务；重复提交仍使用同一任务身份。`,
			);
		},
	});
	const preparationBusy = freezeMutation.isPending || authorizeMutation.isPending || createRunMutation.isPending;
	// 历史自动建议依据核验未完成前禁止保存，确保编辑副本与保存/装配清单一致 (R01-F01)
	// 仅绑定当前任务与当前分析版本，切回后已完成的核验不会继续阻塞保存 (R02-F01-b)
	const autoAuditPending =
		autoEvidenceAudit?.runId === activeRunId &&
		autoEvidenceAudit.state === "pending" &&
		(!activeAnalysisId || autoEvidenceAudit.analysisId === activeAnalysisId);
	const handleStartDiagnosis = () => {
		if (preparationBusy) return;
		if (draft.submitted && draft.runId) {
			requestTaskFocus(draft.runId);
			void navigate({ search: { runId: draft.runId }, replace: true, resetScroll: false });
			return;
		}
		createRunMutation.mutate();
	};

	const retryAnalysisMutation = useMutation({
		mutationFn: ({ runId }: { runId: string }) =>
			retryBaselineAnalysisFn({
				fetch: baselineBrowserFetch,
				data: {
					brandId: brandId!,
					runId,
				},
			}),
		onSuccess: async (_result, { runId }) => {
			await Promise.all(["baseline-run", "baseline-analysis", "baseline-report"].map((key) =>
				queryClient.invalidateQueries({ queryKey: [key, brandId, runId] }),
			));
			if (runId === activeRunIdRef.current) {
				setRetryAnalysisFeedback((current) => { const next = { ...current }; delete next[runId]; return next; });
				requestTaskFocus(runId);
			}
		},
		onError: (err: Error, { runId }) => {
			setRetryAnalysisFeedback((current) => ({ ...current, [runId]: { message: analysisRequestErrorMessage(err), after: Date.now() } }));
			for (const key of ["baseline-run", "baseline-analysis", "baseline-report"]) {
				void queryClient.invalidateQueries({ queryKey: [key, brandId, runId] });
			}
		},
		onSettled: () => { retryAnalysisRunRef.current = null; },
	});
	const handleRetryAnalysis = () => {
		if (retryAnalysisRunRef.current || retryAnalysisMutation.isPending || runError || analysisQueryError || runData?.run_id !== activeRunId || runData.current_step !== "analysis_failed" || (recovery && !recovery.canRetry)) return;
		retryAnalysisRunRef.current = activeRunId;
		setRetryAnalysisFeedback((current) => { const next = { ...current }; delete next[activeRunId]; return next; });
		requestTaskFocus(activeRunId);
		retryAnalysisMutation.mutate({ runId: activeRunId });
	};

	const saveAnalysisMutation = useMutation({
		mutationFn: (args: SaveAnalysisArgs) => {
			// B18-CORE: 全部剔除/未补充行动建议时允许保存未就绪空行动草稿；
			// 正式交付仍由后端审核门禁“缺少有效行动建议”拦截。
			const actionPlan = actionItems.map((item, index) => {
				const priority = (item.priority ?? "P1").trim().toUpperCase();
				if (!["P0", "P1", "P2", "P3"].includes(priority)) {
					throw new Error(`行动建议第 ${index + 1} 项优先级无效，请填写 P0/P1/P2/P3。`);
				}
				// 显式构造保存字段：编辑态标记 audit_status 不写入分析 payload (R01-F01)
				return {
					priority: priority as "P0" | "P1" | "P2" | "P3",
					evidence_refs: item.evidence_refs ?? [],
					action: item.action ?? "",
					priority_rationale: item.priority_rationale ?? "",
					deliverable: item.deliverable ?? "",
					verification_method: item.verification_method ?? "",
					finding: item.finding ?? "",
					...(item.brand_id !== undefined ? { brand_id: item.brand_id } : {}),
					...(item.snapshot_id !== undefined ? { snapshot_id: item.snapshot_id } : {}),
					...(item.run_id !== undefined ? { run_id: item.run_id } : {}),
				};
			});

			let finalBrandIdentityAudit: any = brandIdentityAudit.trim() || "待人工核实与完善";
			if (rawBrandIdentityAudit && typeof rawBrandIdentityAudit === "object") {
				finalBrandIdentityAudit = {
					...rawBrandIdentityAudit,
					analysis: brandIdentityAudit.trim() || rawBrandIdentityAudit.analysis || "待人工核实与完善",
				};
			}

			// 保全成因、渠道与 AI 元数据 (F-R05 / F-R06)；B18-CORE 记录载入时无依据自动建议的筛选来源
			const rootCauses = analysisData?.payload?.root_causes || [];
			const channelGaps = analysisData?.payload?.channel_gaps || [];
			const filterProvenance = actionFilterProvenanceRef.current;
			const aiMetadata = analysisData?.payload?.ai_metadata
				? {
						...analysisData.payload.ai_metadata,
						parent_version: analysisData.version,
						human_refined: true,
						...(filterProvenance
							? {
									action_filter: {
										origin: "load_filter_no_ref_auto_actions",
										source_analysis_id: filterProvenance.sourceAnalysisId,
										source_version: filterProvenance.sourceVersion,
										filtered_no_ref: filterProvenance.filteredNoRef,
										backend_filtered: filterProvenance.backendFiltered,
										historical_audit: {
											audited: filterProvenance.audited,
											unsupported_filtered: filterProvenance.unsupported,
											unverified_kept: filterProvenance.unverified,
											evidence_ready: filterProvenance.evidenceReady,
										},
									},
								}
							: {}),
					}
				: undefined;

			return saveBaselineAnalysisFn({
				data: {
					brandId: brandId!,
					runId: args.runId,
					analystName: analystName.trim() || "未具名分析师",
					executiveConclusion: executiveConclusion.trim() || "待补充执行结论",
					keyFindings: keyFindings
						.split("\n")
						.map((s) => s.trim())
						.filter((s) => s.length > 0),
					brandIdentityAudit: finalBrandIdentityAudit,
					contentGaps: contentGapsInput.trim() || "待人工补充内容资产缺口",
					rootCauses,
					channelGaps,
					actionPlan,
					aiMetadata,
					parentVersion: analysisData?.version,
				},
			});
		},
		onSuccess: async (res, args) => {
			// 只有发起任务仍是当前任务时才写回表单/分析选中；否则仅刷新该任务自己的缓存 (B08-R02 F01)
			const stillActive = args.runId === activeRunIdRef.current;
			setSaveWorkflowPhase("assembling");
			if (stillActive) {
				setActiveAnalysisId(res.analysis_id);
				setActionError(null);
				analysisDirtyRef.current = false;
				loadedAnalysisIdentityRef.current = "";
				await refetchAnalysis();
			} else {
				await queryClient.invalidateQueries({ queryKey: ["baseline-analysis", brandId, args.runId] });
			}
			// 自动装配始终绑定发起任务，不随后续切换改变 (F-R05 / B08-R02 F01)
			generateRevisionMutation.mutate({
				revisionId: args.nextRevisionId,
				analysisId: res.analysis_id,
				origin: "auto",
				runId: args.runId,
			});
		},
		onError: (err: any, args: SaveAnalysisArgs) => {
			saveWorkflowRef.current = false;
			setSaveWorkflowPhase("idle");
			setSaveWorkflowRunId("");
			if (args.runId === activeRunIdRef.current) setActionError(`保存人工分析失败: ${err.message}`);
		},
	});

	const generateRevisionMutation = useMutation({
		mutationFn: (args: GenerateRevisionArgs) => {
			const revId = args.revisionId;
			const anlId = args.analysisId || activeAnalysisId;
			return generateBaselineReportRevisionFn({
				data: {
					brandId: brandId!,
					runId: args.runId,
					revisionId: revId.trim() || "rev_01",
					analysisId: anlId,
					draftNotice: `内部预览草稿，未经终审（${revId.trim() || "rev_01"} · 离线验证）`,
				},
			});
		},
		onSuccess: (res, args) => {
			// 修订选择与编号只回写发起任务；其他任务仅刷新自己的报告缓存 (B08-R02 F01/F02)
			if (args.runId === activeRunIdRef.current) {
				setActiveRevisionId(res.revision_id);
				// 自动预推下一个 revision 编号供继续修改 (E-R06)
				const currentNum = parseInt(res.revision_id.replace(/^rev_/, ""), 10) || 1;
				setRevisionInput(`rev_${String(currentNum + 1).padStart(2, "0")}`);
				setActionError(null);
				refetchReport();
			} else {
				void queryClient.invalidateQueries({ queryKey: ["baseline-report", brandId, args.runId] });
			}
			if (args.origin === "auto") {
				saveWorkflowRef.current = false;
				setSaveWorkflowPhase("idle");
				setSaveWorkflowRunId("");
			}
		},
		onError: (err: any, args) => {
			if (args.runId === activeRunIdRef.current) setActionError(`生成报告修订失败: ${err.message}`);
			if (args.origin === "auto") {
				saveWorkflowRef.current = false;
				setSaveWorkflowPhase("idle");
				setSaveWorkflowRunId("");
			}
		},
	});
	const handleSaveAnalysis = () => {
		if (saveWorkflowRef.current || !activeRunId || autoAuditPending) return;
		// 保存与后续自动装配都锁定发起任务与当时的下一个修订号 (B08-R02 F01)
		// B18-CORE: 下一修订号按含删除历史的最大修订序号分配，不因删除回退编号
		const initiatingRunId = activeRunId;
		const revisions = reportData?.run_id === initiatingRunId ? reportData.revisions ?? [] : [];
		const maxRevNum = revisions.reduce((max: number, r: any) => {
			const n = parseInt(String(r.revision_id).replace(/^rev_/, ""), 10);
			return Number.isFinite(n) && n > max ? n : max;
		}, 0);
		const targetRevisionId = `rev_${String(maxRevNum + 1).padStart(2, "0")}`;
		saveWorkflowRef.current = true;
		setSaveWorkflowRunId(initiatingRunId);
		setSaveWorkflowPhase("saving");
		saveAnalysisMutation.mutate({ runId: initiatingRunId, nextRevisionId: targetRevisionId });
	};

	const reviewMutation = useMutation({
		mutationFn: (args: ReviewArgs) =>
			reviewBaselineReportRevisionFn({
				data: {
					brandId: brandId!,
					reportId: `rpt_${args.runId}`,
					revisionId: args.revisionId || "rev_01",
					action: args.action,
					reason: args.reason,
				},
			}),
		onMutate: (args) => {
			if (args.runId === activeRunIdRef.current && args.revisionId === activeRevisionIdRef.current) {
				setReviewFeedback(null);
				setReviewNotice(null);
			}
		},
		onSuccess: (res, args) => {
			// 成功反馈必须匹配发起任务与当前所选修订，避免同名 revision 串到其他任务 (B08-R02 F02)
			const stillActive = args.runId === activeRunIdRef.current;
			const matchedRevision = stillActive && args.revisionId === activeRevisionIdRef.current;
			const statusText =
				res.review_status === "approved" ? "已批准" : res.review_status === "rejected" ? "已退回" : res.review_status;
			const message = `${args.revisionId} 审核完成：${statusText}（审核主体: ${res.reviewer}）`;
			if (matchedRevision) {
				setReviewFeedback({ tone: "success", runId: args.runId, revisionId: args.revisionId, message });
				setReviewNotice(message);
			}
			if (stillActive) {
				setActionError(null);
				refetchReport();
			} else {
				void queryClient.invalidateQueries({ queryKey: ["baseline-report", brandId, args.runId] });
			}
		},
		onError: (err: any, args) => {
			// 合成数据批准被拒绝是预期内的严格机器门禁行为 (D-R06 / D-R07)
			const stillActive = args.runId === activeRunIdRef.current;
			const matchedRevision = stillActive && args.revisionId === activeRevisionIdRef.current;
			if (matchedRevision) {
				setReviewNotice(null);
				setReviewFeedback({
					tone: "error",
					runId: args.runId,
					revisionId: args.revisionId,
					message: `审核未完成：${err.message}`,
				});
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (args: { runId: string; revisionId: string; reason?: string }) =>
			deleteBaselineReportRevisionFn({
				data: {
					brandId: brandId!,
					reportId: `rpt_${args.runId}`,
					revisionId: args.revisionId,
					reason: args.reason,
				},
			}),
		onMutate: (args) => {
			if (args.runId === activeRunIdRef.current) {
				setDeleteFeedback(null);
			}
		},
		onSuccess: async (res: any, args) => {
			// 迟到响应绑定：请求绑定点击时的任务与修订；切换任务/修订后不改动当前选择
			const stillActive = args.runId === activeRunIdRef.current;
			const matchedRevision = stillActive && args.revisionId === activeRevisionIdRef.current;
			const alreadyDeleted = Boolean(res?.already_deleted);
			const message = alreadyDeleted
				? `${args.revisionId} 已处于删除状态（重复删除返回稳定反馈，未产生新的写入）`
				: `${args.revisionId} 已删除：从修订列表移除，产物文件与审计记录保留，编号不再复用`;
			if (matchedRevision) {
				setDeleteFeedback({ tone: "success", runId: args.runId, revisionId: args.revisionId, message });
			}
			setDeleteConfirm(null);
			if (stillActive) {
				// 刷新列表后自动选择剩余最新未删除修订；无剩余时清空当前修订（不触发装配/采样/模型调用）
				const refreshed = await refetchReport();
				const revisions = refreshed.data?.revisions ?? [];
				if (matchedRevision) {
					const latestAlive = [...revisions].reverse().find((r: any) => !r.deleted_at);
					setActiveRevisionId(latestAlive ? latestAlive.revision_id : "");
				}
			} else {
				void queryClient.invalidateQueries({ queryKey: ["baseline-report", brandId, args.runId] });
			}
		},
		onError: (err: any, args) => {
			// 失败保留列表与当前选择，准确显示原因，不自动重试
			const stillActive = args.runId === activeRunIdRef.current;
			const matchedRevision = stillActive && args.revisionId === activeRevisionIdRef.current;
			if (matchedRevision) {
				setDeleteFeedback({
					tone: "error",
					runId: args.runId,
					revisionId: args.revisionId,
					message: `删除未完成：${err.message}`,
				});
			}
			setDeleteConfirm(null);
		},
	});

	const downloadMutation = useMutation({
		mutationFn: async (format: "pdf" | "html" | "json") => {
			const response = await fetch(
				`/api/baseline/download?reportId=rpt_${activeRunId}&revisionId=${activeRevisionId}&brandId=${encodeURIComponent(brandId!)}&format=${format}`,
				{ credentials: "same-origin" },
			);
			if (!response.ok) {
				let message = `下载请求失败 (HTTP ${response.status})`;
				try {
					const payload = await response.json();
					message = payload.message || payload.detail?.message || (typeof payload.detail === "string" ? payload.detail : message);
				} catch {
					// 保留 HTTP 状态反馈，不将非 JSON 错误响应保存为产物。
				}
				if (response.status === 401) message = "登录状态已失效，请重新登录后重试";
				if (response.status === 403) message = "无权下载该报告，请核对当前品牌与账号权限";
				if (response.status === 404) message = "报告产物不存在或尚未就绪，请刷新修订状态";
				throw new Error(message);
			}

			const expectedType = { pdf: "application/pdf", html: "text/html", json: "application/json" }[format];
			const actualType = response.headers.get("Content-Type")?.toLowerCase() || "";
			if (!actualType.includes(expectedType)) {
				throw new Error("下载响应格式不正确，未保存文件");
			}
			const blob = await response.blob();
			if (blob.size === 0) throw new Error("下载产物为空，未保存文件");

			const fallbackFilename = `${brandId}_${activeRevisionId}.${format}`;
			const disposition = response.headers.get("Content-Disposition") || "";
			const encodedFilename = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
			const quotedFilename = disposition.match(/filename="([^"]+)"/i)?.[1];
			let filename = fallbackFilename;
			if (encodedFilename) {
				try {
					filename = decodeURIComponent(encodedFilename);
				} catch {
					filename = fallbackFilename;
				}
			} else if (quotedFilename) {
				filename = quotedFilename;
			}
			filename = filename.split(/[\\/]/).pop() || fallbackFilename;
			return { blob, filename };
		},
		onMutate: () => setDownloadError(null),
		onSuccess: ({ blob, filename }) => {
			const objectUrl = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = objectUrl;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
		},
		onError: (err: Error) => setDownloadError(`下载失败：${err.message}`),
	});

	const activeRevision = reportData?.revisions?.find(
		(rev: { revision_id: string; status: string; deleted_at?: string | null; review_status?: string }) =>
			rev.revision_id === activeRevisionId,
	);
	const downloadsReady = activeRevision?.status === "ready";
	const hasCurrentAnalysis = analysisData?.run_id === activeRunId;
	const requestFeedback = retryAnalysisFeedback[activeRunId];
	const recovery = requestFeedback ? analysisRecoveryStatus(runData, {
		fresh: Math.max(runUpdatedAt, runErrorAt) >= requestFeedback.after && Math.max(analysisUpdatedAt, analysisErrorAt) >= requestFeedback.after,
		readFailed: Boolean(runError || analysisQueryError),
		hasAnalysis: hasCurrentAnalysis,
	}) : null;
	const evidenceQuestions = evidenceData?.run_id === activeRunId
		? [...(evidenceData.formal_questions ?? []), ...(evidenceData.probe_questions ?? [])]
		: [];
	const handleCollapseQuestion = useCallback((questionCode: string, isProbe = false) => {
		const currentRunId = activeRunIdRef.current;
		const currentBrandId = brandIdRef.current;
		setExpandedQuestions((prev) => ({ ...prev, [questionCode]: false }));
		requestAnimationFrame(() => {
			if (activeRunIdRef.current !== currentRunId || brandIdRef.current !== currentBrandId) return;
			const prefix = isProbe ? "probe" : "question";
			const cardEl = document.getElementById(`${prefix}-card-${currentRunId}-${questionCode}`);
			const toggleBtn = document.getElementById(`${prefix}-toggle-btn-${currentRunId}-${questionCode}`);
			if (cardEl) {
				cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
			}
			if (toggleBtn) {
				toggleBtn.focus({ preventScroll: true });
			}
		});
	}, []);

	const handleCollapseActionEvidence = useCallback((actionIndex: number) => {
		const currentRunId = activeRunIdRef.current;
		const currentBrandId = brandIdRef.current;
		setExpandedActionEvidences((prev) => ({ ...prev, [actionIndex]: false }));
		requestAnimationFrame(() => {
			if (activeRunIdRef.current !== currentRunId || brandIdRef.current !== currentBrandId) return;
			const cardEl = document.getElementById(`action-card-${currentRunId}-${actionIndex}`);
			const toggleBtn = document.getElementById(`action-evidence-toggle-${currentRunId}-${actionIndex}`);
			if (cardEl) {
				cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
			}
			if (toggleBtn) {
				toggleBtn.focus({ preventScroll: true });
			}
		});
	}, []);

	const handleAddAction = useCallback(() => {
		const newItem: AnalysisAction = {
			action: "",
			priority: "P1",
			priority_rationale: "",
			deliverable: "",
			verification_method: "",
			finding: "",
			evidence_refs: [],
		};
		setActionItems((prev) => {
			const next = [...prev, newItem];
			setActionPlanInput(formatActionPlan(next));
			return next;
		});
		markAnalysisDirty();
	}, []);

	const handleRemoveAction = useCallback((index: number) => {
		setActionItems((prev) => {
			const next = prev.filter((_, i) => i !== index);
			setActionPlanInput(formatActionPlan(next));
			return next;
		});
		markAnalysisDirty();
		setExpandedActionEvidences((prev) => {
			const next: Record<number, boolean> = {};
			Object.entries(prev).forEach(([key, val]) => {
				const numKey = Number(key);
				if (numKey < index) next[numKey] = val;
				else if (numKey > index) next[numKey - 1] = val;
			});
			return next;
		});
	}, []);

	const handleUpdateActionField = useCallback((index: number, field: keyof AnalysisAction, val: string) => {
		setActionItems((prev) => {
			const next = prev.map((item, i) => (i === index ? { ...item, [field]: val } : item));
			setActionPlanInput(formatActionPlan(next));
			return next;
		});
		markAnalysisDirty();
	}, []);

	const updateActionRefs = useCallback((index: number, code: string, checked: boolean) => {
		setActionItems((prev) => {
			const next = prev.map((item, i) =>
				i !== index
					? item
					: {
							...item,
							evidence_refs: checked
								? [...(item.evidence_refs ?? []), code]
								: (item.evidence_refs ?? []).filter((ref) => ref !== code),
					  },
			);
			setActionPlanInput(formatActionPlan(next));
			return next;
		});
		markAnalysisDirty();
	}, []);
	const analysisForm = diagnosisAnalysisFormStatus(runData, {
		hasAnalysis: hasCurrentAnalysis,
		analysisLoading: analysisQueryLoading,
		analysisQueryFailed: Boolean(analysisQueryError),
		runQueryFailed: Boolean(runError),
	});
	// 保存/装配阶段与任务绑定：阶段提示只对发起任务展示，忙碌状态对所有任务生效 (B08-R02 F01)
	const saveWorkflowBusy =
		saveWorkflowPhase !== "idle" || saveAnalysisMutation.isPending || generateRevisionMutation.isPending;
	const activeSaveWorkflowPhase =
		saveWorkflowRunId && saveWorkflowRunId === activeRunId ? saveWorkflowPhase : "idle";
	const foreignSaveWorkflowBusy = saveWorkflowBusy && activeSaveWorkflowPhase === "idle";
	const analysisLocked = !analysisForm.editable || activeSaveWorkflowPhase !== "idle";
	const reviewBlockedReason = !activeRevision
		? `当前修订 ${activeRevisionId || "—"} 尚未生成，暂不可审核。`
		: activeRevision.deleted_at
			? `当前修订 ${activeRevisionId} 已删除，不可审核或下载。`
			: activeRevision.status !== "ready"
				? `当前修订 ${activeRevisionId} 状态为 ${revisionStatusLabel(activeRevision.status)}，未就绪，审核门禁不可用。`
				: null;
	// B18-CORE: 仅草稿/已退回且不在渲染中的修订可删除；approved/未知状态不给可用入口（服务端仍独立校验）
	// R01-F03: 角色不满足时同样不给入口
	const activeRevisionDeletable = Boolean(
		canDeleteRevisions &&
			activeRevision &&
			!activeRevision.deleted_at &&
			(activeRevision.review_status === "draft" || activeRevision.review_status === "rejected") &&
			activeRevision.status !== "rendering",
	);
	const preparedRun = draft.runId
		? activeRunId === draft.runId
			? (runData ?? preparedRunData ?? runsListData?.items?.find((r: any) => r.run_id === draft.runId))
			: (preparedRunData ?? runsListData?.items?.find((r: any) => r.run_id === draft.runId))
		: null;
	const preparedRunActive = preparedRun ? isBaselineRunActive(preparedRun) : false;
	const startButtonDisabled =
		!frozenSnapshot ||
		preparationBusy ||
		(!draft.submitted && !draft.runId && executionMode === "real" && !activeAuthData?.authorization) ||
		(draft.submitted && preparedRunActive);
	const startButtonLabel = createRunMutation.isPending
		? "正在确认本次任务..."
		: !draft.submitted
			? draft.runId
				? "查询或重放本次启动"
				: "启动本次诊断任务"
			: preparedRunActive
				? "本次任务进行中（请查看进度）"
				: !preparedRun
					? "查询本次任务状态"
					: preparedRun.status === "failed" || preparedRun.status === "interrupted"
						? "查看本次任务（已中止）"
						: preparedRun.current_step === "analysis_failed"
							? "查看本次任务（分析失败）"
								: preparedRun.current_step === "report_render_failed"
									? "查看本次任务（报告失败）"
									: preparedRun.current_step === "ready_for_review"
										? "查看本次任务（待审核）"
										: preparedRun.status === "partial"
											? "查看本次任务（部分完成）"
											: "查看本次任务（已结束）";
	const analysisStatusTitle =
		analysisForm.phase === "ready"
			? "分析已就绪，可人工修改"
			: analysisForm.phase === "generating"
				? "Negency-Agent 正在生成分析"
				: analysisForm.phase === "waiting"
					? "分析尚未开始"
					: analysisForm.phase === "failed"
						? "分析不可用"
						: analysisForm.phase === "unreadable"
							? "分析结果读取失败"
							: analysisForm.phase === "missing"
								? "暂无可用分析"
								: "分析状态待确认";
	const analysisStatusClass =
		analysisForm.phase === "ready"
			? "border-green-300 bg-green-50/70 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200"
			: analysisForm.phase === "generating"
				? "border-blue-300 bg-blue-50/70 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200"
				: analysisForm.phase === "waiting"
					? "border-blue-200 bg-blue-50/50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-200"
					: analysisForm.phase === "failed" || analysisForm.phase === "unreadable"
						? "border-red-300 bg-red-50/70 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
						: "border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200";

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
							统一诊断操作门户（手动单次监测 · 不自动续采）
						</p>
					</div>
				</div>

				{/* 顶栏 Tab */}
				<div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
					<button
						onClick={() => setActiveTab("portal")}
						className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
							activeTab === "portal"
								? "bg-background shadow-sm text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						统一诊断工作台
					</button>
					<button
						onClick={() => setActiveTab("legacy")}
						className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
							activeTab === "legacy"
								? "bg-background shadow-sm text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						历史归档报告
					</button>
				</div>
			</div>

			{/* 错误与状态提示 */}
			{(runsListError || runError || profileError) && (
				<div className="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
					<IconAlertTriangle className="mt-0.5 shrink-0" size={18} />
					<div className="flex-1">
						<span className="font-semibold">诊断服务通信异常：</span>
						{(runsListError as any)?.message ||
							(runError as any)?.message ||
							(profileError as any)?.message ||
							"无法连接到诊断后端服务，请检查服务运行状态与内部网络连接"}
					</div>
				</div>
			)}
			{actionError && (
				<div className="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
					<IconAlertTriangle className="mt-0.5 shrink-0" size={18} />
					<div className="flex-1">{actionError}</div>
					<button onClick={() => setActionError(null)} className="text-xs hover:underline">
						关闭
					</button>
				</div>
			)}
			{reviewNotice && (
				<div className="bg-green-50 dark:bg-green-950/40 border border-green-300 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
					<IconCheck className="mt-0.5 shrink-0" size={18} />
					<div className="flex-1">{reviewNotice}</div>
					<button onClick={() => setReviewNotice(null)} className="text-xs hover:underline">
						关闭
					</button>
				</div>
			)}

			{/* ========================================================================= */}
			{/* 主视图 1: 统一诊断工作台 (PORTAL) */}
			{/* ========================================================================= */}
			{activeTab === "portal" && (
				<div className="flex flex-col gap-8">
					{/* 历史 Run 选择区 (E-R06: 恢复历史任务选择与状态处理) */}
					{runsListData?.items && runsListData.items.length > 0 && (
						<div className="bg-muted/30 border rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
							<div className="flex items-center gap-2">
								<span className="font-semibold text-foreground">切换已有监测任务:</span>
								<select
									value={activeRunId}
									aria-label="切换已有监测任务"
									onChange={(e) => { if (!e.target.value) return; requestTaskFocus(e.target.value); void navigate({ search: { runId: e.target.value }, replace: true, resetScroll: false }); }}
									className="border rounded-md px-2 py-1.5 bg-background font-mono text-xs max-w-xs"
								>
									<option value="" disabled>-- 选择已有任务查看/处理 --</option>
									{runsListData.items.map((r: any) => {
										const taskLabel = formatDiagnosticTaskName({
											brandName,
											runId: r.run_id,
											createdAt: r.created_at || r.completed_at,
											isZh: true,
										});
										const modeLabel = r.mode === "real" ? "真实执行" : r.mode === "synthetic" ? "合成演示" : r.mode;
										const statusTitle = diagnosisStatusText(r).title;
										return (
											<option key={r.run_id} value={r.run_id} title={r.run_id}>
												{taskLabel} ({modeLabel} · {statusTitle})
											</option>
										);
									})}
								</select>
							</div>
							<div className="text-muted-foreground">
								历史已发起总任务数: <span className="font-semibold text-foreground">{runsListData.total}</span>
							</div>
						</div>
					)}

					{/* 步骤 1: 客户资料与多业务题集核对 (E-R04) */}
					<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
						<div className="flex items-center justify-between border-b pb-3">
							<div className="flex items-center gap-2 font-semibold text-base">
								<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
									1
								</span>
								核对主数据与题集（支持多业务分类补齐）
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
							<div className="flex flex-col gap-4">
								<div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
									<div className="bg-muted/40 p-3 rounded-lg flex flex-col gap-1">
										<span className="text-muted-foreground text-xs">品牌名称与主域名</span>
										<span className="font-semibold">{profileData?.brand.name}</span>
										<span className="text-xs text-muted-foreground">{profileData?.brand.website || "无主域名"}</span>
										{(profileData?.brand.additionalDomains?.length ?? 0) > 0 && (
											<span className="text-[11px] text-muted-foreground">
												附加域名: {profileData?.brand.additionalDomains.join(", ")}
											</span>
										)}
									</div>
									<div className="bg-muted/40 p-3 rounded-lg flex flex-col gap-1">
										<span className="text-muted-foreground text-xs">业务产品线 (Product Lines)</span>
										<span className="font-semibold">
											{profileData?.brand.productLines?.length ?? 0} 条业务板块
										</span>
										<span className="text-xs text-muted-foreground truncate">
											{profileData?.brand.productLines?.map((pl: any) => pl.name).join(" / ") || "未配置业务线"}
										</span>
									</div>
									<div className="bg-muted/40 p-3 rounded-lg flex flex-col gap-1">
										<span className="text-muted-foreground text-xs">多业务题集结构</span>
										<span className="font-semibold">
											共 {profileData?.summary.totalPrompts ?? 0} 题 (正式题 {profileData?.summary.formalCount ?? 0} / 探针 {profileData?.summary.probeCount ?? 0})
										</span>
										<span className="text-xs text-muted-foreground">
											{(profileData?.summary.unclassifiedCount ?? 0) > 0 ? (
												<span className="text-amber-600 dark:text-amber-400 font-semibold">
													⚠️ 有 {profileData?.summary.unclassifiedCount} 题尚未分类
												</span>
											) : (
												"全部题目已绑定业务分类"
											)}
										</span>
									</div>
								</div>

								{/* 完整题文明细展示与人工分类补齐表 (E-R04) */}
								<div className="border rounded-lg overflow-hidden text-xs">
									<div className="bg-muted/60 px-3 py-2 font-semibold text-muted-foreground flex items-center justify-between">
										<span>待确认题目明细（核验分类与题型，分类缺失须在此补齐）</span>
										<span>已选 {profileData?.prompts.length ?? 0} 题</span>
									</div>
									<div className="divide-y max-h-56 overflow-y-auto">
										{profileData?.prompts.map((p: any) => (
											<div key={p.id} className="p-2.5 flex items-center justify-between gap-3 hover:bg-muted/20">
												<div className="flex items-center gap-2 flex-1">
													<span className="font-mono font-bold text-muted-foreground w-12 shrink-0">
														[{p.code}]
													</span>
													<span className="text-foreground">{p.text}</span>
													{p.isProbe && (
														<span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 shrink-0">
															主体探针
														</span>
													)}
												</div>
												<div className="flex items-center gap-2 shrink-0">
													<span className="text-muted-foreground text-[11px]">业务维度:</span>
													<DiagnosisDimensionInput
														type="text"
														placeholder="输入业务板块"
														aria-label={`业务分类 ${p.code}`}
														value={dimensionOverrides[p.id] ?? (p.unclassified ? "" : p.dimensionName)}
														onCommit={(value) => saveDimension(p.id, value)}
														onComposing={setDimensionComposing}
														disabled={preparationBusy || Boolean(frozenSnapshot || draft.runId)}
														className={`border rounded px-2 py-1 text-xs w-32 bg-background ${
															p.unclassified && !dimensionOverrides[p.id]
																? "border-amber-400 bg-amber-50/50 dark:bg-amber-950/20"
																: ""
														}`}
													/>
												</div>
											</div>
										))}
									</div>
								</div>
							</div>
						)}

						{/* 核对并冻结本轮输入 */}
						<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t">
							<div className="text-sm font-semibold text-foreground">
								{frozenSnapshot ? (
									<span className="text-green-700 dark:text-green-300 inline-flex items-center gap-1">
										<IconCheck size={14} /> 已锁定输入快照: {frozenSnapshot.snapshot_id} (题目数: {frozenSnapshot.question_count})
									</span>
								) : (
									"先核对分类并冻结输入，再在下方确认费用、启动一次诊断。冻结本身不会采集或调用模型。"
								)}
							</div>
							<div className="flex items-center gap-2 shrink-0">
								<button
									onClick={() => { if (!draft.runId || window.confirm("准备下一轮诊断？仅重新冻结输入，真实执行仍需重新授权并手动启动。")) freezeMutation.mutate(); }}
									disabled={
										dimensionComposing || preparationBusy ||
										!profileData ||
										profileData.summary.totalPrompts === 0
									}
									className={`text-xs border px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${
										frozenSnapshot
											? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-800 text-green-800 dark:text-green-200 hover:bg-green-100/70"
											: "bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200 hover:bg-red-100/70"
									}`}
								>
									<IconLock size={14} className="inline mr-1" />
									{freezeMutation.isPending ? "冻结中..." : draft.runId ? "准备下一轮诊断" : frozenSnapshot ? "重新核对分类" : "核对并冻结输入"}
								</button>
							</div>
						</div>
					</div>

					{/* 步骤 2: 手动发起单次有限监测 (前置摘要 + 模式选择 + 防并发) */}
					<div data-no-i18n="true" className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
						<div className="flex items-center justify-between border-b pb-3">
							<div className="flex items-center gap-2 font-semibold text-base">
								<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
									2
								</span>
								执行本次监测（手动单次 · 费用边界确认）
							</div>
							<div className="flex items-center gap-2 text-xs">
								<span className="text-muted-foreground">下一轮准备模式:</span>
								<select
									aria-label="下一轮准备模式"
									value={executionMode}
									disabled={preparationBusy || Boolean(draft.runId)}
									onChange={(e) => { const mode = e.target.value as "real" | "synthetic"; void transact((current) => ({ ...current, mode })).catch((err: Error) => setActionError(err.message)); }}
									className="border rounded px-2 py-1 bg-background text-xs font-semibold"
								>
									<option value="real">真实执行（需本轮费用授权）</option>
									<option value="synthetic">离线合成测试（0 费用 · 不调用真实模型）</option>
								</select>
							</div>
						</div>

						{/* 任务前摘要卡片 */}
						<div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-4 rounded-xl flex flex-col gap-2">
							<div className="font-semibold text-amber-900 dark:text-amber-200 text-sm flex items-center gap-2">
								<IconShieldCheck size={18} className="text-amber-600" />
								本轮执行前确认摘要（一次性有限运行 · 严禁自动续采）
							</div>
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mt-1">
								<div>
									<span className="text-muted-foreground">采集调用：</span>
									<span className="font-semibold ml-1">豆包</span>
								</div>
								<div>
									<span className="text-muted-foreground">分析调用：</span>
									<span className="font-semibold ml-1">Negency-Agent</span>
								</div>
								<div>
									<span className="text-muted-foreground">下一轮准备模式：</span>
									<span className="font-semibold ml-1">
										{executionMode === "real" ? "真实执行" : "离线合成测试"}
									</span>
								</div>
								<div>
									<span className="text-muted-foreground">费用与限制：</span>
									<span className="font-semibold ml-1 text-amber-700 dark:text-amber-300">
										{executionMode === "real"
											? activeAuthData?.authorization
												? `采集上限 ${activeAuthData.authorization.request_limit} 次 · 重试 ${activeAuthData.authorization.retry_limit} 次 · 分析 1 轮`
												: "待完成本轮费用授权（未授权不会发起采集）"
											: "0 费用 · 不调用真实模型"}
									</span>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								下一轮单题输出上限：{activeAuthData?.authorization?.max_output_tokens ?? draft.parameters?.maxOutputTokens ?? DEFAULT_SAMPLING_OUTPUT_TOKENS} Token（包含回答与推理，旧授权及显式更小值不扩大）。
							</p>
							<p className="text-xs text-muted-foreground">
								模式选择本身不会发起授权、采集或模型调用；真实执行仍需本章节费用确认后手动启动。
							</p>
							{executionMode === "real" && (
								<div className="mt-1 p-2.5 rounded-lg border bg-muted/40 text-xs">
									<div className="flex items-center gap-1.5 font-semibold">
										<span
											className={`w-2 h-2 rounded-full ${
												activeAuthData?.authorization ? "bg-green-500" : "bg-amber-500"
											}`}
										/>
										预授权状态：
										{activeAuthData?.authorization ? (
											<span className="text-green-700 dark:text-green-300 font-mono">
												已就绪 ({activeAuthData.authorization.run_id})
											</span>
										) : (
											<span className="text-amber-700 dark:text-amber-300">
												待完成本轮费用授权（未授权不会发起采集）
											</span>
										)}
									</div>
									{activeAuthData?.authorization && (
										<div className="text-muted-foreground mt-1 space-y-0.5 font-mono text-[11px]">
											<div>
												采集上限: {activeAuthData.authorization.request_limit} 次 · 重试:{" "}
												{activeAuthData.authorization.retry_limit} 次
											</div>
											<div>联网检索: {activeAuthData.authorization.web_search ? "开启" : "关闭"}</div>
											<div>单题输出上限: {activeAuthData.authorization.max_output_tokens ?? "未明确，需重新确认"} Token（包含回答与推理）</div>
										</div>
									)}
								</div>
							)}
							{executionMode === "real" && frozenSnapshot && !activeAuthData?.authorization && (
								<div className="space-y-2">
									<p className="text-xs">本次仅授权这 {frozenSnapshot.question_count} 道题，采集上限 {frozenSnapshot.question_count} 次、重试 0 次，单题输出上限 {draft.parameters?.maxOutputTokens ?? DEFAULT_SAMPLING_OUTPUT_TOKENS} Token（包含回答与推理）；提高上限可能增加费用，不保证回答必完整。分析沿用本页所示范围。需要组织管理员或 owner 确认。</p>
									<button type="button" disabled={preparationBusy || draft.submitted} className="border rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => {
										if (window.confirm(`确认授权本次 ${frozenSnapshot.question_count} 题真实豆包诊断？采集最多 ${frozenSnapshot.question_count} 次、重试 0 次，单题输出上限 ${draft.parameters?.maxOutputTokens ?? DEFAULT_SAMPLING_OUTPUT_TOKENS} Token（包含回答与推理，可能增加费用，不保证必完整），另含本页所示的 Negency-Agent 分析。仅本轮有效，不自动续采。`)) authorizeMutation.mutate();
									}}>确认本次费用范围并授权</button>
								</div>
							)}

							<p className="text-xs text-muted-foreground mt-1">
								本轮仅执行一次诊断，完成后不会自动创建下一轮；真实执行需先完成本轮费用授权，未授权不会发起采集。
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
							<button
								onClick={handleStartDiagnosis}
								disabled={startButtonDisabled}
								className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-green-700 transition-colors disabled:opacity-50"
							>
								<IconPlayerPlay size={15} />
								{startButtonLabel}
							</button>
						</div>
						{draft.submitted && preparedRunActive && (
							<p role="status" className="text-xs text-blue-700 dark:text-blue-300">
								本次任务仍在执行，启动入口已锁定，不会重复发起任务。
								<button type="button" className="ml-2 underline" onClick={() => {
									if (!draft.runId) return;
									requestTaskFocus(draft.runId);
									void navigate({ search: { runId: draft.runId }, replace: true, resetScroll: false });
								}}>查看本次任务进度（只读）</button>
							</p>
						)}
						{focusRequest?.runId === activeRunId && <p role="status" className="text-xs">正在读取本任务状态，确认后定位；不会重发任务。</p>}
						{locationNotice?.runId === activeRunId && <p role="status" className="text-xs">{locationNotice.message}</p>}
					</div>

					{/* 步骤 3: 诊断任务状态与客观指标看板 */}
					{activeRunId && (
						<section ref={progressPanelRef} aria-label="板块3：任务进度与客观指标" data-no-i18n="true" className="scroll-mt-24 border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-5">
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
										refetchAnalysis();
										refetchReport();
									}}
									disabled={runFetching}
									className="text-xs border px-2.5 py-1 rounded-md hover:bg-accent inline-flex items-center gap-1"
								>
									<IconRefresh size={14} /> 刷新结果
								</button>
							</div>

							{runError && <p role="alert" className="text-xs text-red-700">当前任务状态读取失败，不能确认处理阶段。请刷新查询；不会重发任务。</p>}
							{runData?.mode === "synthetic" && (
								<div
									role="status"
									className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
								>
									<IconAlertTriangle size={15} className="shrink-0" />
									当前查看的是合成演示数据，非真实采集结果。
								</div>
							)}

							{/* 任务状态卡片 */}
							<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">任务执行状态</span>
									<div className="text-sm font-bold capitalize mt-0.5 flex items-center gap-1.5">
										<span
											className={`w-2.5 h-2.5 rounded-full ${
												runData && isDiagnosisInProgress(runData)
													? "bg-blue-500 animate-pulse"
													: runData?.status === "failed" || runData?.status === "interrupted" || ["analysis_failed", "report_render_failed"].includes(runData?.current_step)
														? "bg-red-500"
														: runData?.status === "partial" ? "bg-amber-500" : "bg-green-500"
											}`}
										/>
										{runData ? diagnosisStatusText(runData).title : "加载中..."}
									</div>
								</div>
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">已尝试题数</span>
									<div className="text-sm font-bold mt-0.5">
										{runData ? `${runData.completed_questions} / ${runData.total_questions} 题` : "正在读取"}
									</div>
								</div>
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">有效题数（非请求次数）</span>
									<div className="text-sm font-bold mt-0.5 text-blue-600">
										{runData ? `${runData.valid_questions} 题` : "正在读取"}
									</div>
								</div>
								<div className="border p-3 rounded-lg bg-muted/20">
									<span className="text-xs text-muted-foreground">当前任务来源</span>
									<div
										className={`text-sm font-bold mt-0.5 ${
											runData?.mode === "real"
												? "text-emerald-600 dark:text-emerald-400"
												: "text-muted-foreground"
										}`}
									>
										{runData
											? runData.mode === "real"
												? "真实执行"
												: runData.mode === "synthetic"
													? "合成演示"
													: runData.mode
											: "读取中..."}
									</div>
								</div>
							</div>

							{activeRunId && (evidenceError || metricsError) && <p role="status" className="text-xs text-amber-700">本轮归档或统计暂未同步，相关区域暂不展示；已尝试题数来自当前任务。可刷新查询，不会重新采集。</p>}
							{runData && <>
								<p className="text-xs text-muted-foreground" aria-label="本次诊断计数">{diagnosisCountText(runData)} · 物理请求数：{!evidenceError && evidenceData?.run_id === runData.run_id ? evidenceData.total_requests_used : "归档计数待同步"}</p>
								{!evidenceError && evidenceData?.run_id === activeRunId && evidenceData.formal_questions?.filter((q: any) => q.effective_status !== "effective").map((q: any) => (
									<p key={q.question_code} role="status" className="text-xs text-amber-700">
										[{q.question_code}] {questionObservationMessage(q)}
									</p>
								))}
								<DiagnosisStages stages={diagnosisStages(runData, metricsError ? undefined : metricsData, analysisData, reportData)} />
							</>}

							{/* 失败任务原因与安全恢复说明 (E2-R04) */}
							{runData?.status === "failed" && (
								<div className="bg-red-50/70 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-4 text-xs flex flex-col gap-2">
									<div className="flex items-center gap-1.5 font-bold text-red-700 dark:text-red-300">
										<IconAlertTriangle size={16} />
										<span>诊断任务执行中止 (终态: failed)</span>
									</div>
									<div className="text-red-600 dark:text-red-400">
										<span className="font-semibold">错误分类: </span>
										<span className="font-mono">{runData.error_category || "execution_failed"}</span>
									</div>
									{(collectionError || runData.error_message) && (
										<div className="text-muted-foreground bg-background/60 p-2 rounded border font-mono">
											{collectionError || runData.error_message}
										</div>
									)}
									<div className="text-muted-foreground mt-1">
										💡 <span className="font-semibold text-foreground">安全恢复提示：</span>任务因上述原因已安全中止并进入保护终态，未产生隐式续排或失控计费。快照数据已完整保留，可在排除配置或凭证问题后重新发起单次执行，无需重新创建题库快照。
									</div>
								</div>
							)}

							{/* 客观指标卡片 (A 模块) */}
							{!metricsError && metricsData?.run_id === activeRunId && (
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
												{metricsData.domain_metrics?.own_domain_citation_rate ?? "待核"}
											</div>
											<span className="text-xs text-muted-foreground">
												{metricsData.domain_metrics?.own_domain_citations != null && metricsData.domain_metrics?.total_citations != null
													? `自有引用 ${metricsData.domain_metrics.own_domain_citations} / 总引用 ${metricsData.domain_metrics.total_citations}`
													: "待核"}
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
																<td className="p-2 font-semibold text-blue-600">
																	{bg.effective_mention_rate_text}
																</td>
															</tr>
														))}
													</tbody>
												</table>
											</div>
										</div>
									)}
								</div>
							)}

							{/* 逐题证据明细 (E-R06: 支持完整回答查看与实际引用展示) */}
							{!evidenceError && evidenceData?.run_id === activeRunId && (
								<div className="flex flex-col gap-3 border-t pt-4">
									<div className="text-sm font-semibold flex items-center gap-1.5">
										<IconListCheck size={18} /> 逐题实测证据与引用明细
									</div>

									{/* 正式题列表 */}
									<div className="flex flex-col gap-2">
										<span className="text-xs font-bold text-muted-foreground uppercase">
											核心正式题 ({evidenceData.formal_questions?.length ?? 0})
										</span>
										{evidenceData.formal_questions?.map((q: any) => {
											const isExpanded = !!expandedQuestions[q.question_code];
											return (
												<div
													id={`question-card-${activeRunId}-${q.question_code}`}
													key={q.question_code}
													className="scroll-mt-24 border rounded-lg p-3 text-xs flex flex-col gap-2 bg-muted/10"
												>
													<div className="flex items-center justify-between font-semibold">
														<span className="text-foreground">
															[{q.question_code}] {q.question_text}
														</span>
														<div className="flex items-center gap-2">
															<span className="text-muted-foreground text-[10px] bg-muted px-2 py-0.5 rounded">
																{q.dimension_name}
															</span>
															<button
																id={`question-toggle-btn-${activeRunId}-${q.question_code}`}
																type="button"
																aria-expanded={isExpanded}
																aria-label={isExpanded ? `收起 ${q.question_code} 回答` : `展开 ${q.question_code} 回答`}
																onClick={() =>
																	setExpandedQuestions((prev) => ({
																		...prev,
																		[q.question_code]: !isExpanded,
																	}))
																}
																className="p-1 hover:bg-muted rounded text-muted-foreground"
															>
																{isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
															</button>
														</div>
													</div>

													<div className="text-muted-foreground bg-background p-2.5 rounded border leading-relaxed">
														{q.effective_status !== "effective" && <p className="text-amber-700 mb-2">{questionObservationMessage(q)}</p>}
														<span className="font-semibold text-foreground">{q.effective_status === "in_progress" ? "正在等待本题回答：" : q.effective_status === "effective" ? "💬 模型实测回答：" : "💬 部分内容（如有，未完成／非有效样本）："}</span>
														{isExpanded
															? q.answer_text ? <AnswerMarkdown text={q.answer_text} /> : (q.effective_status === "in_progress" ? "采样进行中，请耐心等待" : "无有效回答")
															: q.answer_text
																? q.answer_text.slice(0, 150) + (q.answer_text.length > 150 ? "..." : "")
																: q.effective_status === "in_progress" ? "采样进行中，请耐心等待" : "无有效回答"}
													</div>

													{/* 实际引用列表展示 (E-R06) */}
													{q.citations?.length > 0 && isExpanded && (
														<div className="bg-muted/40 p-2 rounded text-[11px] flex flex-col gap-1">
															<span className="font-semibold text-muted-foreground">引用来源明细：</span>
															<ul className="list-disc pl-4 space-y-0.5">
																{q.citations.map((c: any, cIdx: number) => (
																	<li key={cIdx} className="break-all">
																		{c.url || c.domain || JSON.stringify(c)}
																	</li>
																))}
															</ul>
														</div>
													)}

													<div className="flex items-center gap-4 text-muted-foreground text-[11px]">
														<span>🔍 检索词记录: {q.search_queries?.join(", ") || "未提供／未知"}</span>
														<span>🔗 引用数: {q.citations?.length ?? 0}</span>
														<span title={`原始 input_tokens：${samplingUsageCount(q.raw_usage?.input_tokens)}；output_tokens（含推理）：${samplingUsageCount(q.raw_usage?.output_tokens)}；其中 output_tokens_details.reasoning_tokens：${samplingUsageCount(q.raw_usage?.output_tokens_details?.reasoning_tokens)}。总用量不等于输出上限，联网多轮聚合用量不能用于精确推算正文截断。`}>
															⚡ 总 Token: {samplingUsageCount(q.raw_usage?.total_tokens)}
														</span>
													</div>

													{isExpanded && (
														<div className="flex justify-end pt-1 border-t border-border/40">
															<button
																type="button"
																onClick={() => handleCollapseQuestion(q.question_code, false)}
																className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium py-1 px-2 hover:bg-muted/50 rounded transition-colors"
															>
																<IconChevronUp size={14} />
																<span>收起回答明细</span>
															</button>
														</div>
													)}
												</div>
											);
										})}
									</div>

									{/* 探针题列表 */}
									{evidenceData.probe_questions?.length > 0 && (
										<div className="flex flex-col gap-2 mt-2">
											<span className="text-xs font-bold text-muted-foreground uppercase">
												主体识别探针 ({evidenceData.probe_questions.length})
											</span>
											{evidenceData.probe_questions.map((q: any) => {
												const isExpanded = !!expandedQuestions[q.question_code];
												return (
													<div
														id={`probe-card-${activeRunId}-${q.question_code}`}
														key={q.question_code}
														className="scroll-mt-24 border rounded-lg p-3 text-xs flex flex-col gap-2 bg-purple-50/20 dark:bg-purple-950/10 border-purple-200 dark:border-purple-800/40"
													>
														<div className="flex items-center justify-between font-semibold text-purple-950 dark:text-purple-200">
															<span>
																[{q.question_code}] {q.question_text}
															</span>
															<div className="flex items-center gap-2">
																<span className="text-[10px] bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-300 px-2 py-0.5 rounded">
																	探针 · {q.dimension_name}
																</span>
																<button
																	id={`probe-toggle-btn-${activeRunId}-${q.question_code}`}
																	type="button"
																	aria-expanded={isExpanded}
																	aria-label={isExpanded ? `收起探针 ${q.question_code} 回答` : `展开探针 ${q.question_code} 回答`}
																	onClick={() =>
																		setExpandedQuestions((prev) => ({
																			...prev,
																			[q.question_code]: !isExpanded,
																		}))
																	}
																	className="p-1 hover:bg-purple-100 dark:hover:bg-purple-900/40 rounded text-purple-700"
																>
																	{isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
																</button>
															</div>
														</div>

														<div className="text-muted-foreground bg-background p-2.5 rounded border leading-relaxed">
															{q.effective_status !== "effective" && <p className="text-amber-700">{questionObservationMessage(q)}</p>}
															<span className="font-semibold text-foreground">💬 探针回答：</span>
															{isExpanded
																? q.answer_text ? <AnswerMarkdown text={q.answer_text} /> : (q.effective_status === "in_progress" ? "采样进行中，请耐心等待" : "无有效回答")
																: q.answer_text
																	? q.answer_text.slice(0, 150) + (q.answer_text.length > 150 ? "..." : "")
																	: q.effective_status === "in_progress" ? "采样进行中，请耐心等待" : "无有效回答"}
														</div>

														{q.citations?.length > 0 && isExpanded && (
															<div className="bg-purple-50/50 dark:bg-purple-950/30 p-2 rounded text-[11px] flex flex-col gap-1">
																<span className="font-semibold text-purple-900 dark:text-purple-300">引用明细：</span>
																<ul className="list-disc pl-4 space-y-0.5">
																	{q.citations.map((c: any, cIdx: number) => (
																		<li key={cIdx} className="break-all">
																			{c.url || c.domain || JSON.stringify(c)}
																		</li>
																	))}
																</ul>
															</div>
														)}

														<div className="flex items-center gap-4 text-muted-foreground text-[11px]">
															<span>🔍 检索词: {q.search_queries?.join(", ") || "无"}</span>
															<span>🔗 引用数: {q.citations?.length ?? 0}</span>
															<span title={`原始 input_tokens：${samplingUsageCount(q.raw_usage?.input_tokens)}；output_tokens（含推理）：${samplingUsageCount(q.raw_usage?.output_tokens)}；其中 output_tokens_details.reasoning_tokens：${samplingUsageCount(q.raw_usage?.output_tokens_details?.reasoning_tokens)}。总用量不等于输出上限，联网多轮聚合用量不能用于精确推算正文截断。`}>
																⚡ 总 Token: {samplingUsageCount(q.raw_usage?.total_tokens)}
															</span>
														</div>

														{isExpanded && (
															<div className="flex justify-end pt-1 border-t border-purple-200/50 dark:border-purple-800/30">
																<button
																	type="button"
																	onClick={() => handleCollapseQuestion(q.question_code, true)}
																	className="inline-flex items-center gap-1 text-xs text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100 font-medium py-1 px-2 hover:bg-purple-100/50 rounded transition-colors"
																>
																	<IconChevronUp size={14} />
																	<span>收起回答明细</span>
																</button>
															</div>
														)}
													</div>
												);
											})}
										</div>
									)}
								</div>
							)}
						</section>
					)}

					{/* 步骤 4: 录入人工成因诊断与优先行动清单 (E-R05: 全部真实输入，严禁预填伪造内容) */}
					{activeRunId && (
						<section ref={analysisPanelRef} aria-label="板块4：诊断分析与恢复" className="scroll-mt-24 border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
							<div className="flex items-center justify-between border-b pb-3">
								<div className="flex items-center gap-2 font-semibold text-base">
									<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
										4
									</span>
									诊断分析草稿与优先行动建议（Negency-Agent 自动生成 · 支持人工复核与修改）
								</div>
								<div className="text-xs text-muted-foreground">
									{hasCurrentAnalysis && activeAnalysisId ? (
										<span className="text-green-600 dark:text-green-400 font-medium inline-flex items-center gap-1">
											<IconCheck size={14} /> 当前分析版本: {activeAnalysisId}
										</span>
									) : analysisForm.phase === "generating" ? (
										"生成完成后可编辑"
									) : (
										"严格绑定本轮运行，递增版本留痕"
									)}
								</div>
							</div>

							{runData?.run_id === activeRunId && (runData.current_step === "analysis_failed" || (retryAnalysisMutation.isPending && retryAnalysisMutation.variables?.runId === activeRunId) || recovery) && (
								<div role="alert" className="border border-red-300 rounded-lg p-3 text-xs space-y-2 bg-red-50/70 dark:bg-red-950/30">
									<p className="font-semibold">Negency-Agent 自动分析与手动恢复</p>
									<p>{retryAnalysisMutation.isPending && retryAnalysisMutation.variables?.runId === activeRunId
										? "本次分析请求正在处理中，请勿重复提交；等待期间可只读查看本任务状态。"
										: recovery?.message ?? diagnosisAnalysisFailureMessage(runData)}</p>
									{runData.current_step === "analysis_failed" && (!recovery || recovery.phase === "failed") && <p className="break-words">{runData.error_message || "分析执行失败，具体原因尚未取得。"}</p>}
									{requestFeedback && recovery?.phase !== "ready" && <p className="break-words">{requestFeedback.message}</p>}
									{recovery && <button type="button" className="underline" onClick={() => { void refetchRun(); void refetchAnalysis(); void refetchReport(); }}>刷新本次请求状态（只读）</button>}
									<p>手动重试仅复用已有豆包采样，不调用 Ark 重采。有可用分析时服务端优先复用；没有可用分析时会重新执行完整分析，可能产生分析费用，不保证成功。不会自动重试。</p>
									<button type="button" onClick={handleRetryAnalysis}
										disabled={retryAnalysisMutation.isPending || runFetching || Boolean(runError || analysisQueryError) || runData.current_step !== "analysis_failed" || Boolean(recovery && !recovery.canRetry)}
										className="bg-red-600 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
										{retryAnalysisMutation.isPending && retryAnalysisMutation.variables?.runId === activeRunId ? "分析请求处理中..." : "重试 Negency-Agent 自动分析"}
									</button>
								</div>
							)}

							<div
								role={analysisForm.phase === "failed" || analysisForm.phase === "unreadable" ? "alert" : "status"}
								aria-live="polite"
								className={`border rounded-lg px-3 py-2 text-xs ${analysisStatusClass}`}
							>
								<div className="flex items-center gap-1.5 font-semibold">
									{analysisForm.phase === "generating" ? (
										<IconRefresh size={15} className="animate-spin" />
									) : analysisForm.phase === "ready" ? (
										<IconCheck size={15} />
									) : analysisForm.phase === "failed" || analysisForm.phase === "unreadable" ? (
										<IconAlertTriangle size={15} />
									) : (
										<IconFileText size={15} />
									)}
									<span>{analysisStatusTitle}</span>
								</div>
								<p className="mt-1 leading-relaxed">{analysisForm.message}</p>
								{analysisForm.warning && <p className="mt-1 font-medium">{analysisForm.warning}</p>}
								{analysisForm.phase === "unreadable" && (
									<button type="button" onClick={() => refetchAnalysis()} className="mt-2 underline">
										刷新分析结果（只读查询）
									</button>
								)}
							</div>

							<fieldset disabled={analysisLocked} className="m-0 min-w-0 border-0 p-0 flex flex-col gap-4">
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">分析师姓名 *</label>
									<input
										type="text"
										placeholder="如: 张分析师"
										value={analystName}
										onChange={(e) => { markAnalysisDirty(); setAnalystName(e.target.value); }}
										className="border rounded-md px-3 py-1.5 bg-background disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">核心执行结论 *</label>
									<textarea
										rows={3}
										placeholder="输入本轮诊断总体结论..."
										value={executiveConclusion}
										onChange={(e) => { markAnalysisDirty(); setExecutiveConclusion(e.target.value); }}
										className="border rounded-md p-2 bg-background font-mono resize-y min-h-[72px] disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground w-full"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">关键发现清单 *（每行一条）</label>
									<textarea
										rows={3}
										placeholder="例如:&#10;核心业务板块提及率偏低&#10;主体探针可准确识别&#10;竞品占位显著"
										value={keyFindings}
										onChange={(e) => { markAnalysisDirty(); setKeyFindings(e.target.value); }}
										className="border rounded-md p-2 bg-background font-mono disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">主体识别审核结论</label>
									<textarea
										rows={3}
										placeholder="主体识别清晰，无同名企业混淆（若未填显示待核）"
										value={brandIdentityAudit}
										onChange={(e) => { markAnalysisDirty(); setBrandIdentityAudit(e.target.value); }}
										className="border rounded-md p-2 bg-background font-mono resize-y min-h-[72px] disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground w-full"
									/>
								</div>
								<div className="flex flex-col gap-1.5 md:col-span-2">
									<label className="font-semibold">内容资产缺口分析</label>
									<textarea
										rows={3}
										placeholder="输入官方公开内容资产或索引缺口..."
										value={contentGapsInput}
										onChange={(e) => { markAnalysisDirty(); setContentGapsInput(e.target.value); }}
										className="border rounded-md p-2 bg-background font-mono resize-y min-h-[72px] disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground w-full"
									/>
								</div>
								<div className="flex flex-col gap-3 md:col-span-2">
									<div className="flex items-center justify-between">
										<label className="font-semibold text-foreground">
											优先行动建议清单 *
										</label>
										<span className="text-xs text-muted-foreground font-normal">
											共 {actionItems.length} 条建议
										</span>
									</div>
									<p className="text-muted-foreground text-xs">
										每条建议独立编号并分开编辑。缺少具体行动或证据引用的项保持未就绪草稿，不可批准交付；题码存在不等于语义依据充分，仍须人工审核原文。
									</p>
									{autoActionFilter && autoActionFilter.runId === activeRunId && (autoActionFilter.filteredCount > 0 || (autoEvidenceAudit?.runId === activeRunId && autoEvidenceAudit.state !== "pending")) && (
										<p role="status" className="text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 text-xs">
											{autoActionFilter.filteredCount > 0 && (
												<span className="block">
													已过滤 {autoActionFilter.filteredCount} 条无题目依据的自动建议（原分析记录保持不变）。以下为 AI 自动建议，尚未人工核实；依据资料不足的项按“尚未核实”处理，需人工逐条核对原文。
												</span>
											)}
											{autoEvidenceAudit?.runId === activeRunId && autoEvidenceAudit.state === "done" && (
												<span className="block font-semibold">
													历史自动建议依据核验完成：剔除 {autoEvidenceAudit.unsupported} 条（题码/引文/来源与本次证据不匹配），另有 {autoEvidenceAudit.unverified} 条资料不足已标记“尚未核实”并保留。
												</span>
											)}
											{autoEvidenceAudit?.runId === activeRunId && autoEvidenceAudit.state === "failed" && (
												<span className="block font-semibold">
													历史自动建议依据核验暂时不可用：已保留全部自动建议并标记“尚未核实”（未删除任何项），请人工逐条核对原文后再保存。
												</span>
											)}
										</p>
									)}
									{actionError && (
										<div role="alert" className="p-3 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded-md border border-red-200 dark:border-red-800 text-xs">
											<p className="font-semibold">
												{actionError.startsWith("生成报告修订失败") ? "报告修订装配提示：" : "行动建议格式解析异常："}
											</p>
											<p>{actionError}</p>
											{actionError.startsWith("生成报告修订失败") && (
												<p className="mt-1 text-muted-foreground text-[11px]">
													注：人工分析表单（含行动建议清单）已成功保存入库；上述信息属于自动装配报告修订阶段的后端门禁/环境反馈。
												</p>
											)}
										</div>
									)}
									{actionItems.length === 0 ? (
										<div className="text-center p-6 border border-dashed rounded-lg text-muted-foreground text-xs space-y-2">
											<p>暂无有依据的行动建议（可保存为未就绪草稿，正式交付仍会被“缺少有效行动建议”门禁拦截）。</p>
											<p>点击下方“添加一条行动建议”，人工补充带题目依据的行动。</p>
										</div>
									) : (
										<div className="flex flex-col gap-4">
											{actionItems.map((item, index) => {
												const isEvidenceExpanded = !!expandedActionEvidences[index];
												const actionNumber = String(index + 1).padStart(2, "0");
												const hasRefs = Boolean(item.evidence_refs && item.evidence_refs.length > 0);
												return (
													<div
														key={index}
														id={`action-card-${activeRunId}-${index}`}
														className="scroll-mt-24 border rounded-xl p-4 bg-muted/10 flex flex-col gap-3 border-border/80 shadow-xs"
													>
														{/* 卡片顶栏：编号、优先级、关联题码摘要、移除按钮 */}
														<div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
															<div className="flex items-center gap-2 flex-wrap">
																<span className="px-2 py-0.5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/20">
																	建议 {actionNumber}
																</span>
																<div className="flex items-center gap-1 text-xs">
																	<span className="text-muted-foreground">优先级:</span>
																	<select
																		value={item.priority || "P1"}
																		onChange={(e) => handleUpdateActionField(index, "priority", e.target.value)}
																		className="border rounded px-1.5 py-0.5 bg-background text-xs font-semibold"
																		aria-label={`建议 ${actionNumber} 优先级`}
																	>
																		<option value="P0">P0（最高）</option>
																		<option value="P1">P1（高）</option>
																		<option value="P2">P2（中）</option>
																		<option value="P3">P3（低）</option>
																	</select>
																</div>
																<span className={`text-[11px] px-2 py-0.5 rounded ${hasRefs ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}>
																	{hasRefs ? `关联题码: ${item.evidence_refs?.join(", ")}` : "尚未关联题目依据"}
																</span>
																{item.audit_status === "unverified" && (
																	<span className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 font-semibold">
																		尚未核实
																	</span>
																)}
															</div>
															<button
																type="button"
																onClick={() => handleRemoveAction(index)}
																className="inline-flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 font-medium px-2 py-1 hover:bg-destructive/10 rounded transition-colors"
																aria-label={`移除建议 ${actionNumber}`}
															>
																<IconTrash size={14} />
																<span>移除建议</span>
															</button>
														</div>

														{/* 表单字段编辑 */}
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
															<div className="flex flex-col gap-1 md:col-span-2">
																<label className="font-semibold text-foreground">建议行动 *</label>
																<textarea
																	rows={2}
																	placeholder="例如: 在海外官网增设标杆案例专页，强化技术细节与测评..."
																	value={item.action ?? ""}
																	onChange={(e) => handleUpdateActionField(index, "action", e.target.value)}
																	className="border rounded-md p-2 bg-background font-sans resize-y min-h-[48px] w-full disabled:cursor-not-allowed disabled:bg-muted/50"
																/>
															</div>
															<div className="flex flex-col gap-1 md:col-span-2">
																<label className="font-semibold text-foreground">决策依据 / 优先级说明</label>
																<textarea
																	rows={2}
																	placeholder="说明为何定为该优先级及具体决策考量..."
																	value={item.priority_rationale ?? ""}
																	onChange={(e) => handleUpdateActionField(index, "priority_rationale", e.target.value)}
																	className="border rounded-md p-2 bg-background font-sans resize-y min-h-[48px] w-full disabled:cursor-not-allowed disabled:bg-muted/50"
																/>
															</div>
															<div className="flex flex-col gap-1">
																<label className="font-semibold text-foreground">预期交付物</label>
																<input
																	type="text"
																	placeholder="如: 官方技术专题页面、白皮书..."
																	value={item.deliverable ?? ""}
																	onChange={(e) => handleUpdateActionField(index, "deliverable", e.target.value)}
																	className="border rounded-md px-2.5 py-1.5 bg-background w-full disabled:cursor-not-allowed disabled:bg-muted/50"
																/>
															</div>
															<div className="flex flex-col gap-1">
																<label className="font-semibold text-foreground">验证方式</label>
																<input
																	type="text"
																	placeholder="如: 次月首周复测、特定提示词检索..."
																	value={item.verification_method ?? ""}
																	onChange={(e) => handleUpdateActionField(index, "verification_method", e.target.value)}
																	className="border rounded-md px-2.5 py-1.5 bg-background w-full disabled:cursor-not-allowed disabled:bg-muted/50"
																/>
															</div>
															<div className="flex flex-col gap-1 md:col-span-2">
																<label className="font-semibold text-foreground">实测发现</label>
																<textarea
																	rows={2}
																	placeholder="实测中观察到的具体现象或短板..."
																	value={item.finding ?? ""}
																	onChange={(e) => handleUpdateActionField(index, "finding", e.target.value)}
																	className="border rounded-md p-2 bg-background font-sans resize-y min-h-[48px] w-full disabled:cursor-not-allowed disabled:bg-muted/50"
																/>
															</div>
														</div>

														{/* 依据展开区（Task D） */}
														<div className="mt-1 flex flex-col">
															<button
																type="button"
																id={`action-evidence-toggle-${activeRunId}-${index}`}
																aria-expanded={isEvidenceExpanded}
																onClick={() => setExpandedActionEvidences((prev) => ({ ...prev, [index]: !isEvidenceExpanded }))}
																className={`flex items-center justify-between p-2.5 text-xs font-semibold rounded-t border transition-colors ${
																	isEvidenceExpanded ? "bg-muted/60 border-b-0" : "bg-muted/30 hover:bg-muted/50 rounded-b"
																}`}
															>
																<span className="text-foreground text-left">
																	建议 {actionNumber} 依据：{item.action?.trim() || "（尚未填写具体行动）"}
																	<span className="font-normal text-muted-foreground ml-1.5">
																		(已关联 {item.evidence_refs?.length ?? 0} 道题)
																		{!hasRefs && "（尚未关联支持此建议的题目依据）"}
																	</span>
																</span>
																<span className="text-muted-foreground ml-2 shrink-0">
																	{isEvidenceExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
																</span>
															</button>
															{isEvidenceExpanded && (
																<div className="border border-t-0 rounded-b p-3 bg-background border-l-4 border-l-primary/60 flex flex-col gap-2.5 text-xs shadow-inner">
																	<p className="text-muted-foreground text-[11px] leading-relaxed">
																		仅选择确实支持此建议的原文。未完成题只支持采样局限；关联题码不代表已经通过语义审核。
																	</p>
																	{!item.action?.trim() && (
																		<p role="status" className="text-amber-700 dark:text-amber-300 text-[11px]">
																			本条建议尚未填写具体举措。
																		</p>
																	)}
																	{evidenceQuestions.length === 0 ? (
																		<p role="status" className="text-muted-foreground text-xs py-2">
																			当前题目依据未读取到，请先只读刷新结果。
																		</p>
																	) : (
																		<div className="flex flex-col gap-2 max-h-[360px] overflow-y-auto pr-1">
																			{evidenceQuestions.map((q) => (
																				<label key={q.question_code} className="block border-t border-border/50 pt-2 pb-1 hover:bg-muted/20 px-1 rounded transition-colors cursor-pointer">
																					<div className="flex items-center gap-2 mb-1">
																						<input
																							type="checkbox"
																							aria-label={`建议${actionNumber}关联${q.question_code}`}
																							checked={item.evidence_refs?.includes(q.question_code) ?? false}
																							onChange={(e) => updateActionRefs(index, q.question_code, e.target.checked)}
																							className="rounded text-primary focus:ring-primary"
																						/>
																						<span className="font-semibold text-foreground">[{q.question_code}] {q.question_text}</span>
																						<span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{q.dimension_name}</span>
																					</div>
																					<div className="pl-6 text-muted-foreground text-[11px]">
																						{q.effective_status === "effective" && q.answer_text ? (
																							<AnswerMarkdown text={q.answer_text} />
																						) : (
																							<p className="whitespace-pre-wrap">{questionObservationMessage(q)}</p>
																						)}
																					</div>
																				</label>
																			))}
																		</div>
																	)}
																	<div className="flex justify-end pt-2 border-t border-border/40">
																		<button
																			type="button"
																			id={`action-collapse-bottom-${activeRunId}-${index}`}
																			onClick={() => handleCollapseActionEvidence(index)}
																			className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium py-1 px-2 hover:bg-muted/50 rounded transition-colors"
																		>
																			<IconChevronUp size={14} />
																			<span>收起本条建议依据</span>
																		</button>
																	</div>
																</div>
															)}
														</div>
													</div>
												);
											})}
										</div>
									)}
									<div>
										<button
											type="button"
											onClick={handleAddAction}
											className="inline-flex items-center gap-1.5 border border-dashed border-primary/50 text-primary hover:bg-primary/5 rounded-lg py-2 px-3 text-xs font-semibold transition-colors"
										>
											<IconPlus size={15} />
											<span>添加一条行动建议</span>
										</button>
									</div>
								</div>
							</div>

							<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
								<div className="text-xs text-muted-foreground">
									{activeSaveWorkflowPhase === "saving"
										? "正在保存本轮分析…"
										: activeSaveWorkflowPhase === "assembling"
											? "分析已保存，正在自动装配一次报告修订…"
											: foreignSaveWorkflowBusy
												? "另一任务的保存/装配仍在进行，完成前暂不可提交本任务。"
												: autoAuditPending
													? "正在核验历史自动建议的依据（逐条比对本次原文），完成前不可保存，避免未核验项混入新产物。"
													: !analysisForm.editable
														? "当前阶段不可编辑或保存。"
														: "保存后会自动装配一次新报告修订，不调用模型。"}
								</div>
								<button
									type="button"
									onClick={handleSaveAnalysis}
									disabled={
										saveWorkflowBusy ||
										autoAuditPending ||
										!analysisForm.editable ||
										!analystName.trim() ||
										!executiveConclusion.trim() ||
										!keyFindings.trim()
									}
									className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-blue-700 transition-colors disabled:opacity-50 self-end sm:self-auto"
								>
									<IconDeviceFloppy size={15} />
									{activeSaveWorkflowPhase === "saving"
										? "保存分析中..."
										: activeSaveWorkflowPhase === "assembling"
											? "正在装配新报告..."
											: "保存分析并装配新报告（不调用模型）"}
								</button>
							</div>
							</fieldset>
						</section>
					)}

					{/* 步骤 5: 生成报告修订、审核与受控下载 (E-R06: 支持 rev_02 递增，不撞 rev_01；支持历史修订查看与下载) */}
					{activeRunId && (diagnosisTaskSection(runData) === 5 || activeAnalysisId || (reportData?.revisions && reportData.revisions.length > 0)) && (
						<section ref={reportPanelRef} aria-label="板块5：报告修订与审核" className="scroll-mt-24 border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-5">
							<div className="flex items-center justify-between border-b pb-3">
								<div className="flex items-center gap-2 font-semibold text-base">
									<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
										5
									</span>
									生成报告修订、审核门禁与受控下载
								</div>
								<div className="text-xs text-muted-foreground">
									当前产物修订号: <span className="font-mono font-bold text-foreground">{activeRevisionId || "待生成"}</span>
								</div>
							</div>

							{/* 已有修订版本切换 (E2-R04: 支持已有历史版本选择与受控下载，无需重新生成) */}
							{runData?.current_step === "report_render_failed" && (
								<div role="alert" className="border border-red-300 rounded-lg p-3 text-xs space-y-2">
									<p className="font-semibold">报告草稿渲染失败</p>
									<p>{runData.error_message || "渲染失败"}</p>
									<p>复用已保存分析重新生成 PDF/HTML，不重复调用模型。</p>
									{runData.error_category === "report_content_invalid" && <button type="button" className="underline" onClick={() => analysisPanelRef.current?.scrollIntoView({ behavior: "instant", block: "start" })}>在板块4核对分析内容与题目依据，修正后保存</button>}
									<button type="button" onClick={() => generateRevisionMutation.mutate({ revisionId: revisionInput, origin: "retry", runId: activeRunId })}
										disabled={saveWorkflowBusy || !activeAnalysisId}
										className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
										{generateRevisionMutation.isPending && generateRevisionMutation.variables?.origin === "retry" ? "渲染中..." : "重试报告草稿生成"}
									</button>
								</div>
							)}
							{reportData?.revisions && reportData.revisions.length > 0 && (
								<div className="flex items-center gap-2 flex-wrap text-xs bg-muted/20 p-3 rounded-lg border">
									<span className="font-semibold text-muted-foreground shrink-0">已生成修订版本:</span>
									<div className="flex items-center gap-1.5 flex-wrap">
										{reportData.revisions.map((rev: any) => {
											const isSelected = activeRevisionId === rev.revision_id;
											const isDeleted = Boolean(rev.deleted_at);
											return (
												<button
													key={rev.revision_id}
													type="button"
													onClick={() => setActiveRevisionId(rev.revision_id)}
														disabled={reviewMutation.isPending || isDeleted || deleteMutation.isPending}
													title={isDeleted ? "该修订已删除（编号保留不复用）" : undefined}
													aria-disabled={isDeleted}
													className={`px-3 py-1 rounded-md font-mono text-xs font-semibold transition-colors flex items-center gap-1.5 ${
														isDeleted
															? "bg-muted/40 border border-dashed text-muted-foreground line-through cursor-not-allowed"
															: isSelected
																? "bg-indigo-600 text-white shadow-sm"
																: "bg-background border text-foreground hover:bg-muted"
													}`}
												>
													<span>{rev.revision_id}</span>
													<span className="text-[10px] opacity-80">
														({isDeleted ? "已删除" : rev.review_status === "approved" ? "已批准" : rev.review_status === "rejected" ? "已退回" : "草稿"})
													</span>
												</button>
											);
										})}
									</div>
								</div>
							)}

							{/* 生成操作 */}
							<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/30 p-3 rounded-lg text-xs">
								<div className="flex flex-col gap-1">
									<div className="font-semibold">装配不可变修订版本</div>
									<div className="text-muted-foreground">
										将已有采集归档与当前人工分析版本装配，同版渲染导出 JSON, HTML, PDF 清单
										{activeSaveWorkflowPhase !== "idle" && (
											<div role="status" className="text-blue-700 dark:text-blue-300">
												正在处理当前保存操作，暂不可另行生成修订。
											</div>
										)}
										{foreignSaveWorkflowBusy && (
											<div role="status" className="text-blue-700 dark:text-blue-300">
												另一任务的保存/装配仍在进行，完成前暂不可生成修订。
											</div>
										)}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<input
										type="text"
										value={revisionInput}
										onChange={(e) => setRevisionInput(e.target.value)} disabled={saveWorkflowBusy}
										placeholder="rev_01"
										className="border rounded px-2.5 py-1.5 w-24 bg-background font-mono text-xs disabled:bg-muted/50 disabled:text-muted-foreground"
									/>
									<button
										onClick={() => generateRevisionMutation.mutate({ revisionId: revisionInput, origin: "manual", runId: activeRunId })}
										disabled={saveWorkflowBusy || !activeAnalysisId || !revisionInput.trim()}
										className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-indigo-700 transition-colors disabled:opacity-50 shrink-0"
									>
										<IconFileText size={15} />
										{generateRevisionMutation.isPending && generateRevisionMutation.variables?.origin !== "auto"
											? "装配渲染中..."
											: `生成修订 (${revisionInput})`}
									</button>
								</div>
							</div>

							{/* 审核与受控下载操作区 */}
							{activeRevisionId && (
								<div className="flex flex-col gap-4 border-t pt-4">
									<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-muted/40 p-4 rounded-xl">
										<div>
											<span className="font-bold text-sm">报告审核与交付门禁</span>
											<p className="text-xs text-muted-foreground mt-1">
												合成演示报告不可批准为正式客户件；仅 Admin/Owner 可审核。批准会执行既有来源、权限、产物与修订门禁，结果在本区域直接显示。
												{reviewBlockedReason && (
													<span className="block mt-1 font-semibold text-amber-700 dark:text-amber-300">
														{reviewBlockedReason}
													</span>
												)}
											</p>
										</div>
										<fieldset disabled={Boolean(reviewBlockedReason)} className="m-0 min-w-0 border-0 p-0 flex items-center gap-2 shrink-0">
											<button
												onClick={() =>
													reviewMutation.mutate({
														action: "reject",
														reason: "合成测试数据不具备正式客户交付资格，已退回归档", revisionId: activeRevisionId,
														runId: activeRunId,
													})
												}
												disabled={reviewMutation.isPending}
												className="px-3 py-1.5 border border-amber-400 text-amber-700 dark:text-amber-300 rounded-md text-xs font-semibold hover:bg-amber-100/50 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												退回草稿归档
											</button>
											<button
												onClick={() =>
													reviewMutation.mutate({
														action: "approve",
														reason: "尝试正式批准交付", revisionId: activeRevisionId,
														runId: activeRunId,
													})
												}
												disabled={reviewMutation.isPending}
												className="px-3 py-1.5 bg-green-600 text-white rounded-md text-xs font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
											>
												批准正式交付（门禁校验）
											</button>
										</fieldset>
									</div>

									{reviewMutation.isPending && reviewMutation.variables?.runId === activeRunId && (
										<div
											role="status"
											aria-live="polite"
											className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 flex items-center gap-2"
										>
											<IconRefresh size={14} className="animate-spin shrink-0" />
											正在提交 {reviewMutation.variables?.revisionId} 的
											{reviewMutation.variables?.action === "approve" ? "批准" : "退回"}审核，请稍候…
										</div>
									)}
									{!reviewMutation.isPending &&
										reviewFeedback &&
										reviewFeedback.runId === activeRunId &&
										reviewFeedback.revisionId === activeRevisionId && (
											<div
												role={reviewFeedback.tone === "error" ? "alert" : "status"}
												aria-live="polite"
												className={`text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${
													reviewFeedback.tone === "error"
														? "text-red-700 dark:text-red-300 bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
														: "text-green-700 dark:text-green-300 bg-green-50/70 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
												}`}
											>
												{reviewFeedback.tone === "error" ? (
													<IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
												) : (
													<IconCheck size={14} className="mt-0.5 shrink-0" />
												)}
												<span className="flex-1">{reviewFeedback.message}</span>
												<button
													type="button"
													onClick={() => setReviewFeedback(null)}
													className="shrink-0 hover:underline"
												>
													关闭
												</button>
											</div>
										)}

									{/* 草稿/已退回修订受控删除 (B18-CORE)：仅 Owner/Admin + draft/rejected + 非渲染中；服务端同事务独立校验 */}
									{canDeleteRevisions && (
									<>
									<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 border border-red-200 dark:border-red-800 rounded-xl p-4 bg-red-50/30 dark:bg-red-950/10">
										<div className="text-xs">
											<span className="font-bold text-destructive">删除此修订</span>
											<p className="text-muted-foreground mt-1">
												仅 Owner/Admin 可删除当前 run/report/revision 下明确为草稿或已退回、且不在渲染中的修订；已批准或曾批准的正式历史不可删除。删除采用逻辑删除：从列表移除且原入口（下载/审核/再生成）不可复用，编号保留不复用，产物文件与审计记录保留。
												{!activeRevisionDeletable && activeRevision && !activeRevision.deleted_at && (
													<span className="block mt-1 font-semibold text-amber-700 dark:text-amber-300">
														当前修订 {activeRevisionId} 审核状态为 {activeRevision.review_status || "未知"}、状态 {revisionStatusLabel(activeRevision.status)}，不满足删除条件。
													</span>
												)}
											</p>
										</div>
										<button
											type="button"
											onClick={() => setDeleteConfirm({ runId: activeRunId, revisionId: activeRevisionId })}
											disabled={!activeRevisionDeletable || deleteMutation.isPending || Boolean(deleteConfirm)}
											className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 rounded-md text-xs font-semibold hover:bg-red-100/60 dark:hover:bg-red-900/40 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
										>
											<IconTrash size={14} />
											删除此修订
										</button>
									</div>
									{deleteConfirm && deleteConfirm.runId === activeRunId && deleteConfirm.revisionId === activeRevisionId && (
										<div role="alertdialog" aria-label="删除修订二次确认" className="text-xs border border-red-300 dark:border-red-700 bg-red-50/70 dark:bg-red-950/30 rounded-xl p-4 flex flex-col gap-3">
											<div className="font-semibold text-red-700 dark:text-red-300">
												确认删除修订 {deleteConfirm.revisionId}（{activeRevision?.review_status === "rejected" ? "已退回" : "草稿"}）？
											</div>
											<ul className="list-disc pl-5 text-muted-foreground space-y-1">
												<li>仅作用于当前品牌/任务/报告的该修订，不影响其他修订、采样、分析与报告父记录。</li>
												<li>删除后从修订列表移除，旧下载/审核/生成入口不可继续使用；rev_ 编号保留不复用，下一修订按含删除历史的最大序号分配。</li>
												<li>产物文件与审计记录保留（逻辑删除）；取消不产生任何写入。</li>
											</ul>
											<div className="flex items-center gap-2 justify-end">
												<button
													type="button"
													onClick={() => setDeleteConfirm(null)}
													className="px-3 py-1.5 border rounded-md text-xs font-semibold hover:bg-muted/60"
												>
													取消（不删除）
												</button>
												<button
													type="button"
													onClick={() => deleteMutation.mutate({ runId: deleteConfirm.runId, revisionId: deleteConfirm.revisionId, reason: "人工删除草稿/已退回修订" })}
													disabled={deleteMutation.isPending}
													className="px-3 py-1.5 bg-red-600 text-white rounded-md text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
												>
													{deleteMutation.isPending ? "删除提交中..." : "确认删除"}
												</button>
											</div>
										</div>
									)}
									</>
									)}
									{deleteMutation.isPending && deleteMutation.variables?.runId === activeRunId && (
										<div role="status" aria-live="polite" className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 flex items-center gap-2">
											<IconRefresh size={14} className="animate-spin shrink-0" />
											正在删除 {deleteMutation.variables?.revisionId}，请稍候…
										</div>
									)}

									{/* 受控下载通道 */}
									<div className="flex flex-col gap-2">
										<span className="text-xs font-bold text-muted-foreground uppercase">
											受控下载通道（仅可下载已就绪的本轮产物）
										</span>
										{!downloadsReady && (
											<div role="status" className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
												{activeRevision
													? `当前修订 ${activeRevisionId} 状态为 ${revisionStatusLabel(activeRevision.status)}，产物未就绪，暂不可下载。`
													: `当前修订 ${activeRevisionId} 尚未生成产物，暂不可下载。`}
											</div>
										)}
										{downloadError && (
											<div role="alert" className="text-xs text-red-700 dark:text-red-300 bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
												<span>{downloadError}</span>
												<button type="button" onClick={() => setDownloadError(null)} className="shrink-0 hover:underline">关闭</button>
											</div>
										)}
										<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
											<button
												type="button"
												onClick={() => downloadMutation.mutate("pdf")}
												disabled={!downloadsReady || downloadMutation.isPending}
												className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-100/60 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
											>
												<IconDownload size={16} /> {downloadMutation.isPending && downloadMutation.variables === "pdf" ? "PDF 下载中..." : "下载受控 PDF 报告"}
											</button>
											<button
												type="button"
												onClick={() => downloadMutation.mutate("html")}
												disabled={!downloadsReady || downloadMutation.isPending}
												className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-emerald-50/50 dark:bg-emerald-950/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
											>
												<IconDownload size={16} /> {downloadMutation.isPending && downloadMutation.variables === "html" ? "HTML 下载中..." : "下载受控 HTML 报告"}
											</button>
											<button
												type="button"
												onClick={() => downloadMutation.mutate("json")}
												disabled={!downloadsReady || downloadMutation.isPending}
												className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-purple-50/50 dark:bg-purple-950/20 hover:bg-purple-100/60 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
											>
												<IconDownload size={16} /> {downloadMutation.isPending && downloadMutation.variables === "json" ? "JSON 下载中..." : "下载受控 JSON 契约"}
											</button>
										</div>
									</div>
								</div>
							)}
							{/* 删除结果反馈放在 activeRevisionId 条件外：删除最后一项后当前修订清空，反馈仍须可见 (B18-CORE) */}
							{!deleteMutation.isPending &&
								deleteFeedback &&
								deleteFeedback.runId === activeRunId && (
									<div
										role={deleteFeedback.tone === "error" ? "alert" : "status"}
										aria-live="polite"
										className={`text-xs rounded-lg px-3 py-2 flex items-start gap-2 ${
											deleteFeedback.tone === "error"
												? "text-red-700 dark:text-red-300 bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
												: "text-green-700 dark:text-green-300 bg-green-50/70 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
										}`}
									>
										{deleteFeedback.tone === "error" ? (
											<IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
										) : (
											<IconCheck size={14} className="mt-0.5 shrink-0" />
										)}
										<span className="flex-1">{deleteFeedback.message}</span>
										<button
											type="button"
											onClick={() => setDeleteFeedback(null)}
											className="shrink-0 hover:underline"
										>
											关闭
										</button>
									</div>
								)}
						</section>
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
								<div
									key={r.file}
									className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-3"
								>
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
											{r.meta.startDate && r.meta.endDate
												? `${r.meta.startDate} ~ ${r.meta.endDate}`
												: "—"}
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
