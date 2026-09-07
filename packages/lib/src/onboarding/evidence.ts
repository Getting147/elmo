/**
 * Epic A-2 (V1.0): 防幻觉 evidence 校验（独立模块 B-lite）。
 *
 * 设计：D:\NegencyWiki\概念\项目管理\GEO\GEO-V2品牌研究管道-设计-20260906.md v1.0
 * 双层校验：
 *   L1 结构层：evidenceUrl 必填 + 属抓取页集合（normalize 后）
 *   L2 内容层：SKU name grep evidenceUrl 对应页文本（防张冠李戴）
 *
 * normalize 不写在这里 = 入口纯函数，re H1 用例可独立测试（精准入口）。
 */
import { cleanUrl } from "./utils";

export type EvidenceFailureCode = "URL_NOT_IN_CRAWL" | "NAME_NOT_FOUND" | "MISSING_URL";

export interface EvidenceCheckResult {
	ok: boolean;
	code?: EvidenceFailureCode;
}

/**
 * Levenshtein distance with cap (early termination).
 * Returns ≤ maxDist if edit distance within cap, else > maxDist.
 * Used for SKU name "tolerant 1 character" matching (防 OCR / 格式化差异).
 */
function levenshteinAtMost(a: string, b: string, maxDist: number): boolean {
	const m = a.length;
	const n = b.length;
	if (Math.abs(m - n) > maxDist) return false;

	let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
	let curr = new Array<number>(n + 1);
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		let rowMin = curr[0];
		for (let j = 1; j <= n; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
			if (curr[j] < rowMin) rowMin = curr[j];
		}
		if (rowMin > maxDist) return false;
		[prev, curr] = [curr, prev];
	}
	return prev[n] <= maxDist;
}

/**
 * Validate that an SKU's evidence_url + name are supported by the crawled pages.
 *
 * @param args.skuName            The SKU product name (required for L2 content check)
 * @param args.evidenceUrl        The page URL the SKU was sourced from
 * @param args.crawledPageTexts   Map<url, preprocessed text> (lowercase + HTML stripped)
 *
 * @returns ok=true on pass; on failure, code identifies which layer failed:
 *   - MISSING_URL:        evidenceUrl empty / null
 *   - URL_NOT_IN_CRAWL:    evidenceUrl not in crawledPageTexts (after normalize)
 *   - NAME_NOT_FOUND:      SKU name doesn't appear in the page text (tolerance 1 char)
 */
export function validateEvidence(args: {
	skuName: string;
	evidenceUrl: string;
	crawledPageTexts: Map<string, string>;
}): EvidenceCheckResult {
	const { skuName, evidenceUrl, crawledPageTexts } = args;
	if (!evidenceUrl || !evidenceUrl.trim()) {
		return { ok: false, code: "MISSING_URL" };
	}

	// L1 结构层：URL 经 normalize 后属抓取页集合
	const normalized = cleanUrl(evidenceUrl);
	if (!normalized) {
		return { ok: false, code: "MISSING_URL" };
	}
	// crawledPageTexts key 通常是 normalized URL；若 key 与原 URL 共存
	// （历史数据未 normalize），按归一化精确匹配优先 + 原 URL 兜底
	const pageText = crawledPageTexts.get(normalized) ?? crawledPageTexts.get(evidenceUrl);
	if (pageText === undefined) {
		return { ok: false, code: "URL_NOT_IN_CRAWL" };
	}

	// L2 内容层：SKU name 在抓取文本中（容忍 1 字符 OCR/格式化差异）
	if (!skuName || !skuName.trim()) {
		return { ok: false, code: "NAME_NOT_FOUND" };
	}
	const skuLower = skuName.trim().toLowerCase();
	const pageLower = pageText.toLowerCase();

	// 快速路径：精确子串匹配
	if (pageLower.includes(skuLower)) {
		return { ok: true };
	}

	// 慢路径：滑动窗口 + Levenshtein ≤ 1（容忍 1 字符差异）
	// window size = skuLower.length，避免过宽窗口误匹配
	const windowSize = skuLower.length;
	if (windowSize > pageLower.length) {
		return { ok: false, code: "NAME_NOT_FOUND" };
	}
	for (let i = 0; i <= pageLower.length - windowSize; i++) {
		const window = pageLower.substring(i, i + windowSize);
		if (levenshteinAtMost(window, skuLower, 1)) {
			return { ok: true };
		}
	}
	return { ok: false, code: "NAME_NOT_FOUND" };
}
