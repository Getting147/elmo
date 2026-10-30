import { useCallback, useMemo } from "react";
import { useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useFilterNavigate } from "@/hooks/use-list-filters";
import {
	listBaselineRunsFn,
	getBaselineRunFn,
	getBaselineMetricsFn,
	getBaselineEvidenceFn,
	getBaselineAnalysisFn,
} from "@/server/baseline";

export interface ActiveBaselineRunResult {
	hasBaselineRuns: boolean;
	isLoadingRunsList: boolean;
	isRequestedRunMissing: boolean;
	requestedRunId?: string;
	activeRunId: string | undefined;
	activeRunSummary: any | null;
	runsList: any[];
	totalRunsCount: number;
	runData: any | undefined;
	metricsData: any | undefined;
	evidenceData: any | undefined;
	analysisData: any | undefined;
	isLoading: boolean;
	isError: boolean;
	isLoadingAnalysis: boolean;
	isAnalysisError: boolean;
	analysisError: unknown;
	refetchAnalysis: () => void;
	errors: {
		runsListError: unknown;
		runError: unknown;
		metricsError: unknown;
		evidenceError: unknown;
		analysisError: unknown;
	};
	selectRun: (newRunId: string) => void;
	refetchAll: () => void;
}

/**
 * Synchronous format validation helper:
 * Returns true if runId is invalid (primitive null, invalid characters, sentinel tokens).
 * Empty string and undefined are considered "unspecified" (not invalid format).
 */
export function isInvalidBaselineRunId(runId: unknown): boolean {
	if (runId === undefined) return false;
	if (runId === null) return true;
	const str = String(runId).trim();
	if (str === "") return false;
	return !/^[a-zA-Z0-9_-]+$/.test(str) || str === "__invalid_run__";
}

/**
 * Pure evaluation helper for determining if a requested run is missing.
 * Facilitates direct unit test assertions without requiring full React hook harness.
 */
export function computeIsRequestedRunMissing(params: {
	requestedRunId?: string;
	runs?: Array<{ run_id: string }>;
	isLoadingRunsList?: boolean;
	isLoadingRun?: boolean;
	runData?: { run_id: string } | null;
	runError?: unknown;
}): boolean {
	const {
		requestedRunId,
		runs = [],
		isLoadingRunsList = false,
		isLoadingRun = false,
		runData,
		runError,
	} = params;

	if (!requestedRunId) return false;

	const isRunInvalidFormat = isInvalidBaselineRunId(requestedRunId);
	if (isRunInvalidFormat) return true;

	const isRunNotFound = Boolean(
		runError &&
			((runError as any)?.status === 404 ||
				(runError as any)?.status === 403 ||
				String((runError as any)?.message || "").includes("404") ||
				String((runError as any)?.message || "").includes("403") ||
				String((runError as any)?.message || "").includes("not_found") ||
				String((runError as any)?.message || "").includes("denied")),
	);

	const isRunFound = Boolean(
		runs.some((r: any) => r.run_id === requestedRunId) ||
		(runData && runData.run_id === requestedRunId)
	);

	return Boolean(
		isRunNotFound ||
		(!isLoadingRunsList && !isLoadingRun && !isRunFound)
	);
}

/**
 * Hook to manage active baseline diagnostic run state across the 5 dashboards.
 * - Reads `runId` from URL search params.
 * - If `runId` is not explicitly provided, defaults to the latest explicitly initiated task.
 * - When `runId` is explicitly provided, maintains strict task identity: queries the run directly,
 *   supports historical runs beyond the top-30 list, and does NOT fall back to runs[0] on 404/403.
 * - If brand has no baseline runs, `hasBaselineRuns` is false (enables seamless fallback to V2 views).
 * - Read-only queries with org & brand validation, no hidden sampling/analysis triggers.
 */
