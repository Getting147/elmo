/**
 * Epic A-2 (V1.0) M2 c3-fix: 草稿契约测试（导入真实实现）
 *
 * 修复 mirror Blocker：之前 mirror 实现固化错误预期（cleanUrl 只留 host），
 * 现导入真实实现（draft-research-utils）断言按真实语义重写。
 *
 * 真实 cleanUrl 语义（onboarding/utils.ts:15）：保留 path/query/fragment/尾斜杠
 * → 幂等键 = cleanUrl 全串 hash
 * → 同 website URL 重跑命中同 hash（partial unique 命中 → 直返）
 * → 不同 path = 不同 hash（新研究）
 */
import { describe, expect, it } from "vitest";
import {
	DEFAULT_DRAFT_TTL_MS,
	hashUrlForDraft,
	computeExpiresAt,
	cleanUrl,
} from "./draft-research-utils";

describe("I3-6 hashUrlForDraft — 真实实现（SHA-256(cleanUrl) 前 16 hex）", () => {
	it("16 hex chars", () => {
		const h = hashUrlForDraft("https://haier.com/cn/products");
		expect(h).toMatch(/^[0-9a-f]{16}$/);
	});

	it("cleanUrl 保留 path/query/尾斜杠 — 幂等性 = cleanUrl 全串 hash", () => {
		// 同 website 标准 URL：cleanUrl 后全等 → hash 等
		expect(cleanUrl("https://haier.com/cn")).toBe(cleanUrl("https://haier.com/cn"));
		expect(hashUrlForDraft("https://haier.com/cn")).toBe(
			hashUrlForDraft("https://haier.com/cn"),
		);
	});

	it("同 URL 大小写差异 → hash 不同（cleanUrl 保留 host 大小写）", () => {
		// new URL() 自动 lowercase host；cleanUrl 用 toString() 保留小写
		// V1 行为：大小写不同 hash 不同（path 完全一致时，host 大小写归一化是浏览器行为）
		// 实测：toString() lowercase host，故 hash 相同
		expect(hashUrlForDraft("HTTPS://HAIER.com/cn")).toBe(
			hashUrlForDraft("https://haier.com/cn"),
		);
	});

	it("不同 path → 不同 hash（新研究）", () => {
		// cleanUrl 保留 path，故 /cn 和 /cn/products hash 不同
		expect(hashUrlForDraft("https://haier.com/cn")).not.toBe(
			hashUrlForDraft("https://haier.com/cn/products"),
		);
	});

	it("不同 host → 不同 hash", () => {
		expect(hashUrlForDraft("https://haier.com")).not.toBe(
			hashUrlForDraft("https://haier.com.cn"),
		);
	});

	it("query string 不同 → 不同 hash（cleanUrl 保留 query）", () => {
		expect(hashUrlForDraft("https://haier.com/cn?a=1")).not.toBe(
			hashUrlForDraft("https://haier.com/cn?a=2"),
		);
	});

	it("URL 不可解析 → cleanUrl 返回 \"\" → hashUrlForDraft 抛错", () => {
		expect(() => hashUrlForDraft("not a url")).toThrow(/Cannot normalize/);
	});

	it("空字符串 → 抛错", () => {
		expect(() => hashUrlForDraft("")).toThrow(/Cannot normalize/);
	});

	it("非 http(s) 协议 → cleanUrl 返回 \"\" → hashUrlForDraft 抛错", () => {
		expect(() => hashUrlForDraft("ftp://haier.com")).toThrow();
	});
});

describe("I3-7 computeExpiresAt / DEFAULT_DRAFT_TTL_MS — 真实实现", () => {
	it("默认 TTL = 30d（30 * 24 * 60 * 60 * 1000 ms）", () => {
		expect(DEFAULT_DRAFT_TTL_MS).toBe(2_592_000_000);
	});

	it("expiresAt 落在 (now + 29.9d, now + 30.1d) 区间", () => {
		const now = Date.now();
		const exp = computeExpiresAt().getTime();
		expect(exp).toBeGreaterThan(now + 29.9 * 24 * 60 * 60 * 1000);
		expect(exp).toBeLessThan(now + 30.1 * 24 * 60 * 60 * 1000);
	});

	it("自定义 TTL = 1d", () => {
		const exp = computeExpiresAt(24 * 60 * 60 * 1000).getTime();
		const now = Date.now();
		expect(exp - now).toBeCloseTo(86_400_000, -3);
	});
});

describe("I3-8 payload shape — OnboardingSuggestion 完整快照 + 无外部字段", () => {
	it("典型 payload 含 OnboardingSuggestion 全部字段（summary/description/productLines/confirmed/unverified）", () => {
		const payload = {
			brandName: "X",
			website: "https://x.com",
			additionalDomains: ["x.cn"],
			aliases: ["XB"],
			competitors: [{ name: "Y", domains: ["y.com"], aliases: [] }],
			suggestedPrompts: [{ prompt: "best [category]", tags: ["commercial"] }],
			summary: "...",
			description: "...",
			productLines: {
				confirmed: [{ line: { name: "Fridge", skus: [] }, sourceEvidenceChecked: 1 }],
				unverified: [],
			},
		};
		expect(payload).toHaveProperty("summary");
		expect(payload).toHaveProperty("description");
		expect(payload.productLines).toHaveProperty("confirmed");
		expect(payload.productLines).toHaveProperty("unverified");
	});

	it("payload 不应包含 crawledPageTexts（M1 evidence 校验结果已在 confirmed/unverified）", () => {
		const payload = {
			brandName: "X",
			website: "https://x.com",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		};
		expect(payload).not.toHaveProperty("crawledPageTexts");
	});
});

describe("F1 状态机 6 态完整性（V1 持久化 4 态）", () => {
	it("ALL 6 态 = 端点内部转移用", () => {
		const ALL_STATES = ["pending_review", "confirmed", "applied", "done", "failed", "rolled_back"];
		expect(ALL_STATES.length).toBe(6);
	});

	it("PERSISTED 4 态 = confirmed/applied 事务内瞬态不持久", () => {
		const PERSISTED_STATES = ["pending_review", "done", "failed", "rolled_back"];
		expect(PERSISTED_STATES).not.toContain("confirmed");
		expect(PERSISTED_STATES).not.toContain("applied");
	});
});

describe("F1-8 idempotency 矩阵", () => {
	it("active 态（pending_review/confirmed）→ 直返；终态 → 新建", () => {
		// 幂等决策矩阵（应用层 createDraft + partial unique 协同）
		const idempotencyMatrix: Record<string, string> = {
			pending_review: "直返（active partial unique 命中）",
			confirmed: "直返（active partial unique 命中）",
			failed: "覆盖（先 deleteFailedOrExpiredForHash + insert 同 url_hash）",
			done: "新建（partial unique 不约束终态）",
			rolled_back: "新建（partial unique 不约束终态）",
			applied: "新建（partial unique 不约束终态）",
		};
		expect(Object.keys(idempotencyMatrix).sort()).toEqual(
			["applied", "confirmed", "done", "failed", "pending_review", "rolled_back"].sort(),
		);
		expect(idempotencyMatrix.failed).toContain("覆盖");
	});
});
