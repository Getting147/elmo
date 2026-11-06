import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, checkBrandAccess } = vi.hoisted(() => ({ getSession: vi.fn(), checkBrandAccess: vi.fn() }));
vi.mock("../server", () => ({ auth: { api: { getSession } } }));
vi.mock("../helpers", () => ({ checkBrandAccess }));

import { checkApiBrandAccess } from "../policies";

beforeEach(() => {
	vi.stubEnv("ADMIN_API_KEYS", "synthetic-admin-api-key");
	getSession.mockReset();
	checkBrandAccess.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("B19 raw research material brand authorization", () => {
	it("preserves explicit global admin API-key access", async () => {
		const request = new Request("http://localhost/api/v1/drafts/fixture", { headers: { Authorization: "Bearer synthetic-admin-api-key" } });
		expect(await checkApiBrandAccess(request, "foreign-brand")).toBe(true);
		expect(getSession).not.toHaveBeenCalled();
		expect(checkBrandAccess).not.toHaveBeenCalled();
	});
	it("requires actual brand membership for cookie-authenticated users", async () => {
		getSession.mockResolvedValue({ user: { id: "fixture-user" } });
		checkBrandAccess.mockImplementation(async (_user: string, brand: string) => brand === "owned-brand");
		const request = new Request("http://localhost/api/v1/drafts/fixture");
		expect(await checkApiBrandAccess(request, "owned-brand")).toBe(true);
		expect(await checkApiBrandAccess(request, "foreign-brand")).toBe(false);
		expect(checkBrandAccess).toHaveBeenCalledWith("fixture-user", "foreign-brand");
	});
	it("does not let an invalid bearer key bypass cookie-user membership", async () => {
		getSession.mockResolvedValue({ user: { id: "fixture-user" } });
		checkBrandAccess.mockResolvedValue(false);
		const request = new Request("http://localhost/api/v1/drafts/fixture", { headers: { Authorization: "Bearer invalid-synthetic-key" } });
		expect(await checkApiBrandAccess(request, "foreign-brand")).toBe(false);
	});
	it("does not authorize a missing session", async () => {
		getSession.mockResolvedValue(null);
		expect(await checkApiBrandAccess(new Request("http://localhost/api/v1/drafts/fixture"), "owned-brand")).toBe(false);
		expect(checkBrandAccess).not.toHaveBeenCalled();
	});
});
