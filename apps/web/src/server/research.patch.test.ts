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

const { getDraftByIdMock, setMock, whereMock } = vi.hoisted(() => {
	const getDraftByIdMock = vi.fn();
	const setMock = vi.fn();
	const whereMock = vi.fn();
	return { getDraftByIdMock, setMock, whereMock };
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
				return { where: whereMock };
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
