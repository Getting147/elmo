import { useState, useEffect, useRef } from "react";
import { INVALID_REPORT_TASK_LINK, validateReportSearch } from "@/lib/baseline-report-search";
import { useAuth } from "@/hooks/use-auth";
import { DiagnosisDimensionInput } from "@/components/diagnosis-dimension-input";
import { DefaultErrorComponent } from "@/router-default-components";
import { useDiagnosisDraft } from "@/hooks/use-diagnosis-draft";
import { DiagnosisStages } from "@/components/diagnosis-stages";
import { diagnosisStages } from "@/lib/baseline-stages";
import { diagnosisCountText, diagnosisStatusText, isDiagnosisInProgress } from "@/lib/baseline-status";
import { createFileRoute, Link, type ErrorComponentProps } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
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
	listBaselineRunsFn,
	getBaselineAnalysisFn,
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

function BrandReportsPage() {
	const { brand } = Route.useParams();
	return <BrandReportsWorkspace key={brand} />;
}

function BrandReportsWorkspace() {
	const { brand: brandId } = Route.useParams();
	const { runId: requestedRunId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { brand } = useBrand(brandId);
	const isZh = typeof navigator !== "undefined" ? navigator.language?.startsWith("zh") : true;

	// 顶栏 Tab: portal (诊断工作台) vs legacy (历史报告)
	const [activeTab, setActiveTab] = useState<"portal" | "legacy">("portal");

	// 工作台状态机
	const [activeRunId, setActiveRunId] = useState<string>("");
	const [activeAnalysisId, setActiveAnalysisId] = useState<string>("");
	const [activeRevisionId, setActiveRevisionId] = useState<string>("rev_01");
	const [revisionInput, setRevisionInput] = useState<string>("rev_01");
	const [reviewNotice, setReviewNotice] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	// 题库分类人工补齐状态 (E-R04)

	// 逐题回答展开状态 (E-R06)
	const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});

	// 人工分析表单状态 (E-R05: 移除一切预填伪造数据，全部默认空或显式占位)
	const [analystName, setAnalystName] = useState<string>("");
	const [executiveConclusion, setExecutiveConclusion] = useState<string>("");
	const [keyFindings, setKeyFindings] = useState<string>("");
	const [rawBrandIdentityAudit, setRawBrandIdentityAudit] = useState<any>(null);
	const [brandIdentityAudit, setBrandIdentityAudit] = useState<string>("");
	const [contentGapsInput, setContentGapsInput] = useState<string>("");
	const [actionPlanInput, setActionPlanInput] = useState<string>("");
	const [rawActionPlan, setRawActionPlan] = useState<any[]>([]);

	const brandName = brand?.name || brandId || "";

	// 1. 获取品牌档案与题集配置
	const {
		data: profileData,
		isLoading: profileLoading,
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
	useEffect(() => { if (draft.runId && !requestedRunId) handleSelectRun(draft.runId); }, [draft.runId]);
	useEffect(() => { if (requestedRunId) handleSelectRun(requestedRunId); }, [requestedRunId]);

	// 2. 查询最近任务列表 (E-R06)
	const {
		data: runsListData,
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
	} = useQuery({
		queryKey: ["baseline-run", brandId, activeRunId],
		queryFn: () => getBaselineRunFn({ data: { brandId: brandId!, runId: activeRunId } }),
		enabled: !!brandId && !!activeRunId,
		refetchInterval: (query) => query.state.data && isDiagnosisInProgress(query.state.data) ? 2000 : false,
	});

	// 4. 查询当前 run 的逐题证据
	const { data: evidenceData, error: evidenceError, refetch: refetchEvidence } = useQuery({
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
	const { data: metricsData, error: metricsError, refetch: refetchMetrics } = useQuery({
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

	// 恢复服务端持久化的人工分析 (E2-R04)
	useEffect(() => {
		if (analysisData?.run_id === activeRunId) {
			setActiveAnalysisId(analysisData.analysis_id || "");
			setAnalystName(analysisData.analyst_name || "");
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
				setRawActionPlan(analysisData.payload.action_plan);
				setActionPlanInput(
					analysisData.payload.action_plan
						.map((ap: any) => {
							const promptCode =
								Array.isArray(ap.evidence_refs) && ap.evidence_refs.length > 0
									? ap.evidence_refs.join(", ")
									: typeof ap.evidence_refs === "string"
										? ap.evidence_refs
										: "";
							const action = ap.action || "";
							const priority = ap.priority || "P2";
							const rationale = ap.priority_rationale || "";
							const deliverable = ap.deliverable || "";
							const verification = ap.verification_method || "";
							return `${promptCode} | ${action} | ${priority} | ${rationale} | ${deliverable} | ${verification}`;
						})
						.join("\n"),
				);
			}
		}
	}, [analysisData, activeRunId]);

	// 恢复报告修订版本列表及建议下一修订编号 (E2-R04 / E3-R04: 避免旧 reportData effect 覆盖刚生成或明确选择的新修订)
	useEffect(() => {
		if (reportData?.run_id === activeRunId && reportData.revisions?.length > 0) {
			const revs = reportData.revisions;
			const latestRev = revs[revs.length - 1];
			setActiveRevisionId((current) => {
				if (!current || !revs.some((r: any) => r.revision_id === current)) {
					return latestRev.revision_id;
				}
				return current;
			});
			const nextNum = revs.length + 1;
			setRevisionInput(`rev_${nextNum < 10 ? `0${nextNum}` : nextNum}`);
		}
	}, [reportData, activeRunId]);

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

	// 切换 run 时的彻底清理与新 run 恢复 (E2-R04)
	const handleSelectRun = (runId: string) => {
		setActiveRunId(runId);
		// 切换 run 时清空所有表单项，防止旧任务数据串入新任务
		setActiveAnalysisId("");
		setAnalystName("");
		setExecutiveConclusion("");
		setKeyFindings("");
		setRawBrandIdentityAudit(null);
		setBrandIdentityAudit("");
		setContentGapsInput("");
		setActionPlanInput("");
		setRawActionPlan([]);
		setActiveRevisionId("rev_01");
		setRevisionInput("rev_01");
		setActionError(null);
		setReviewNotice(null);
	};

	// Restore the persisted task when returning from overview or reloading; never create work on mount.
	useEffect(() => {
		if (!activeRunId && !requestedRunId && runsListData?.items?.[0]?.run_id) handleSelectRun(draft.runId ?? runsListData.items[0].run_id);
	}, [runsListData, activeRunId]);

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
			await registerBaselineServerAuthFn({ data: { brandId, snapshotId: current.snapshot.snapshot_id, runId, snapshotHash: current.snapshot.content_sha256, requestLimit: current.snapshot.question_count, retryLimit: 0 } });
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
			const parameters = current.parameters ?? { modelName: activeAuth?.model_name, webSearch: activeAuth?.web_search === undefined ? undefined : Boolean(activeAuth.web_search) };
			const prepared = { ...current, runId, parameters };
			// Keep the same request identity if its response is lost or another tab repeats the action.
			save(prepared);
			const result = await createBaselineRunFn({ data: {
				brandId, snapshotId: current.snapshot.snapshot_id, mode: current.mode, runId,
				idempotencyKey: `idemp_${runId}`, requestBudget: current.snapshot.question_count, maxRetries: 0,
				...parameters,
			} });
			return { ...prepared, runId: result.run_id, submitted: true };
		}),
		onSuccess: (current) => { if (current.runId) { handleSelectRun(current.runId); void navigate({ search: { runId: current.runId }, replace: true }); } refetchRunsList(); },
		onError: (err: Error) => setActionError(`本次任务未确认启动：${err.message}。请查看本次任务；重复提交仍使用同一任务身份。`),
	});
	const preparationBusy = freezeMutation.isPending || authorizeMutation.isPending || createRunMutation.isPending;

	const retryAnalysisMutation = useMutation({
		mutationFn: () =>
			retryBaselineAnalysisFn({
				data: {
					brandId: brandId!,
					runId: activeRunId,
				},
			}),
		onSuccess: () => {
			setActionError(null);
			refetchRun();
			refetchAnalysis();
			refetchReport();
		},
		onError: (err: any) => setActionError(`重试 AI 自动分析失败: ${err.message}`),
	});

	const saveAnalysisMutation = useMutation({
		mutationFn: () => {
			const lines = actionPlanInput.split("\n").filter((l) => l.trim().length > 0);
			if (lines.length === 0) {
				throw new Error("请至少录入一条行动建议，格式：题码 | 建议行动 | 优先级(P0/P1/P2) | 决策依据 | 交付物 | 验证方式");
			}

			const actionPlan = lines.map((line, idx) => {
				const parts = line.split("|").map((s) => s.trim());
				const rawItem = rawActionPlan[idx];
				const evidenceRefs = parts[0]
					? parts[0]
							.split(/[,，]/)
							.map((s) => s.trim())
							.filter(Boolean)
					: [];

				const action = parts[1] || "待补充行动方案";
				const rawPrio = (parts[2] || "").toUpperCase();
				const priority = (["P0", "P1", "P2"].includes(rawPrio) ? rawPrio : "P1") as "P0" | "P1" | "P2";
				const rationale = parts[3] || "待补充优先级依据";
				const deliverable = parts[4] || "待补充交付件";
				const verification = parts[5] || "待补充验证方法";

				// 若当前项与原项未变动，且原项存在合法 finding，则原样继承原项 finding (E4-R02)
				const isUnchangedFromRaw =
					rawItem &&
					Array.isArray(rawItem.evidence_refs) &&
					rawItem.evidence_refs.length === evidenceRefs.length &&
					rawItem.evidence_refs.every((ref: string, i: number) => ref === evidenceRefs[i]) &&
					rawItem.action === action &&
					rawItem.priority === priority &&
					rawItem.deliverable === deliverable;

				const finding =
					isUnchangedFromRaw && rawItem.finding
						? rawItem.finding
						: parts[0]
							? `针对 ${parts[0]} 的实测发现`
							: "待补充实测发现";

				return {
					finding,
					evidence_refs: evidenceRefs,
					action,
					priority,
					priority_rationale: rationale,
					deliverable,
					verification_method: verification,
				};
			});

			let finalBrandIdentityAudit: any = brandIdentityAudit.trim() || "待人工核实与完善";
			if (rawBrandIdentityAudit && typeof rawBrandIdentityAudit === "object") {
				finalBrandIdentityAudit = {
					...rawBrandIdentityAudit,
					analysis: brandIdentityAudit.trim() || rawBrandIdentityAudit.analysis || "待人工核实与完善",
				};
			}

			// 保全成因、渠道与 AI 元数据 (F-R05 / F-R06)
			const rootCauses = analysisData?.payload?.root_causes || [];
			const channelGaps = analysisData?.payload?.channel_gaps || [];
			const aiMetadata = analysisData?.payload?.ai_metadata
				? {
						...analysisData.payload.ai_metadata,
						parent_version: analysisData.version,
						human_refined: true,
					}
				: undefined;

			return saveBaselineAnalysisFn({
				data: {
					brandId: brandId!,
					runId: activeRunId,
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
		onSuccess: async (res) => {
			setActiveAnalysisId(res.analysis_id);
			setActionError(null);
			await refetchAnalysis();
			// 自动装配对应的新报告修订并选中 (F-R05)
			const nextNum = (reportData?.revisions?.length || 0) + 1;
			const targetRev = `rev_${String(nextNum).padStart(2, "0")}`;
			generateRevisionMutation.mutate({ revisionId: targetRev, analysisId: res.analysis_id });
		},
		onError: (err: any) => setActionError(`保存人工分析失败: ${err.message}`),
	});

	const generateRevisionMutation = useMutation({
		mutationFn: (args: string | { revisionId: string; analysisId?: string }) => {
			const revId = typeof args === "string" ? args : args.revisionId;
			const anlId = typeof args === "string" ? activeAnalysisId : (args.analysisId || activeAnalysisId);
			return generateBaselineReportRevisionFn({
				data: {
					brandId: brandId!,
					runId: activeRunId,
					revisionId: revId.trim() || "rev_01",
					analysisId: anlId,
					draftNotice: `内部预览草稿，未经终审（${revId.trim() || "rev_01"} · 离线验证）`,
				},
			});
		},
		onSuccess: (res) => {
			setActiveRevisionId(res.revision_id);
			// 自动预推下一个 revision 编号供继续修改 (E-R06)
			const currentNum = parseInt(res.revision_id.replace(/^rev_/, ""), 10) || 1;
			setRevisionInput(`rev_${String(currentNum + 1).padStart(2, "0")}`);
			setActionError(null);
			refetchReport();
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
			setReviewNotice(`审核操作完成：状态已更新为 ${res.review_status}（审核主体: ${res.reviewer}）`);
			setActionError(null);
			refetchReport();
		},
		onError: (err: any) => {
			// 合成数据批准被拒绝是预期内的严格机器门禁行为 (D-R06 / D-R07)
			setReviewNotice(null);
			setActionError(`门禁审核拦截 (安全防线): ${err.message}`);
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
							统一诊断操作门户（内部操作员专用 · 手动单次监测模式 · 封禁自动续采）
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

			{/* 运行模式与环境门禁提示横幅 (REPORT-001F / F-R01) */}
			<div
				className={`border px-4 py-2.5 rounded-lg text-xs flex items-center justify-between gap-3 ${
					executionMode === "real"
						? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200"
						: "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-200"
				}`}
			>
				<div className="flex items-center gap-2">
					<IconShieldCheck
						className={executionMode === "real" ? "text-red-600 shrink-0" : "text-amber-600 shrink-0"}
						size={16}
					/>
					<span>
						{executionMode === "real" ? (
							<>
								<strong>【受控真实执行模式】</strong>将调用真实豆包方舟与 DeepSeek 外部 API。必须服务端具备有效授权与凭据，未授权将触发拦截守卫，禁止自动伪造完成。
							</>
						) : (
							<>
								<strong>【测试与预览环境】</strong>当前处于离线测试模式 (Offline Mock)。所有外部模型交互（Ark 采样与 DeepSeek 分析）均通过安全 Mock 通道运行，不调用真实付费 API，不产生实际账单。
							</>
						)}
					</span>
				</div>
				<span
					className={`font-mono text-[11px] px-2 py-0.5 rounded shrink-0 ${
						executionMode === "real"
							? "bg-red-100 dark:bg-red-900/60 text-red-900 dark:text-red-200 font-bold"
							: "bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200"
					}`}
				>
					{executionMode === "real" ? "REAL MODE · BUDGET GATED" : "MOCK ONLY · ZERO BILLED"}
				</span>
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
									onChange={(e) => { if (!e.target.value || e.target.value === activeRunId) return; handleSelectRun(e.target.value); void navigate({ search: { runId: e.target.value }, replace: true }); }}
									className="border rounded-md px-2 py-1.5 bg-background font-mono text-xs max-w-xs"
								>
									<option value="" disabled>-- 选择已有任务查看/处理 --</option>
									{runsListData.items.map((r: any) => (
										<option key={r.run_id} value={r.run_id}>
											{r.run_id} ({r.mode} · {r.status} · {r.created_at?.slice(0, 16)})
										</option>
									))}
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
							<div className="text-xs text-muted-foreground">
								{frozenSnapshot ? (
									<span className="text-green-600 dark:text-green-400 font-medium inline-flex items-center gap-1">
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
									className="text-xs border px-3 py-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors disabled:opacity-50"
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
								<span className="text-muted-foreground">执行模式:</span>
								<select
									aria-label="执行模式"
									value={executionMode}
									disabled={preparationBusy || Boolean(draft.runId)}
									onChange={(e) => { const mode = e.target.value as "real" | "synthetic"; void transact((current) => ({ ...current, mode })).catch((err: Error) => setActionError(err.message)); }}
									className="border rounded px-2 py-1 bg-background text-xs font-semibold"
								>
									<option value="synthetic">离线合成模式 (Synthetic · Mock)</option>
									<option value="real">真实执行受控分支 (Real · 需服务端授权)</option>
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
									<span className="font-semibold ml-1">豆包方舟 (Ark 联网检索)</span>
								</div>
								<div>
									<span className="text-muted-foreground">分析调用：</span>
									<span className="font-semibold ml-1">DeepSeek (V2 七章并发)</span>
								</div>
								<div>
									<span className="text-muted-foreground">运行模式：</span>
									<span className="font-semibold ml-1 uppercase">{executionMode}</span>
								</div>
								<div>
									<span className="text-muted-foreground">费用与限制：</span>
									<span className="font-semibold ml-1 text-amber-700 dark:text-amber-300">
										{executionMode === "real"
											? activeAuthData?.authorization
												? `硬上限: 采${activeAuthData.authorization.request_limit}次·析7次`
												: "待服务端授权 (未授权禁止外发)"
											: "离线测试 0 费用 (Ark≤30次·析7次)"}
									</span>
								</div>
							</div>
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
												待服务端登记授权（未授权将触发拦截守卫）
											</span>
										)}
									</div>
									{activeAuthData?.authorization && (
										<div className="text-muted-foreground mt-1 space-y-0.5 font-mono text-[11px]">
											<div>
												模型: {activeAuthData.authorization.model_name} · 联网:{" "}
												{activeAuthData.authorization.web_search ? "开启" : "关闭"}
											</div>
											<div>
												预算: {activeAuthData.authorization.request_limit} 次 · 重试:{" "}
												{activeAuthData.authorization.retry_limit} 次
											</div>
										</div>
									)}
								</div>
							)}
							{executionMode === "real" && frozenSnapshot && !activeAuthData?.authorization && (
								<div className="space-y-2">
									<p className="text-xs">本次仅授权这 {frozenSnapshot.question_count} 道题，采集上限 {frozenSnapshot.question_count} 次、重试 0 次，分析沿用本页所示范围。需要组织管理员或 owner 确认。</p>
									<button type="button" disabled={preparationBusy || draft.submitted} className="border rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50" onClick={() => {
										if (window.confirm(`确认授权本次 ${frozenSnapshot.question_count} 题真实豆包诊断？采集最多 ${frozenSnapshot.question_count} 次、重试 0 次，另含本页所示 DeepSeek 分析。仅本轮有效，不自动续采。`)) authorizeMutation.mutate();
									}}>确认本次费用范围并授权</button>
								</div>
							)}

							<p className="text-xs text-muted-foreground mt-1">
								⚠️ 安全声明：本轮仅执行一次有限诊断，任务完成后绝不自动创建下一轮；真实模式需服务端开关显式开启且配置有效凭据，未授权将触发拦截守卫。
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
								onClick={() => createRunMutation.mutate()}
								disabled={!frozenSnapshot || preparationBusy || (!draft.submitted && !draft.runId && executionMode === "real" && !activeAuthData?.authorization)}
								className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-green-700 transition-colors disabled:opacity-50"
							>
								<IconPlayerPlay size={15} />
								{createRunMutation.isPending ? "正在确认本次任务..." : draft.submitted ? "查看本次任务（已发起）" : draft.runId ? "查询或重放本次启动" : "启动本次诊断任务"}
							</button>
						</div>
					</div>

					{/* 步骤 3: 诊断任务状态与客观指标看板 */}
					{activeRunId && (
						<div data-no-i18n="true" className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-5">
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
									<span className="text-xs text-muted-foreground">数据来源模式</span>
									<div className="text-sm font-bold mt-0.5 uppercase text-muted-foreground">
										{runData?.mode || "synthetic"}
									</div>
								</div>
							</div>

							{activeRunId && (evidenceError || metricsError) && <p role="status" className="text-xs text-amber-700">本轮归档或统计暂未同步，相关区域暂不展示；已尝试题数来自当前任务。可刷新查询，不会重新采集。</p>}
							{runData && <>
								<p className="text-xs text-muted-foreground" aria-label="本次诊断计数">{diagnosisCountText(runData)} · 物理请求数：{!evidenceError && evidenceData?.run_id === runData.run_id ? evidenceData.total_requests_used : "归档计数待同步"}</p>
								<DiagnosisStages stages={diagnosisStages(runData, metricsError ? undefined : metricsData, analysisData, reportData)} />
							</>}

							{/* 分析失败恢复卡片 */}
							{runData?.current_step === "analysis_failed" && (
								<div className="bg-red-50/70 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-3 text-xs flex items-center justify-between gap-3">
									<div>
										<div className="flex items-center gap-1.5 font-bold text-red-700 dark:text-red-300">
											<IconAlertTriangle size={16} />
											<span>AI 自动分析执行异常</span>
										</div>
										<div className="text-red-600 dark:text-red-400 mt-0.5">
											{runData.error_message || "分析执行失败"}
										</div>
										<div className="text-muted-foreground mt-0.5">
											💡 采集数据已完整归档，无需重新采样。点击右侧按钮可直接重试 DeepSeek 自动分析。
										</div>
									</div>
									<button
										onClick={() => retryAnalysisMutation.mutate()}
										disabled={retryAnalysisMutation.isPending}
										className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors shrink-0 disabled:opacity-50"
									>
										{retryAnalysisMutation.isPending ? "重试中..." : "重试 AI 自动分析"}
									</button>
								</div>
							)}

							{/* 报告渲染失败恢复卡片 */}
							{runData?.current_step === "report_render_failed" && (
								<div className="bg-red-50/70 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg p-3 text-xs flex items-center justify-between gap-3">
									<div>
										<div className="flex items-center gap-1.5 font-bold text-red-700 dark:text-red-300">
											<IconAlertTriangle size={16} />
											<span>报告草稿渲染失败</span>
										</div>
										<div className="text-red-600 dark:text-red-400 mt-0.5">
											{runData.error_message || "渲染失败"}
										</div>
										<div className="text-muted-foreground mt-0.5">
											💡 AI 分析已持久化入库，点击右侧按钮直接重新渲染 PDF/HTML，不重复调用 LLM。
										</div>
									</div>
									<button
										onClick={() => generateRevisionMutation.mutate("rev_01")}
										disabled={generateRevisionMutation.isPending}
										className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors shrink-0 disabled:opacity-50"
									>
										{generateRevisionMutation.isPending ? "渲染中..." : "重试报告草稿生成"}
									</button>
								</div>
							)}

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
													key={q.question_code}
													className="border rounded-lg p-3 text-xs flex flex-col gap-2 bg-muted/10"
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
																onClick={() =>
																	setExpandedQuestions({
																		...expandedQuestions,
																		[q.question_code]: !isExpanded,
																	})
																}
																className="p-1 hover:bg-muted rounded text-muted-foreground"
															>
																{isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
															</button>
														</div>
													</div>

													<div className="text-muted-foreground bg-background p-2.5 rounded border leading-relaxed">
														<span className="font-semibold text-foreground">💬 模型实测回答：</span>
														{isExpanded
															? q.answer_text || "无有效回答"
															: q.answer_text
																? q.answer_text.slice(0, 150) + (q.answer_text.length > 150 ? "..." : "")
																: "无有效回答"}
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
														<span>🔍 检索词: {q.search_queries?.join(", ") || "无"}</span>
														<span>🔗 引用数: {q.citations?.length ?? 0}</span>
														<span>
															⚡ Token: {q.raw_usage?.total_tokens !== undefined && q.raw_usage?.total_tokens !== null ? q.raw_usage.total_tokens : "未知"}
														</span>
													</div>
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
														key={q.question_code}
														className="border rounded-lg p-3 text-xs flex flex-col gap-2 bg-purple-50/20 dark:bg-purple-950/10 border-purple-200 dark:border-purple-800/40"
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
																	onClick={() =>
																		setExpandedQuestions({
																			...expandedQuestions,
																			[q.question_code]: !isExpanded,
																		})
																	}
																	className="p-1 hover:bg-purple-100 dark:hover:bg-purple-900/40 rounded text-purple-700"
																>
																	{isExpanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
																</button>
															</div>
														</div>

														<div className="text-muted-foreground bg-background p-2.5 rounded border leading-relaxed">
															<span className="font-semibold text-foreground">💬 探针回答：</span>
															{isExpanded
																? q.answer_text || "无有效回答"
																: q.answer_text
																	? q.answer_text.slice(0, 150) + (q.answer_text.length > 150 ? "..." : "")
																	: "无有效回答"}
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
															<span>
																⚡ Token: {q.raw_usage?.total_tokens !== undefined && q.raw_usage?.total_tokens !== null ? q.raw_usage.total_tokens : "未知"}
															</span>
														</div>
													</div>
												);
											})}
										</div>
									)}
								</div>
							)}
						</div>
					)}

					{/* 步骤 4: 录入人工成因诊断与优先行动清单 (E-R05: 全部真实输入，严禁预填伪造内容) */}
					{activeRunId && (runData?.status === "completed" || runData?.status === "partial") && (
						<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-4">
							<div className="flex items-center justify-between border-b pb-3">
								<div className="flex items-center gap-2 font-semibold text-base">
									<span className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
										4
									</span>
									诊断分析草稿与优先行动建议（AI 自动生成 · 支持人工复核与修改）
								</div>
								<div className="text-xs text-muted-foreground">
									{activeAnalysisId ? (
										<span className="text-green-600 dark:text-green-400 font-medium inline-flex items-center gap-1">
											<IconCheck size={14} /> 当前分析版本: {activeAnalysisId}
										</span>
									) : (
										"严格绑定本轮运行，递增版本留痕"
									)}
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">分析师姓名 *</label>
									<input
										type="text"
										placeholder="如: 张分析师"
										value={analystName}
										onChange={(e) => setAnalystName(e.target.value)}
										className="border rounded-md px-3 py-1.5 bg-background"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">核心执行结论 *</label>
									<input
										type="text"
										placeholder="输入本轮诊断总体结论..."
										value={executiveConclusion}
										onChange={(e) => setExecutiveConclusion(e.target.value)}
										className="border rounded-md px-3 py-1.5 bg-background"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">关键发现清单 *（每行一条）</label>
									<textarea
										rows={3}
										placeholder="例如:&#10;核心业务板块提及率偏低&#10;主体探针可准确识别&#10;竞品占位显著"
										value={keyFindings}
										onChange={(e) => setKeyFindings(e.target.value)}
										className="border rounded-md p-2 bg-background font-mono"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<label className="font-semibold">主体识别审核结论</label>
									<input
										type="text"
										placeholder="主体识别清晰，无同名企业混淆（若未填显示待核）"
										value={brandIdentityAudit}
										onChange={(e) => setBrandIdentityAudit(e.target.value)}
										className="border rounded-md px-3 py-1.5 bg-background"
									/>
								</div>
								<div className="flex flex-col gap-1.5 md:col-span-2">
									<label className="font-semibold">内容资产缺口分析</label>
									<input
										type="text"
										placeholder="输入官方公开内容资产或索引缺口..."
										value={contentGapsInput}
										onChange={(e) => setContentGapsInput(e.target.value)}
										className="border rounded-md px-3 py-1.5 bg-background"
									/>
								</div>
								<div className="flex flex-col gap-1.5 md:col-span-2">
									<label className="font-semibold">
										优先行动建议清单 * (格式: 题码 | 建议行动 | 优先级(P0/P1/P2) | 决策依据 | 交付物 | 验证方式)
									</label>
									<textarea
										rows={3}
										placeholder="Q01 | 在海外官网增设标杆案例专页 | P0 | 契合主流寻源问法 | 官方技术专题 | 次月复测"
										value={actionPlanInput}
										onChange={(e) => setActionPlanInput(e.target.value)}
										className="border rounded-md p-2 bg-background font-mono"
									/>
								</div>
							</div>

							<div className="flex items-center justify-end pt-2">
								<button
									onClick={() => saveAnalysisMutation.mutate()}
									disabled={
										saveAnalysisMutation.isPending ||
										generateRevisionMutation.isPending ||
										!analystName.trim() ||
										!executiveConclusion.trim() ||
										!keyFindings.trim() ||
										!actionPlanInput.trim()
									}
									className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-blue-700 transition-colors disabled:opacity-50"
								>
									<IconDeviceFloppy size={15} />
									{saveAnalysisMutation.isPending || generateRevisionMutation.isPending
										? "保存并装配新报告中..."
										: "保存分析并装配新报告 (不调 LLM)"}
								</button>
							</div>
						</div>
					)}

					{/* 步骤 5: 生成报告修订、审核与受控下载 (E-R06: 支持 rev_02 递增，不撞 rev_01；支持历史修订查看与下载) */}
					{(activeAnalysisId || (reportData?.revisions && reportData.revisions.length > 0)) && (
						<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-5">
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
							{reportData?.revisions && reportData.revisions.length > 0 && (
								<div className="flex items-center gap-2 flex-wrap text-xs bg-muted/20 p-3 rounded-lg border">
									<span className="font-semibold text-muted-foreground shrink-0">已生成修订版本:</span>
									<div className="flex items-center gap-1.5 flex-wrap">
										{reportData.revisions.map((rev: any) => {
											const isSelected = activeRevisionId === rev.revision_id;
											return (
												<button
													key={rev.revision_id}
													type="button"
													onClick={() => setActiveRevisionId(rev.revision_id)}
													className={`px-3 py-1 rounded-md font-mono text-xs font-semibold transition-colors flex items-center gap-1.5 ${
														isSelected
															? "bg-indigo-600 text-white shadow-sm"
															: "bg-background border text-foreground hover:bg-muted"
													}`}
												>
													<span>{rev.revision_id}</span>
													<span className="text-[10px] opacity-80">
														({rev.review_status === "approved" ? "已批准" : rev.review_status === "rejected" ? "已退回" : "草稿"})
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
									</div>
								</div>
								<div className="flex items-center gap-2">
									<input
										type="text"
										value={revisionInput}
										onChange={(e) => setRevisionInput(e.target.value)}
										placeholder="rev_01"
										className="border rounded px-2.5 py-1.5 w-24 bg-background font-mono text-xs"
									/>
									<button
										onClick={() => generateRevisionMutation.mutate(revisionInput)}
										disabled={generateRevisionMutation.isPending || !revisionInput.trim()}
										className="inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-xs hover:bg-indigo-700 transition-colors disabled:opacity-50 shrink-0"
									>
										<IconFileText size={15} />
										{generateRevisionMutation.isPending
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
											<span className="font-bold text-sm">报告审核门禁 (机器前置校验 + 角色强门禁)</span>
											<p className="text-xs text-muted-foreground mt-1">
												严格机器门禁：合成数据报告严禁批准为正式客户件；非 Admin/Owner 角色无权批准。点击“批准正式交付”将触发合规拦截；“退回草稿”将合规留痕。
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
