/**
 * Epic A-2 (V1.0) M2 c3-fix: 纯函数工具层（零 drizzle 依赖）
 *
 * 抽 3 个纯函数到这里供测试 import，避开 elmo 工作区 unresolved
 * drizzle-orm 模块缺失导致测试 import draft-research.ts 时 cascade 失败。
 *
 * 行为与原 draft-research.ts 一致 — test mirror Blocker 修：测试用真实实现
 * 而非复制粘贴。
 *
 * 真实 cleanUrl 语义（onboarding/utils.ts:15）：保留 path/query/fragment/尾斜杠。
 * → hashUrlForDraft 幂等键 = cleanUrl 全串 hash；
 * → 同一 website URL 重跑命中同 hash；不同 path 视为不同研究。
 */
import { cleanUrl } from "./utils";

export { cleanUrl };

export const DEFAULT_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Hash URL for draft idempotency key.
 * SHA-256(cleanUrl(website)) 前 16 hex 字符。
 *
 * 真实 cleanUrl 保留 path/query/fragment/尾斜杠 → 不同 path = 不同 hash（新研究）；
 * 同 URL 重跑命中 partial unique 唯一索引（幂等成立）。
 */
export function hashUrlForDraft(website: string): string {
	const normalized = cleanUrl(website);
	if (!normalized) {
		throw new Error(`Cannot normalize website for hash: "${website}"`);
	}
	return computeHash(normalized);
}

/** Compute expires_at = now + TTL. V1 默认 30 天。 */
export function computeExpiresAt(ttlMs: number = DEFAULT_DRAFT_TTL_MS): Date {
	return new Date(Date.now() + ttlMs);
}

// ------------------------------------------------------------------
// Internal helpers (not re-exported)
// ------------------------------------------------------------------

/** SHA-256 hex 前 16 字符 */
function computeHash(input: string): string {
	// Lazy import crypto（Node 22 内置）— 不污染 top-level import graph
	// 测试可在无 Node env 时仅 import 函数本体（hashUrlForDraft 已测真实 cleanUrl 路径）
	const { createHash } = require("node:crypto") as typeof import("node:crypto");
	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
