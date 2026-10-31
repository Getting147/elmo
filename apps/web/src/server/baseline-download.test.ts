import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getAuthSession: vi.fn(),
	requireOrgAccess: vi.fn(),
	getBrandAndOrg: vi.fn(),
	getBaselineConfig: vi.fn(),
}));

vi.mock("@/lib/auth/helpers", () => ({
	getAuthSession: mocks.getAuthSession,
	requireOrgAccess: mocks.requireOrgAccess,
}));
vi.mock("@/server/baseline.server", () => ({
	getBrandAndOrg: mocks.getBrandAndOrg,
	getBaselineConfig: mocks.getBaselineConfig,
}));
vi.mock("@/server/baseline-identity", () => ({
	baselineIdentityHeaders: () => ({}),
}));

import { Route } from "../routes/api/baseline/download";

type DownloadHandler = (args: { request: Request }) => Promise<Response>;
const handler = (Route.options.server as unknown as { handlers: { GET: DownloadHandler } }).handlers.GET;
const request = new Request(
	"http://localhost/api/baseline/download?reportId=rpt_run_test&revisionId=rev_01&brandId=ALPHA&format=pdf",
);

describe("baseline artifact download proxy", () => {
	beforeEach(() => {
		mocks.getAuthSession.mockResolvedValue({ user: { id: "usr_test" } });
		mocks.requireOrgAccess.mockResolvedValue(undefined);
		mocks.getBrandAndOrg.mockResolvedValue({ organizationId: "org_alpha" });
		mocks.getBaselineConfig.mockReturnValue({ apiUrl: "http://baseline.test", serviceToken: "local-test-token" });
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.unstubAllGlobals();
	});

	it("returns a non-empty PDF with the upstream filename", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
					status: 200,
					headers: {
						"Content-Type": "application/pdf",
						"Content-Disposition": 'attachment; filename="Alpha_rev_01.pdf"',
					},
				}),
			),
		);

		const response = await handler({ request });
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/pdf");
		expect(response.headers.get("Content-Disposition")).toContain("Alpha_rev_01.pdf");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
	});

	it("rejects a successful upstream response with the wrong artifact MIME", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ error: "not_ready" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);

		const response = await handler({ request });
		expect(response.status).toBe(502);
		expect((await response.json()).error).toBe("invalid_artifact_response");
		expect(response.headers.get("Content-Disposition")).toBeNull();
	});

	it("rejects an empty artifact", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { "Content-Type": "application/pdf" } })),
		);

		const response = await handler({ request });
		expect(response.status).toBe(502);
		expect((await response.json()).error).toBe("empty_artifact");
	});

	it("preserves upstream failure status without a download disposition", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ error: "artifact_not_found", message: "尚未完成渲染" }), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);

		const response = await handler({ request });
		expect(response.status).toBe(404);
		expect((await response.json()).error).toBe("artifact_not_found");
		expect(response.headers.get("Content-Disposition")).toBeNull();
	});

	it("does not call the backend without a session", async () => {
		mocks.getAuthSession.mockResolvedValue(null);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await handler({ request });
		expect(response.status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps organization denial as a 403", async () => {
		mocks.requireOrgAccess.mockRejectedValue(new Error("wrong tenant"));
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await handler({ request });
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
