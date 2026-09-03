import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getOpportunitiesFn } from "@/server/opportunities";
import { useLanguage } from "@/lib/language-context";

export const opportunitiesKeys = {
	all: ["opportunities-report"] as const,
	detail: (brandId: string, language: string) =>
		[...opportunitiesKeys.all, brandId, language] as const,
};

/**
 * Opportunities AEO report. The server returns a stored report for the current
 * UI language and regenerates it only when the latest for that language is
 * stale, so this is held for the session (staleTime: Infinity, no
 * refetch-on-focus) rather than refetched.
 */
export function useOpportunities(brandId?: string) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;
	const { language } = useLanguage();

	const query = useQuery({
		queryKey: opportunitiesKeys.detail(resolvedBrandId || "", language),
		queryFn: () =>
			getOpportunitiesFn({
				data: {
					brandId: resolvedBrandId!,
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					language: language === "zh" ? "zh" : "en",
				},
			}),
		enabled: !!resolvedBrandId,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		isError: !!query.error,
		revalidate: query.refetch,
	};
}
