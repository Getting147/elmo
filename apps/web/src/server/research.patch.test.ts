/**
 * Epic A-2 M2×M3: updateDraftPayload / applyDraftPayloadPatch 契约测试
 *
 * 覆盖：
 * - 纯 merge：单字段 / 多字段（prompts→suggestedPrompts 映射 / competitors 默认数组）/ productLines confirmed 替换 + unverified 保留
 * - 服务：happy（payload 落库捕获）/ 404（draft 不存在）/ 409（done/failed/rolled_back 各态）
 *
 * 策略：mock @workspace/lib/onboarding（getDraftById）+ db.update chain 捕获 payload。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDraftByIdMock, setMock, whereMock, returningMock } = vi.hoisted(() => {
	const getDraftByIdMock = vi.fn();
	const setMock = vi.fn();
	const whereMock = vi.fn();
	const returningMock = vi.fn();
	return { getDraftByIdMock, setMock, whereMock, returningMock };
});

vi.mock("@workspace/lib/onboarding", () => ({
	analyzeBrand: vi.fn(),
	validateEvidence: vi.fn(),
	createDraft: vi.fn(),
	getDraftById: getDraftByIdMock,
	listDraftsByBrand: vi.fn(),
	markFailed: vi.fn(),
	markRolledBack: vi.fn(),
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: vi.fn() } },
		update: () => ({
			set: (data: unknown) => {
				setMock(data);
				return { where: (condition: unknown) => { whereMock(condition); return { returning: returningMock }; } };
			},
		}),
	},
}));

import { applyDraftPayloadPatch, DraftConflictError, DraftNotFoundError, updateDraftPayload } from "@/server/research";

const BASE_PAYLOAD = {
	brandName: "Haier",
	website: "https://haier.com",
	additionalDomains: ["haier.net"],
	aliases: ["海尔"],
	competitors: [{ name: "Midea", domains: ["midea.com"], aliases: [] }],
	suggestedPrompts: [{ prompt: "best fridge", tags: ["category"] }],
	summary: "old summary",
	description: "old description",
	productLines: {
		confirmed: [
			{
				line: {
					name: "Refrigerators",
					skus: [{ name: "Haier BCD-470", oneLiner: "French door", evidenceUrl: "https://haier.com/fridge" }],
				},
				sourceEvidenceChecked: 1,
			},
		],
		unverified: [
			{
				line: { name: "Robots", skus: [{ name: "X1", oneLiner: "robot", evidenceUrl: "https://haier.com/robot" }] },
				reason: "no evidence",
			},
		],
	},
};

function pendingDraft(payload: unknown = BASE_PAYLOAD) {
	return { id: "d1", brandId: "b1", state: "pending_review", researchStatus: "done", payload };
}

describe("applyDraftPayloadPatch 纯 merge", () => {
	it("moves an explicitly reviewer-marked uncertain role to pending instead of blocking all valid data", () => {
		const line = { name: "待核候选", skus: [], researchEvidence: { kind: "uncertain" as const, evidenceUrl: null, evidenceQuote: null } };
		const result = applyDraftPayloadPatch({ ...BASE_PAYLOAD }, { productLines: [{ line }] });
		const productLines = result.productLines as { confirmed: unknown[]; unverified: { line: unknown; reason: string }[] };
		expect(productLines.confirmed).toEqual([]);
		expect(productLines.unverified.at(-1)?.line).toEqual(line);
		expect(productLines.unverified.at(-1)?.reason).toContain("ROLE_UNCONFIRMED");
		expect(result.suggestedPrompts).toEqual(BASE_PAYLOAD.suggestedPrompts);
	});
	it("单字段 summary → 其余字段全保留", () => {
		const next = applyDraftPayloadPatch({ ...BASE_PAYLOAD }, { summary: "new summary" });
		expect(next.summary).toBe("new summary");
		expect(next.description).toBe("old description");
		expect(next.brandName).toBe("Haier");
		expect(next.competitors).toEqual(BASE_PAYLOAD.competitors);
		expect(next.productLines).toEqual(BASE_PAYLOAD.productLines);
	});

	it("brandName/website 回写（336c9e2）→ 替换原值，其余保留", () => {
		const next = applyDraftPayloadPatch(
			{ ...BASE_PAYLOAD },
			{ brandName: "Haier Smart Home", website: "https://haier-smarthome.com" },
		);
		expect(next.brandName).toBe("Haier Smart Home");
		expect(next.website).toBe("https://haier-smarthome.com");
		expect(next.summary).toBe("old summary");
		expect(next.aliases).toEqual(BASE_PAYLOAD.aliases);
	});

	it("prompts → suggestedPrompts 映射 + tags 默认 []；competitors domains/aliases 默认 []", () => {
		const next = applyDraftPayloadPatch(
			{ ...BASE_PAYLOAD },
			{
				prompts: [{ prompt: "haier vs midea" }],
				competitors: [{ name: "Gree" }],
			},
		);
		expect(next.suggestedPrompts).toEqual([{ prompt: "haier vs midea", tags: [] }]);
		expect(next.competitors).toEqual([{ name: "Gree", domains: [], aliases: [] }]);
		expect(next.summary).toBe("old summary"); // 未传字段保留
	});

	it("B14: prompts patch clears stale generation metadata but keeps model categories and exclusion record", () => {
		const next = applyDraftPayloadPatch(
			{
				...BASE_PAYLOAD,
				suggestedCategories: ["Refrigerators", "Robots"],
				suggestedPromptsMeta: {
					generated: 5,
					kept: 2,
					filteredForBrandOrSku: 1,
					filteredForProprietary: 1,
					unconfirmed: 1,
					skippedDuplicateOrEmpty: 0,
					truncatedByCap: 0,
				},
				suggestedPromptsExcluded: [
					{ prompt: "acme fridge review", targetReference: "brand", reason: "brandOrAlias" },
				],
				termAssessments: [
					{ term: "fridge", kind: "generic", evidenceUrl: null, evidenceQuote: null },
					{ term: "unresolved", kind: false },
				],
				termAssessmentChecks: [
					{ index: 0, term: "fridge", status: "missingSource" },
					{ index: 1, term: "unresolved", status: "invalidStructure" },
				],
			},
			{ prompts: [{ prompt: "buy fridge" }] },
		);

		expect(next.suggestedPromptsMeta).toBeUndefined();
		expect(next.suggestedCategories).toEqual(["Refrigerators", "Robots"]);
		expect(next.suggestedPromptsExcluded).toEqual([
			{ prompt: "acme fridge review", targetReference: "brand", reason: "brandOrAlias" },
		]);
		const restored = JSON.parse(JSON.stringify(next));
		expect(restored.termAssessments).toEqual([
			{ term: "fridge", kind: "generic", evidenceUrl: null, evidenceQuote: null },
			{ term: "unresolved", kind: false },
		]);
		expect(restored.termAssessmentChecks).toEqual([
			{ index: 0, term: "fridge", status: "missingSource" },
			{ index: 1, term: "unresolved", status: "invalidStructure" },
		]);
	});

	it("productLines：confirmed 替换 + evidence→sourceEvidenceChecked 默认 0 + unverified 保留", () => {
		const next = applyDraftPayloadPatch(
			{ ...BASE_PAYLOAD },
			{
				productLines: [
					{
						line: { name: "AC", skus: [{ name: "AC-1", oneLiner: "cool", evidenceUrl: "https://haier.com/ac" }] },
						evidence: 3,
					},
				],
			},
		);
		const pl = next.productLines as typeof BASE_PAYLOAD.productLines;
		expect(pl.confirmed).toEqual([
			{
				line: { name: "AC", skus: [{ name: "AC-1", oneLiner: "cool", evidenceUrl: "https://haier.com/ac" }] },
				sourceEvidenceChecked: 3,
			},
		]);
		expect(pl.unverified).toEqual(BASE_PAYLOAD.productLines.unverified); // LLM 证据不足行不被编辑触碰
	});

	it("空 patch（无字段）→ 原样返回（浅拷贝）", () => {
		const next = applyDraftPayloadPatch({ ...BASE_PAYLOAD }, {});
		expect(next).toEqual(BASE_PAYLOAD);
	});
});

describe("updateDraftPayload 服务", () => {
	beforeEach(() => {
		getDraftByIdMock.mockReset();
		setMock.mockClear();
		whereMock.mockClear();
		returningMock.mockResolvedValue([{ id: "d1" }]);
	});

	it("happy：merge 后 payload 落库 + 返回 {id, state:'pending_review'}", async () => {
		getDraftByIdMock.mockResolvedValue(pendingDraft());
		whereMock.mockResolvedValue(undefined);

		const result = await updateDraftPayload("d1", { summary: "edited" });

		expect(result).toEqual({ id: "d1", state: "pending_review" });
		expect(setMock).toHaveBeenCalledTimes(1);
		const setPayload = setMock.mock.calls[0][0] as { payload: Record<string, unknown> };
		expect(setPayload.payload.summary).toBe("edited");
		expect(setPayload.payload.description).toBe("old description"); // merge 保留
		expect(setPayload.payload.brandName).toBe("Haier");
	});

	it("手算样例 1：原 payload 无 summary/description → PATCH description 只加该字段", async () => {
		getDraftByIdMock.mockResolvedValue(
			pendingDraft({
				brandName: "X",
				website: "https://x.com",
				additionalDomains: [],
				aliases: [],
				competitors: [],
				suggestedPrompts: [],
			}),
		);
		whereMock.mockResolvedValue(undefined);

		await updateDraftPayload("d1", { description: "brand summary" });

		const setPayload = setMock.mock.calls[0][0] as { payload: Record<string, unknown> };
		expect(setPayload.payload.description).toBe("brand summary");
		expect(setPayload.payload.summary).toBeUndefined();
		expect(setPayload.payload.website).toBe("https://x.com");
	});

	it("手算样例 2：productLines 编辑 — 原 2 confirmed 行 → 传 1 行（用户删除 1 行）", async () => {
		const orig = {
			...BASE_PAYLOAD,
			productLines: {
				confirmed: [
					{ line: { name: "Fridges", skus: [] as never[] }, sourceEvidenceChecked: 1 },
					{ line: { name: "AC", skus: [] as never[] }, sourceEvidenceChecked: 0 },
				],
				unverified: [],
			},
		};
		getDraftByIdMock.mockResolvedValue(pendingDraft(orig));
		whereMock.mockResolvedValue(undefined);

		await updateDraftPayload("d1", {
			productLines: [
				{
					line: { name: "AC", skus: [{ name: "AC-9", oneLiner: "9k btu", evidenceUrl: "https://x.com/ac" }] },
					evidence: 2,
				},
			],
		});

		const setPayload = setMock.mock.calls[0][0] as { payload: Record<string, unknown> };
		const pl = setPayload.payload.productLines as {
			confirmed: Array<{ line: { name: string }; sourceEvidenceChecked: number }>;
			unverified: never[];
		};
		expect(pl.confirmed).toHaveLength(1);
		expect(pl.confirmed[0].line.name).toBe("AC");
		expect(pl.confirmed[0].sourceEvidenceChecked).toBe(2);
		expect(pl.unverified).toEqual([]);
	});

	it("404：draft 不存在 → DraftNotFoundError + 不落库", async () => {
		getDraftByIdMock.mockResolvedValue(undefined);
		await expect(updateDraftPayload("missing", { summary: "x" })).rejects.toThrow(DraftNotFoundError);
		expect(setMock).not.toHaveBeenCalled();
	});

	it("rejects edits of running research and reports a lost state race without success", async () => {
		getDraftByIdMock.mockResolvedValue({ ...pendingDraft(), researchStatus: "running" });
		await expect(updateDraftPayload("d1", { summary: "edited" })).rejects.toThrow(DraftConflictError);
		expect(setMock).not.toHaveBeenCalled();
		getDraftByIdMock.mockResolvedValue(pendingDraft());
		returningMock.mockResolvedValue([]);
		await expect(updateDraftPayload("d1", { summary: "edited" })).rejects.toThrow("changed during edit");
	});

	it("keeps sourced no-SKU hierarchy and quote through PATCH and JSON, and rejects edited unsupported names", async () => {
		const sourceUrl = "https://example.invalid/products";
		const quote = "仓储业务下设仓储设备产品线。";
		const line = {
			name: "仓储设备", category: "仓储业务", skus: [],
			researchEvidence: {
				kind: "productLine" as const, evidenceUrl: sourceUrl, evidenceQuote: quote,
				parent: { name: "仓储业务", evidenceUrl: sourceUrl, evidenceQuote: quote },
			},
		};
		getDraftByIdMock.mockResolvedValue(pendingDraft({
			...BASE_PAYLOAD,
			researchDiagnostics: {
				prompts: { status: "complete", message: "合成" },
				sources: { status: "complete", requestCount: 1, maxPages: 6, maxRequestsPerPage: 3,
					pages: [{ url: sourceUrl, finalUrl: sourceUrl, status: "success", fetchedAt: new Date().toISOString(), text: quote, links: [], attempts: [] }] },
			},
			productLines: { confirmed: [{ line, sourceEvidenceChecked: 1 }], unverified: [] },
		}));
		await updateDraftPayload("d1", { productLines: [{ line }] });
		const restored = JSON.parse(JSON.stringify(setMock.mock.calls[0][0].payload));
		expect(restored.productLines.confirmed[0]).toEqual({ line, sourceEvidenceChecked: 1 });
		expect(restored.researchDiagnostics.sources.pages[0].text).toBe(quote);
		setMock.mockClear();
		await expect(updateDraftPayload("d1", { productLines: [{ line: { ...line, name: "无来源名称" } }] })).rejects.toThrow("类别来源待核");
		expect(setMock).not.toHaveBeenCalled();
	});

	it("409：state=done → DraftConflictError(done) + 不落库", async () => {
		getDraftByIdMock.mockResolvedValue({ ...pendingDraft(BASE_PAYLOAD), state: "done" });
		await expect(updateDraftPayload("d1", { summary: "x" })).rejects.toThrow(/state "done"/);
		expect(setMock).not.toHaveBeenCalled();
	});

	it("409：state=failed / rolled_back → DraftConflictError", async () => {
		for (const state of ["failed", "rolled_back"]) {
			getDraftByIdMock.mockResolvedValue({ ...pendingDraft(BASE_PAYLOAD), state });
			await expect(updateDraftPayload("d1", { summary: "x" })).rejects.toThrow(DraftConflictError);
			expect(setMock).not.toHaveBeenCalled();
		}
	});
});
