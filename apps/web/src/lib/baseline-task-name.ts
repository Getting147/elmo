export interface FormatDiagnosticTaskOptions {
	brandName?: string | null;
	runId?: string | null;
	createdAt?: string | Date | null;
	completedAt?: string | Date | null;
	isZh?: boolean;
	conflictingRunIds?: (string | null | undefined)[];
}

/**
 * Extracts a stable short identifier from a run_id by stripping the optional 'run_' prefix
 * and taking up to 8 characters.
 * If conflictingRunIds is provided and another run shares the same 8-character prefix,
 * extends the short identifier (up to 13 chars) to disambiguate the conflict.
 */
export function getShortRunId(
	runId?: string | null,
	conflictingRunIds?: (string | null | undefined)[],
): string {
	if (!runId) return "";
	const cleaned = runId.startsWith("run_") ? runId.slice(4) : runId;
	const defaultShort = cleaned.slice(0, 8);
	if (!conflictingRunIds || conflictingRunIds.length === 0) {
		return defaultShort;
	}

	const hasCollision = conflictingRunIds.some((other) => {
		if (!other || other === runId) return false;
		const otherCleaned = other.startsWith("run_") ? other.slice(4) : other;
		return otherCleaned.slice(0, 8) === defaultShort;
	});

	if (!hasCollision) return defaultShort;

	// When collision exists among the provided runs, extend up to 13 chars to disambiguate
	return cleaned.length > 8 ? cleaned.slice(0, 13) : defaultShort;
}

/**
 * Formats a date string or Date object into 'YYYY-MM-DD HH:mm' in Asia/Shanghai timezone.
 * Returns '时间未知' (or 'Time unknown' when isZh is false) if date is missing or invalid.
 */
export function formatBeijingTime(dateInput?: string | Date | null, isZh = true): string {
	if (!dateInput) return isZh ? "时间未知" : "Time unknown";
	const d = new Date(dateInput);
	if (Number.isNaN(d.getTime())) return isZh ? "时间未知" : "Time unknown";

	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	const parts = formatter.formatToParts(d);
	const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";
	const year = getPart("year");
	const month = getPart("month");
	const day = getPart("day");
	let hour = getPart("hour");
	if (hour === "24") hour = "00";
	const minute = getPart("minute");

	if (!year || !month || !day || !hour || !minute) {
		return isZh ? "时间未知" : "Time unknown";
	}

	return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Formats diagnostic task display name according to the unified specification:
 * 品牌显示名｜YYYY-MM-DD HH:mm（北京时间）｜批次<短编号>
 * Example: 美的｜2026-11-01 16:00（北京时间）｜批次608dd03e
 */
export function formatDiagnosticTaskName({
	brandName,
	runId,
	createdAt,
	completedAt,
	isZh = true,
	conflictingRunIds,
}: FormatDiagnosticTaskOptions): string {
	const brand = (brandName || "").trim() || (isZh ? "未命名品牌" : "Brand");
	const rawDate = createdAt || completedAt;
	const timeStr = formatBeijingTime(rawDate, isZh);
	const shortId = getShortRunId(runId, conflictingRunIds);
	const unknownTimeStr = isZh ? "时间未知" : "Time unknown";

	if (isZh) {
		const batchStr = shortId ? `批次${shortId}` : "批次未知";
		if (timeStr === unknownTimeStr) {
			return `${brand}｜时间未知｜${batchStr}`;
		}
		return `${brand}｜${timeStr}（北京时间）｜${batchStr}`;
	}

	const batchStr = shortId ? `Batch ${shortId}` : "Batch unknown";
	if (timeStr === unknownTimeStr) {
		return `${brand} | Time unknown | ${batchStr}`;
	}
	return `${brand} | ${timeStr} (UTC+8) | ${batchStr}`;
}