export function useActiveBaselineRun(brandId: string | undefined): ActiveBaselineRunResult {
	const urlSearch = useSearch({ strict: false }) as Record<string, unknown>;
	const rawRunId = urlSearch?.runId;
	const requestedRunId = useMemo(() => {
		if (rawRunId === undefined) return undefined;
		if (rawRunId === null) return "null";
		const str = String(rawRunId).trim();
		return str === "" ? undefined : str;
	}, [rawRunId]);

	// 1. Query baseline runs list for this brand
	const {
		data: runsListData,
		isLoading: isLoadingRunsList,
		isError: isRunsListError,
		error: runsListError,
		refetch: refetchRunsList,
	} = useQuery({
		queryKey: ["baseline-runs-list", brandId],
		queryFn: () => listBaselineRunsFn({ data: { brandId: brandId! } }),
		enabled: !!brandId,
		staleTime: 30_000,
	});

	const runs = runsListData?.items || [];

	// Determine activeRunId: strictly preserve requestedRunId when specified,
	// only falling back to runs[0] when no runId was explicitly requested.
	const activeRunId = requestedRunId || runs[0]?.run_id;

	// Synchronous format check: characters outside [a-zA-Z0-9_-] or sentinel tokens are immediately flagged
	const isRunInvalidFormat = Boolean(
		requestedRunId && isInvalidBaselineRunId(requestedRunId)
	);

	// 2. Query run details directly (authenticates existence and org/brand ownership)
	const {
		data: runData,
		isLoading: isLoadingRun,
		error: runError,
		refetch: refetchRun,
	} = useQuery({
		queryKey: ["baseline-run", brandId, activeRunId],
		queryFn: () => getBaselineRunFn({ data: { brandId: brandId!, runId: activeRunId! } }),
		enabled: !!brandId && !!activeRunId && !isRunInvalidFormat,
		staleTime: 30_000,
		retry: false,
	});

	const isRunNotFound = Boolean(
		runError &&
			((runError as any)?.status === 404 ||
				(runError as any)?.status === 403 ||
				String((runError as any)?.message || "").includes("404") ||
				String((runError as any)?.message || "").includes("403") ||
				String((runError as any)?.message || "").includes("not_found") ||
				String((runError as any)?.message || "").includes("denied")),
	);

	const isRunFound = Boolean(
		(requestedRunId && runs.some((r: any) => r.run_id === requestedRunId)) ||
		(runData && runData.run_id === requestedRunId)
	);

	const isRequestedRunMissing = Boolean(
		requestedRunId &&
			(isRunInvalidFormat ||
				isRunNotFound ||
				(!isLoadingRunsList && !isLoadingRun && !isRunFound)),
	);

	// 3. Resolve active run summary
	const activeRunSummary = useMemo(() => {
		if (isRequestedRunMissing) return null;
		if (requestedRunId) {
			const found = runs.find((r: any) => r.run_id === requestedRunId);
			if (found) return found;
			if (runData && runData.run_id === requestedRunId) {
				return {
					run_id: runData.run_id,
					brand_id: runData.brand_id,
					status: runData.status,
					model_name: runData.model_name,
					created_at: runData.created_at,
					completed_at: runData.completed_at,
					task_count: runData.task_count ?? 0,
					success_count: runData.success_count ?? 0,
					failed_count: runData.failed_count ?? 0,
				};
			}
			return null;
		}
		// Default to latest explicitly initiated task (runs[0])
		return runs[0] || null;
	}, [runs, requestedRunId, runData, isRequestedRunMissing]);

	// Inject active run into runs list if it was a historical run not in the top-30 list
	const effectiveRunsList = useMemo(() => {
		if (isRequestedRunMissing) return runs;
		if (runData && runData.run_id && !runs.some((r: any) => r.run_id === runData.run_id)) {
			return [
				{
					run_id: runData.run_id,
					brand_id: runData.brand_id,
					status: runData.status,
					model_name: runData.model_name,
					created_at: runData.created_at,
					completed_at: runData.completed_at,
				},
				...runs,
			];
		}
		return runs;
	}, [runs, runData, isRequestedRunMissing]);

	// Gate downstream queries: only execute when run identity is verified
	const isKnownRun = Boolean(activeRunId && runs.some((r: any) => r.run_id === activeRunId));
	const isRunReady = Boolean(
		brandId &&
		activeRunId &&
		!isRequestedRunMissing &&
		(isKnownRun || Boolean(runData && runData.run_id === activeRunId))
	);

	// 4. Query metrics
	const {
		data: metricsData,
		isLoading: isLoadingMetrics,
		error: metricsError,
		refetch: refetchMetrics,
	} = useQuery({
		queryKey: ["baseline-metrics", brandId, activeRunId],
		queryFn: () => getBaselineMetricsFn({ data: { brandId: brandId!, runId: activeRunId! } }),
		enabled: isRunReady,
		staleTime: 30_000,
	});

	// 5. Query evidence (formal & probe questions, search queries, citations)
	const {
		data: evidenceData,
		isLoading: isLoadingEvidence,
		error: evidenceError,
		refetch: refetchEvidence,
	} = useQuery({
		queryKey: ["baseline-evidence", brandId, activeRunId],
		queryFn: () => getBaselineEvidenceFn({ data: { brandId: brandId!, runId: activeRunId! } }),
		enabled: isRunReady,
		staleTime: 30_000,
	});

	// 6. Query analysis (for opportunities)
	const {
		data: analysisData,
		isLoading: isLoadingAnalysis,
		error: analysisError,
		refetch: refetchAnalysis,
	} = useQuery({
		queryKey: ["baseline-analysis", brandId, activeRunId],
		queryFn: () => getBaselineAnalysisFn({ data: { brandId: brandId!, runId: activeRunId! } }),
		enabled: isRunReady,
		staleTime: 30_000,
		retry: false,
	});

	const setFilters = useFilterNavigate();

	const selectRun = useCallback(
		(newRunId: string) => {
			if (!newRunId || newRunId === activeRunId) return;
			setFilters({ runId: newRunId });
		},
		[setFilters, activeRunId],
	);

	return {
		hasBaselineRuns: Boolean((runsListData && runs.length > 0) || runData),
		isLoadingRunsList,
		isRequestedRunMissing,
		requestedRunId,
		activeRunId: isRequestedRunMissing ? requestedRunId : activeRunId,
		activeRunSummary,
		runsList: effectiveRunsList,
		totalRunsCount: runsListData?.total ?? effectiveRunsList.length,
		runData,
		metricsData,
		evidenceData,
		analysisData,
		isLoading:
			isLoadingRunsList ||
			(Boolean(activeRunId) && !isRequestedRunMissing && (isLoadingRun || isLoadingMetrics || isLoadingEvidence)),
		isError: isRunsListError || Boolean(runError) || Boolean(metricsError) || Boolean(evidenceError),
		isLoadingAnalysis,
		isAnalysisError: Boolean(analysisError),
		analysisError,
		refetchAnalysis: () => {
			refetchAnalysis();
		},
		errors: {
			runsListError,
			runError,
			metricsError,
			evidenceError,
			analysisError,
		},
		selectRun,
		refetchAll: () => {
			refetchRunsList();
			if (activeRunId && !isRequestedRunMissing) {
				refetchRun();
				refetchMetrics();
				refetchEvidence();
				refetchAnalysis();
			}
		},
	};
}
