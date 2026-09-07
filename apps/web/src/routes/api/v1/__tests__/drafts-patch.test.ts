/**
 * Epic A-2 M2×M3: PATCH /api/v1/drafts/{id} 端点契约测试
 *
 * 覆盖：
 * - 合法 body（全字段）→ 200 + updateDraftPayload 收到解析后 body
 * - 空 body → 400（refine 至少一个字段）
 * - 结构非法（productLines sku 缺 evidenceUrl / competitors name 空）→ 400
 * - 404（DraftNotFoundError 映射）/ 409（DraftConflictError 映射，非 pending_review 不可编辑）
 *
 * 策略：vi.mock @/server/research；直调路由 PATCH handler（auth + zod + error envelope 真实路径）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateDraftPayloadMock } = vi.hoisted(() => {
	const updateDraftPayloadMock = vi.fn();
	return { updateDraftPayloadMock };
});

vi.mock("@/server/research", () => {
	class DraftNotFoundError extends Error {
		constructor(public readonly draftId: string) {
			super(`Draft "${draftId}" not found.`);
			this.name = "DraftNotFoundError";
		}
	}
	class DraftConflictError extends Error {
		constructor(
			public readonly draftId: string,
			public readonly state: string,
		) {
			super(`Draft "${draftId}" is in state "${state}" — cannot perform this action.`);
			this.name = "DraftConflictError";
		}
	}
	return {
		confirmDraft: vi.fn(),
		rollbackDraft: vi.fn(),
		getDraftById: vi.fn(),
		updateDraftPayload: updateDraftPayloadMock,
		DraftNotFoundError,
		DraftConflictError,
	};
});

import { Route as DraftRoute } from "../drafts/$draftId";

const API_KEY = "test-api-key";
const BASE = "http://localhost/api/v1";

type HandlerCtx = { request: Request; params: Record<string, string> };
type HandlerFn = (ctx: HandlerCtx) => Promise<Response>;

function patchHandler(): HandlerFn {
	const route = DraftRoute as {
		options?: { server?: { handlers?: Record<string, HandlerFn> } };
	};
	const handler = route.options?.server?.handlers?.PATCH;
	if (!handler) throw new Error("handler PATCH missing on route");
	return handler;
}

function makePatchRequest(body: unknown): Request {
	return new Request(`${BASE}/drafts/d1`, {
		method: "PATCH",
		headers: new Headers({
			Authorization: `Bearer ${API_KEY}`,
			"Content-Type": "application/json",
		}),
		body: JSON.stringify(body),
	});
}

const FULL_BODY = {
	summary: "new summary",
	description: "new description",
	aliases: ["Haier", "海尔"],
	additionalDomains: ["haier-eu.com"],
	competitors: [{ name: "Gree", domains: ["gree.com"], aliases: ["格力"] }],
	prompts: [{ prompt: "best fridge brand", tags: ["category"] }],
	productLines: [
		{
			line: {
				name: "AC",
				skus: [{ name: "AC-9", model: "9K", oneLiner: "9k btu", evidenceUrl: "https://haier.com/ac" }],
			},
			evidence: 2,
		},
	],
};

describe("PATCH /api/v1/drafts/{id} — payload 回写", () => {
	beforeEach(() => {
		vi.stubEnv("ADMIN_API_KEYS", API_KEY);
		updateDraftPayloadMock.mockReset();
		updateDraftPayloadMock.mockResolvedValue({ id: "d1", state: "pending_review" });
	});
	afterEach(() => vi.unstubAllEnvs());

	it("全字段合法 body → 200 + 透传 + 原样传参", async () => {
		const res = await patchHandler()({
			request: makePatchRequest(FULL_BODY),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "d1", state: "pending_review" });
		expect(updateDraftPayloadMock).toHaveBeenCalledWith("d1", FULL_BODY);
	});

	it("单字段 PATCH（summary）→ 200 + 只传该字段", async () => {
		const res = await patchHandler()({
			request: makePatchRequest({ summary: "only summary" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(200);
		expect(updateDraftPayloadMock).toHaveBeenCalledWith("d1", { summary: "only summary" });
	});

	it("空 body {} → 400（至少一个可编辑字段）", async () => {
		const res = await patchHandler()({
			request: makePatchRequest({}),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe("Validation Error");
		expect(body.message).toContain("At least one editable field");
		expect(updateDraftPayloadMock).not.toHaveBeenCalled();
	});

	it("productLines sku 缺 evidenceUrl → 400", async () => {
		const res = await patchHandler()({
			request: makePatchRequest({
				productLines: [{ line: { name: "AC", skus: [{ name: "AC-9", oneLiner: "cool" }] } }],
			}),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(400);
		expect(updateDraftPayloadMock).not.toHaveBeenCalled();
	});

	it("competitors name 空串 → 400", async () => {
		const res = await patchHandler()({
			request: makePatchRequest({ competitors: [{ name: "  " }] }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(400);
		expect(updateDraftPayloadMock).not.toHaveBeenCalled();
	});

	it("draft 不存在 → 404", async () => {
		const { DraftNotFoundError } = await import("@/server/research");
		updateDraftPayloadMock.mockRejectedValue(new DraftNotFoundError("missing"));
		const res = await patchHandler()({
			request: makePatchRequest({ summary: "x" }),
			params: { draftId: "missing" },
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Not Found");
	});

	it("非 pending_review（done）→ 409", async () => {
		const { DraftConflictError } = await import("@/server/research");
		updateDraftPayloadMock.mockRejectedValue(new DraftConflictError("d1", "done"));
		const res = await patchHandler()({
			request: makePatchRequest({ summary: "x" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe("Conflict");
		expect(body.message).toContain("only pending_review is editable");
	});
});
