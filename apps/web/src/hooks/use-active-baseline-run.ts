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
 * Hook to manage active baseline diagnostic run state across the 5 dashboards.
 * - Reads `runId` from URL search params.
 * - If `runId` is not explicitly provided, defaults to the latest explicitly initiated task.
 * - If brand has no baseline runs, `hasBaselineRuns` is false (enables seamless fallback to V2 views).
 * - Read-only queries with org & brand validation, no hidden sampling/analysis triggers.
 */
export function useActiveBaselineRun(brandId: string | undefined): ActiveBaselineRunResult {
	const urlSearch = useSearch({ strict: false }) as { runId?: string };
	const requestedRunId = urlSearch?.runId;

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
	const isRequestedRunMissing = Boolean(
		requestedRunId && !isLoadingRunsList && runs.length > 0 && !runs.some((r: any) => r.run_id === requestedRunId),
	);

	// 2. Resolve active run summary
	const activeRunSummary = useMemo(() => {
		if (runs.length === 0) return null;
		if (requestedRunId) {
			const found = runs.find((r: any) => r.run_id === requestedRunId);
			if (found) return found;
		}
		// Default to latest explicitly initiated task (runs[0])
		return runs[0] || null;
	}, [runs, requestedRunId]);

	const activeRunId = activeRunSummary?.run_id;

	// 3. Query run details
	const {
		data: runData,
		isLoading: isLoadingRun,
		error: runError,
		refetch: refetchRun,
	} = useQuery({
		queryKey: ["baseline-run", brandId, activeRunId],
		queryFn: () => getBaselineRunFn({ data: { brandId: brandId!, runId: activeRunId! } }),
		enabled: !!brandId && !!activeRunId,
		staleTime: 30_000,
	});

	// 4. Query metrics
	const {
		data: metricsData,
		isLoading: isLoadingMetrics,
		error: metricsError,
		refetch: refetchMetrics,
	} = useQuery({
		queryKey: ["baseline-metrics", brandId, activeRunId],
		queryFn: () => getBaselineMetricsFn({ data: { brandId: brandId!, runId: activeRunId! } }),
		enabled: !!brandId && !!activeRunId,
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
		enabled: !!brandId && !!activeRunId,
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
		enabled: !!brandId && !!activeRunId,
		staleTime: 30_000,
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
		hasBaselineRuns: Boolean(runsListData && runs.length > 0),
		isLoadingRunsList,
		isRequestedRunMissing,
		activeRunId,
		activeRunSummary,
		runsList: runs,
		totalRunsCount: runsListData?.total ?? runs.length,
		runData,
		metricsData,
		evidenceData,
		analysisData,
		isLoading:
			isLoadingRunsList ||
			(Boolean(activeRunId) && (isLoadingRun || isLoadingMetrics || isLoadingEvidence)),
		isError: isRunsListError || Boolean(runError) || Boolean(metricsError) || Boolean(evidenceError),
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
			if (activeRunId) {
				refetchRun();
				refetchMetrics();
				refetchEvidence();
				refetchAnalysis();
			}
		},
	};
}
