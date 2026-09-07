/**
 * Epic A-2 (V1.0) M2 c3-endpoint-test: 5 端点契约测试
 *
 * 覆盖分组（re F1/S2/I3 断言收敛）：
 * F1 POST /api/v1/brands/{id}/research
 *   - 合法 body → 200 {draftId, alreadyExisted, jobSkipped} + 参数透传
 *   - website 非法 URL → 400 Validation Error
 *   - 上界越限（maxCompetitors>10 / maxPrompts>50 / maxProducts>20）→ 400
 *   - brand 不存在（BrandNotFoundError）→ 404（mapError 映射）
 * S2 GET /api/v1/brands/{id}/research
 *   - include_all=true/false → listDraftsByBrand 收到对应值；返回 {drafts}
 * I3 GET /api/v1/drafts/{id} + POST confirm/rollback
 *   - GET 存在 → 200 draft 透传
 *   - GET 不存在 → 404
 *   - confirm 成功 → {id}；conflict → 409；draft 不存在 → 404
 *   - rollback 成功 → {rolledBack: true}；conflict → 409；draft 不存在 → 404
 *   - _action 非法值 → 400 Validation Error
 *
 * 策略：vi.mock "@/server/research" 隔离 db/pg-boss；直接调用路由 handler
 * （createApiHandler 路径：auth + zod + error envelope 全走真实代码）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	triggerResearchMock,
	listDraftsByBrandMock,
	getDraftByIdMock,
	confirmDraftMock,
	rollbackDraftMock,
} = vi.hoisted(() => {
	const triggerResearchMock = vi.fn();
	const listDraftsByBrandMock = vi.fn();
	const getDraftByIdMock = vi.fn();
	const confirmDraftMock = vi.fn();
	const rollbackDraftMock = vi.fn();
	return {
		triggerResearchMock,
		listDraftsByBrandMock,
		getDraftByIdMock,
		confirmDraftMock,
		rollbackDraftMock,
	};
});

vi.mock("@/server/research", () => {
	class DraftNotFoundError extends Error {
		constructor(public readonly draftId: string) {
			super(`Draft "${draftId}" not found.`);
			this.name = "DraftNotFoundError";
		}
	}
	class DraftConflictError extends Error {
		constructor(public readonly draftId: string, public readonly state: string) {
			super(`Draft "${draftId}" is in state "${state}" — cannot perform this action.`);
			this.name = "DraftConflictError";
		}
	}
	return {
		triggerResearch: triggerResearchMock,
		listDraftsByBrand: listDraftsByBrandMock,
		getDraftById: getDraftByIdMock,
		confirmDraft: confirmDraftMock,
		rollbackDraft: rollbackDraftMock,
		DraftNotFoundError,
		DraftConflictError,
	};
});

vi.mock("@/server/onboarding-core", () => {
	class BrandNotFoundError extends Error {
		constructor(public readonly brandId: string) {
			super(`Brand "${brandId}" not found.`);
			this.name = "BrandNotFoundError";
		}
	}
	return { BrandNotFoundError };
});

import { Route as ResearchRoute } from "../brands/$brandId/research/index";
import { Route as DraftRoute } from "../drafts/$draftId";

const API_KEY = "test-api-key";
const BASE = "http://localhost/api/v1";

type HandlerCtx = { request: Request; params: Record<string, string> };
type HandlerFn = (ctx: HandlerCtx) => Promise<Response>;

function getHandler(route: unknown, method: "GET" | "POST"): HandlerFn {
	// TanStack file route 的 server handlers 可能在 Route.server 或 Route.options.server
	const r = route as {
		server?: { handlers?: Record<string, HandlerFn> };
		options?: { server?: { handlers?: Record<string, HandlerFn> } };
	};
	const handlers = r.server?.handlers ?? r.options?.server?.handlers;
	const handler = handlers?.[method];
	if (!handler) throw new Error(`handler ${method} missing on route`);
	return handler;
}

function makeRequest(method: string, path: string, body?: unknown): Request {
	const headers = new Headers();
	headers.set("Authorization", `Bearer ${API_KEY}`);
	if (body !== undefined) headers.set("Content-Type", "application/json");
	return new Request(`${BASE}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

describe("F1 POST /api/v1/brands/{id}/research", () => {
	beforeEach(() => {
		vi.stubEnv("ADMIN_API_KEYS", API_KEY);
		triggerResearchMock.mockReset();
		triggerResearchMock.mockResolvedValue({
			draftId: "d_new",
			alreadyExisted: false,
			jobSkipped: false,
		});
	});
	afterEach(() => vi.unstubAllEnvs());

	it("合法 body → 200 + 透传 + 参数传递", async () => {
		const res = await getHandler(ResearchRoute, "POST")({
			request: makeRequest("POST", "/brands/b1/research", {
				website: "https://x.com",
				maxCompetitors: 3,
				maxPrompts: 20,
				maxProducts: 5,
			}),
			params: { brandId: "b1" },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			draftId: "d_new",
			alreadyExisted: false,
			jobSkipped: false,
		});
		expect(triggerResearchMock).toHaveBeenCalledWith({
			brandId: "b1",
			website: "https://x.com",
			maxCompetitors: 3,
			maxPrompts: 20,
			maxProducts: 5,
		});
	});

	it("website 非法 URL → 400 Validation Error", async () => {
		const res = await getHandler(ResearchRoute, "POST")({
			request: makeRequest("POST", "/brands/b1/research", {
				website: "not-a-url",
			}),
			params: { brandId: "b1" },
		});

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; message: string };
		expect(body.error).toBe("Validation Error");
		expect(body.message).toContain("website");
		expect(triggerResearchMock).not.toHaveBeenCalled();
	});

	it("上界越限（maxCompetitors=11）→ 400；=10 边界合法", async () => {
		const over = await getHandler(ResearchRoute, "POST")({
			request: makeRequest("POST", "/brands/b1/research", {
				website: "https://x.com",
				maxCompetitors: 11,
			}),
			params: { brandId: "b1" },
		});
		expect(over.status).toBe(400);

		const boundary = await getHandler(ResearchRoute, "POST")({
			request: makeRequest("POST", "/brands/b1/research", {
				website: "https://x.com",
				maxCompetitors: 10,
			}),
			params: { brandId: "b1" },
		});
		expect(boundary.status).toBe(200);
	});

	it("brand 不存在（BrandNotFoundError）→ 404 Not Found", async () => {
		const { BrandNotFoundError } = await import("@/server/onboarding-core");
		triggerResearchMock.mockRejectedValue(new BrandNotFoundError("ghost"));

		const res = await getHandler(ResearchRoute, "POST")({
			request: makeRequest("POST", "/brands/ghost/research", {
				website: "https://x.com",
			}),
			params: { brandId: "ghost" },
		});

		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Not Found");
	});
});

describe("S2 GET /api/v1/brands/{id}/research — drafts 列表", () => {
	beforeEach(() => {
		vi.stubEnv("ADMIN_API_KEYS", API_KEY);
		listDraftsByBrandMock.mockReset();
		listDraftsByBrandMock.mockResolvedValue([{ id: "d1" }]);
	});
	afterEach(() => vi.unstubAllEnvs());

	it("include_all=true → 传 true + 200 {drafts}", async () => {
		const res = await getHandler(ResearchRoute, "GET")({
			request: makeRequest("GET", "/brands/b1/research?include_all=true"),
			params: { brandId: "b1" },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ drafts: [{ id: "d1" }] });
		expect(listDraftsByBrandMock).toHaveBeenCalledWith("b1", true);
	});

	it("无 include_all → 传 false", async () => {
		const res = await getHandler(ResearchRoute, "GET")({
			request: makeRequest("GET", "/brands/b1/research"),
			params: { brandId: "b1" },
		});

		expect(res.status).toBe(200);
		expect(listDraftsByBrandMock).toHaveBeenCalledWith("b1", false);
	});
});

describe("I3 /api/v1/drafts/{id} — GET + confirm/rollback 状态机", () => {
	beforeEach(() => {
		vi.stubEnv("ADMIN_API_KEYS", API_KEY);
		getDraftByIdMock.mockReset();
		confirmDraftMock.mockReset();
		rollbackDraftMock.mockReset();
		getDraftByIdMock.mockResolvedValue({ id: "d1", state: "pending_review" });
		confirmDraftMock.mockResolvedValue({ id: "d1" });
		rollbackDraftMock.mockResolvedValue(undefined);
	});
	afterEach(() => vi.unstubAllEnvs());

	it("GET 存在 → 200 draft 透传", async () => {
		const res = await getHandler(DraftRoute, "GET")({
			request: makeRequest("GET", "/drafts/d1"),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "d1", state: "pending_review" });
	});

	it("GET 不存在 → 404", async () => {
		getDraftByIdMock.mockResolvedValue(undefined);
		const res = await getHandler(DraftRoute, "GET")({
			request: makeRequest("GET", "/drafts/missing"),
			params: { draftId: "missing" },
		});
		expect(res.status).toBe(404);
	});

	it("confirm 成功 → 200 {id}", async () => {
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/d1", { _action: "confirm" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: "d1" });
		expect(confirmDraftMock).toHaveBeenCalledWith("d1");
	});

	it("confirm conflict → 409", async () => {
		const { DraftConflictError } = await import("@/server/research");
		confirmDraftMock.mockRejectedValue(new DraftConflictError("d1", "done"));
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/d1", { _action: "confirm" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(409);
	});

	it("confirm draft 不存在 → 404（mapError 映射）", async () => {
		const { DraftNotFoundError } = await import("@/server/research");
		confirmDraftMock.mockRejectedValue(new DraftNotFoundError("missing"));
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/missing", { _action: "confirm" }),
			params: { draftId: "missing" },
		});
		expect(res.status).toBe(404);
	});

	it("rollback 成功 → 200 {rolledBack: true}", async () => {
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/d1", { _action: "rollback" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ rolledBack: true });
		expect(rollbackDraftMock).toHaveBeenCalledWith("d1");
	});

	it("rollback conflict（非 pending_review）→ 409", async () => {
		const { DraftConflictError } = await import("@/server/research");
		rollbackDraftMock.mockRejectedValue(new DraftConflictError("d1", "done"));
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/d1", { _action: "rollback" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(409);
	});

	it("rollback draft 不存在 → 404", async () => {
		const { DraftNotFoundError } = await import("@/server/research");
		rollbackDraftMock.mockRejectedValue(new DraftNotFoundError("missing"));
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/missing", { _action: "rollback" }),
			params: { draftId: "missing" },
		});
		expect(res.status).toBe(404);
	});

	it("_action 非法值 → 400 Validation Error", async () => {
		const res = await getHandler(DraftRoute, "POST")({
			request: makeRequest("POST", "/drafts/d1", { _action: "delete" }),
			params: { draftId: "d1" },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("Validation Error");
		expect(confirmDraftMock).not.toHaveBeenCalled();
		expect(rollbackDraftMock).not.toHaveBeenCalled();
	});
});
