import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const fetchMock = vi.fn();

beforeEach(() => {
	process.env.MINIMAX_API_KEY = "sk-cp-test-key";
	fetchMock.mockReset();
	// @ts-expect-error -- attach to global for fetch shim
	globalThis.fetch = fetchMock;
});

afterEach(() => {
	vi.restoreAllMocks();
	delete process.env.MINIMAX_API_KEY;
	// @ts-expect-error -- cleanup
	delete globalThis.fetch;
});

function jsonResponse(status: number, body: object | string): Response {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	return new Response(text, {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("minimax-api isConfigured", () => {
	it("returns true when MINIMAX_API_KEY present", async () => {
		const { minimaxApi } = await import("./minimax-api");
		expect(minimaxApi.isConfigured()).toBe(true);
	});

	it("returns false when MINIMAX_API_KEY absent", async () => {
		delete process.env.MINIMAX_API_KEY;
		const { minimaxApi } = await import("./minimax-api");
		expect(minimaxApi.isConfigured()).toBe(false);
	});
});

describe("minimax-api run", () => {
	it("POSTs to https://api.minimaxi.com/v1/chat/completions with Bearer", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				model: "MiniMax-M3",
				choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
			}),
		);
		const { minimaxApi } = await import("./minimax-api");
		const result = await minimaxApi.run("MiniMax-M3", "hi");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.minimaxi.com/v1/chat/completions");
		expect(init.method).toBe("POST");
		expect(init.headers.Authorization).toBe("Bearer sk-cp-test-key");
		expect(JSON.parse(init.body)).toEqual({
			model: "MiniMax-M3",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(result.textContent).toBe("hello");
		expect(result.modelVersion).toBe("MiniMax-M3");
	});

	it("returns empty text + modelVersion fallback when choices empty", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { model: "MiniMax-M3" }));
		const { minimaxApi } = await import("./minimax-api");
		const result = await minimaxApi.run("MiniMax-M3", "x");
		expect(result.textContent).toBe("");
		expect(result.modelVersion).toBe("MiniMax-M3");
	});
});

describe("minimax-api runStructuredResearch", () => {
	it("calls chat with json_object response_format + parses via zod schema", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				model: "MiniMax-M3",
				choices: [{ message: { content: '{"name":"Haier"}' }, finish_reason: "stop" }],
			}),
		);
		const { minimaxApi } = await import("./minimax-api");
		const schema = z.object({ name: z.string() });
		const result = await minimaxApi.runStructuredResearch<{ name: string }>({
			prompt: "extract",
			schema,
		});
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.response_format).toEqual({ type: "json_object" });
		expect(body.model).toBe("MiniMax-M3");
		expect(body.messages[0].role).toBe("system");
		expect(result.object).toEqual({ name: "Haier" });
		expect(result.modelVersion).toBe("MiniMax-M3");
	});

	it("throws when LLM output fails schema validation", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				model: "MiniMax-M3",
				choices: [{ message: { content: '{"missing":"fields"}' }, finish_reason: "stop" }],
			}),
		);
		const { minimaxApi } = await import("./minimax-api");
		const schema = z.object({ name: z.string() });
		await expect(
			minimaxApi.runStructuredResearch({ prompt: "extract", schema }),
		).rejects.toThrow();
	});
});

describe("minimax-api 429 retry", () => {
	it("retries twice on 429 then surfaces error", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(429, "rate limited"))
			.mockResolvedValueOnce(jsonResponse(429, "rate limited"))
			.mockResolvedValueOnce(jsonResponse(429, "rate limited"));
		const { minimaxApi } = await import("./minimax-api");
		await expect(minimaxApi.run("MiniMax-M3", "p")).rejects.toThrow(/MiniMax API error \(429\)/);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	}, 10000);

	it("retries then succeeds on 429-then-200", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(429, "rate limited"))
			.mockResolvedValueOnce(
				jsonResponse(200, {
					model: "MiniMax-M3",
					choices: [{ message: { content: "after-retry" }, finish_reason: "stop" }],
				}),
			);
		const { minimaxApi } = await import("./minimax-api");
		const result = await minimaxApi.run("MiniMax-M3", "p");
		expect(result.textContent).toBe("after-retry");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	}, 10000);

	it("does not retry on 400 (non-retryable status)", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(400, "bad request"));
		const { minimaxApi } = await import("./minimax-api");
		await expect(minimaxApi.run("MiniMax-M3", "p")).rejects.toThrow(/MiniMax API error \(400\)/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not retry on 401 auth error", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(401, "unauthorized"));
		const { minimaxApi } = await import("./minimax-api");
		await expect(minimaxApi.run("MiniMax-M3", "p")).rejects.toThrow(/MiniMax API error \(401\)/);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries on 500 then succeeds", async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(500, "server error"))
			.mockResolvedValueOnce(
				jsonResponse(200, {
					model: "MiniMax-M3",
					choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
				}),
			);
		const { minimaxApi } = await import("./minimax-api");
		const result = await minimaxApi.run("MiniMax-M3", "p");
		expect(result.textContent).toBe("ok");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	}, 10000);
});