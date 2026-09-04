/**
 * Epic A-1 品牌档案完整度公式（US-A05）
 *
 * 权重：brand 30% / product_line 40% / credential 30%（设计 v1.1 拍板）
 * 完整定义：
 *   - brand: 1 项（meta.completeness = brand.website 非空 + brand.name 非空 + brand.aliases 非空 + ≥1 competitor）
 *   - product_line: name + differentiators + target_audience 全非空
 *   - credential: ≥1 条 + ≥30% is_third_party_public=true
 *
 * 缺类归一化（防除 0）：
 *   - 三类都存在 → overall = sum(w_i × s_i) / sum(w_i)
 *   - 某类完全缺失（0 行）→ 整体按"现有类的权重和"归一化（分母 = sum(present weights)）
 *   - 全部缺失 → overall = 0（前端提示"数据待补充"）
 *
 * 单测：tests/lib/profile-completeness.test.ts（A1-7 缺类归一化边界 + 公式正确性）
 *
 * 双引用：
 *   - elmo apps/web server fn getProfileCompletenessFn（UI 直接调用）
 *   - elmo apps/web API /api/v1/brands/$brandId/profile/completeness（NegencyGEO 报告层 / 外部集成）
 *
 * 公式常量 W_BRAND / W_PRODUCT_LINE / W_CREDENTIAL 单一来源；任一处变更必须同步两侧。
 */
import { brandProductLines, brandCredentials } from "./db/schema.js";

export const W_BRAND = 0.3;
export const W_PRODUCT_LINE = 0.4;
export const W_CREDENTIAL = 0.3;

/** 三类权重总 = 1.0；缺类归一化时按 present weights 算 */
export const W_TOTAL = W_BRAND + W_PRODUCT_LINE + W_CREDENTIAL;

/** 产品线"完整"判定 = name + differentiators + target_audience 全非空（按设计 v1.1） */
function isProductLineComplete(row: {
	name: string | null;
	differentiators: string | null;
	targetAudience: string | null;
}): boolean {
	return Boolean(row.name && row.differentiators && row.targetAudience);
}

/** 背书"完整"判定 = ≥1 条 + ≥30% 第三方公开（按 re 测试设计 A1-7 口径） */
function isCredentialComplete(rows: Array<{ isThirdPartyPublic: boolean | null }>): boolean {
	if (rows.length === 0) return false;
	const tpCount = rows.filter((r) => r.isThirdPartyPublic === true).length;
	return tpCount / rows.length >= 0.3;
}

/** 品牌"完整"判定（简化版）= name + website 非空 + ≥1 alias + ≥1 competitor */
function isBrandComplete(brand: {
	name: string;
	website: string | null;
	aliases?: string[] | null;
	competitorCount: number;
}): boolean {
	return Boolean(brand.name && brand.website && (brand.aliases?.length ?? 0) > 0 && brand.competitorCount > 0);
}

/** 单类 sub_score ∈ [0, 1] */
export type CompletenessInput = {
	brand: { name: string; website: string | null; aliases?: string[] | null; competitorCount: number };
	productLines: Array<{ name: string | null; differentiators: string | null; targetAudience: string | null }>;
	credentials: Array<{ isThirdPartyPublic: boolean | null }>;
};

export type CompletenessResult = {
	overall: number; // [0, 1]
	brand: number; // [0, 1]
	product_line: number; // [0, 1]
	credential: number; // [0, 1]
	missing: string[]; // 类型名列表（"brand" / "product_line" / "credential"）
};

export function computeCompleteness(input: CompletenessInput): CompletenessResult {
	// 子分（每类按 0/1 判定，简化口径）
	const brandScore = isBrandComplete(input.brand) ? 1 : 0;
	const productLineScore = input.productLines.length > 0
		? input.productLines.filter(isProductLineComplete).length / input.productLines.length
		: 0;
	const credentialScore = isCredentialComplete(input.credentials) ? 1 : 0;

	// 缺类识别：credential 无有效第三方公开背书（0 行或全自证）= 该类缺失
	// （全自证背书对 E-E-A-T 无价值，与 0 行同语义——测试 A1-7 口径）
	const tpCredentialCount = input.credentials.filter(
		(c) => c.isThirdPartyPublic === true,
	).length;
	const missing: string[] = [];
	if (input.brand.competitorCount === 0 && !input.brand.website) missing.push("brand");
	if (input.productLines.length === 0) missing.push("product_line");
	if (input.credentials.length === 0 || tpCredentialCount === 0) missing.push("credential");

	// 缺类归一化：缺失类的权重 = 0；分母 = present weights
	const presentWeights: Array<[number, number]> = [];
	if (!missing.includes("brand")) presentWeights.push([brandScore, W_BRAND]);
	if (!missing.includes("product_line")) presentWeights.push([productLineScore, W_PRODUCT_LINE]);
	if (!missing.includes("credential")) presentWeights.push([credentialScore, W_CREDENTIAL]);

	let overall = 0;
	if (presentWeights.length > 0) {
		const num = presentWeights.reduce((s, [score, w]) => s + score * w, 0);
		const den = presentWeights.reduce((s, [, w]) => s + w, 0);
		overall = den > 0 ? Math.round((num / den) * 100) / 100 : 0;
	}

	return {
		overall,
		brand: brandScore,
		product_line: productLineScore,
		credential: credentialScore,
		missing,
	};
}

/** 是否触发 <60% 提示条（onboarding 软禁门槛） */
export const COMPLETENESS_WARNING_THRESHOLD = 0.6;
export function isCompletenessWarning(overall: number): boolean {
	return overall < COMPLETENESS_WARNING_THRESHOLD;
}

/** 三档提示分级（onboarding 软禁 3 档） */
export type CompletenessTier = "ok" | "warn" | "block";
export function completenessTier(overall: number): CompletenessTier {
	if (overall >= 0.8) return "ok";
	if (overall >= 0.6) return "warn";
	return "block";
}

// Re-export schema types for downstream consumers
export { brandProductLines, brandCredentials };
