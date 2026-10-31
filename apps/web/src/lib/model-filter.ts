/**
 * Pure helpers for building the model filter dropdown options and
 * validating model/date support boundaries.
 */

export const ALL_MODELS_VALUE = "all";

export const UNSUPPORTED_MODEL_MESSAGE_ZH = "目前仅支持豆包，其他模型暂不支持。";
export const UNSUPPORTED_MODEL_MESSAGE_EN = "Currently, only Doubao is supported. Other models are not supported yet.";

/**
 * Check if a model name corresponds to a supported Doubao model (case-insensitive).
 */
export function isDoubaoModel(modelName?: string | null): boolean {
	if (!modelName) return false;
	const normalized = modelName.trim().toLowerCase();
	return (
		normalized.includes("doubao") ||
		normalized === "ark" ||
		normalized.startsWith("ark-") ||
		normalized.startsWith("ark_") ||
		normalized.startsWith("volcengine") ||
		normalized.startsWith("volces")
	);
}

/**
 * Returns true if an explicit non-Doubao model is requested.
 * Returns false when model is unspecified, 'all', or a Doubao variant.
 */
export function isUnsupportedBaselineModel(model?: string | null): boolean {
	if (!model) return false;
	const normalized = model.trim().toLowerCase();
	if (normalized === ALL_MODELS_VALUE || normalized === "all" || normalized === "") {
		return false;
	}
	return !isDoubaoModel(normalized);
}

/**
 * Check if a selected model filter matches the actual run's model.
 * Returns true if no filter is specified, 'all', or if the filter matches the run model.
 */
export function isModelMatch(filterModel?: string | null, runModel?: string | null): boolean {
	if (!filterModel) return true;
	const normFilter = filterModel.trim().toLowerCase();
	if (normFilter === ALL_MODELS_VALUE || normFilter === "all" || normFilter === "") {
		return true;
	}
	if (!runModel) return false;
	const normRun = runModel.trim().toLowerCase();
	return normFilter === normRun || (normFilter === "doubao" && isDoubaoModel(normRun));
}

/**
 * Pure helper to verify if a run date falls within the selected lookback period.
 */
export function isRunWithinLookback(
	runDate: string | Date | undefined | null,
	lookback: string | undefined | null,
	referenceDate: Date = new Date(),
): boolean {
	if (!lookback || lookback === "all") return true;
	if (!runDate) return true;
	const d = typeof runDate === "string" ? new Date(runDate) : runDate;
	if (isNaN(d.getTime())) return true;

	const days =
		lookback === "1w" ? 7 :
		lookback === "1m" ? 30 :
		lookback === "3m" ? 90 :
		lookback === "6m" ? 180 :
		lookback === "1y" ? 365 :
		Number.POSITIVE_INFINITY;

	if (days === Number.POSITIVE_INFINITY) return true;

	const cutoff = new Date(referenceDate.getTime() - days * 24 * 60 * 60 * 1000);
	return d >= cutoff;
}

/** Build the dropdown option list from the brand's effective models.
 *  The server resolves `brand.enabledModels` against `SCRAPE_TARGETS`
 *  and hands us the list the brand actually runs — we just layer
 *  "All" on top when there's more than one option. A single-model
 *  brand gets no "all" entry since the filter is redundant (callers
 *  hide the dropdown entirely). */
export function getAvailableModels(effectiveModels: readonly string[]): string[] {
	return effectiveModels.length > 1 ? [ALL_MODELS_VALUE, ...effectiveModels] : [...effectiveModels];
}
