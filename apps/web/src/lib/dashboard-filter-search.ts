/** URL search keys that the five baseline dashboards share. Navigation
 *  between them must keep the user's current filter context; route-specific
 *  keys (e.g. fan-out `tab`, prompts `order`) stay on their own page. */
export const DASHBOARD_FILTER_KEYS = ["runId", "model", "lookback", "tags", "q"] as const;

export function pickDashboardFilterSearch(
	previous: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
	if (!previous) return {};
	const picked: Record<string, unknown> = {};
	for (const key of DASHBOARD_FILTER_KEYS) {
		if (previous[key] !== undefined) picked[key] = previous[key];
	}
	return picked;
}