/**
 * P0-3: target market constants shared between API validation, UI selectors, and worker injection.
 *
 * V2 = 海外 7 市场（cn 显式排除）。市场枚举：us/uk/de/fr/jp/ca/au + NULL=不限。
 *
 * 三层语义：
 * - TARGET_MARKETS:    DB TEXT 列 free-form, zod enum 校验层锁定
 * - MARKET_LABELS:     UI 显示 + worker buildInjectedValue 用 (English label for prompt injection)
 * - MARKET_DISPLAY:    UI 下拉用 (本地化标签, 当前 i18n 仅 en; 中文待 V2 扩展)
 */
export const TARGET_MARKETS = ["us", "uk", "de", "fr", "jp", "ca", "au"] as const;
export type TargetMarket = (typeof TARGET_MARKETS)[number];

/** Market → English label (used by worker buildInjectedValue + UI English fallback). */
export const MARKET_LABELS: Record<string, string> = {
	us: "United States",
	uk: "United Kingdom",
	de: "Germany",
	fr: "France",
	jp: "Japan",
	ca: "Canada",
	au: "Australia",
};

/** Display name for the dropdown (localized). V2 仅英文；中文留待 V2 扩展（re M4-3 注意点）。 */
export const MARKET_DISPLAY: Record<string, string> = {
	us: "United States",
	uk: "United Kingdom",
	de: "Germany",
	fr: "France",
	jp: "Japan",
	ca: "Canada",
	au: "Australia",
};

/** 「不限」(NULL) option shown first in dropdowns. */
export const MARKET_UNLIMITED_LABEL = "No specific market (不限)";

/** Prefix template for injected prompt value (kept as a named constant for testability). */
export const BUILD_INJECTED_PREFIX = "For the ";

/**
 * P0-3: Build the actual prompt string sent to provider.
 *
 * - market = NULL → return original value (no prefix, no schema change)
 * - market ∈ {us/uk/de/fr/jp/ca/au} → prefix `For the {label} market: {value}`
 * - market = unknown string → still prefix with the literal value (graceful)
 *
 * prompts.value 库值保持不变（market 是运行时参数不是模板内容）。
 * prompt_runs.injected_value 存注入后完整串供追溯。
 */
export function buildInjectedValue(value: string, market: string | null): string {
	if (!market) return value;
	const label = MARKET_LABELS[market] ?? market;
	return `${BUILD_INJECTED_PREFIX}${label} market: ${value}`;
}
