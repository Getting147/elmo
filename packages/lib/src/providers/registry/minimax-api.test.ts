import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { stripThinkingBlocks, normalizeM3Output } from "./minimax-api";

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

describe("stripThinkingBlocks", () => {
	it("removes <think>...</think> blocks (qoder-cn review)", () => {
		const input = `<think>Let me think about Haier...</think>{"name":"Haier"}`;
		expect(stripThinkingBlocks(input)).toBe(`{"name":"Haier"}`);
	});

	it("removes multi-line <think> blocks", () => {
		const input = `<think>\nLine 1\nLine 2\nLine 3\n</think>{"name":"X"}`;
		expect(stripThinkingBlocks(input)).toBe(`{"name":"X"}`);
	});

	it("removes markdown ```json fences", () => {
		const input = '```json\n{"name":"Haier"}\n```';
		expect(stripThinkingBlocks(input)).toBe(`{"name":"Haier"}`);
	});

	it("removes both think block and fence in sequence", () => {
		const input = '<think>reasoning</think>```json\n{"name":"H"}\n```';
		expect(stripThinkingBlocks(input)).toBe(`{"name":"H"}`);
	});

	it("returns trimmed plain JSON unchanged", () => {
		expect(stripThinkingBlocks('  {"a":1}  ')).toBe(`{"a":1}`);
	});
});

describe("minimax-api runStructuredResearch with thinking blocks", () => {
	it("parses JSON even when LLM wraps response in <think> blocks", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				model: "MiniMax-M3",
				choices: [
					{
						message: {
							content: '<think>The brand is Haier.</think>{"name":"Haier"}',
						},
						finish_reason: "stop",
					},
				],
			}),
		);
		const { minimaxApi } = await import("./minimax-api");
		const schema = z.object({ name: z.string() });
		const result = await minimaxApi.runStructuredResearch<{ name: string }>({
			prompt: "extract",
			schema,
		});
		expect(result.object).toEqual({ name: "Haier" });
	});

	it("parses JSON even when LLM wraps in ```json fences", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				model: "MiniMax-M3",
				choices: [
					{
						message: {
							content: '```json\n{"name":"Haier"}\n```',
						},
						finish_reason: "stop",
					},
				],
			}),
		);
		const { minimaxApi } = await import("./minimax-api");
		const schema = z.object({ name: z.string() });
		const result = await minimaxApi.runStructuredResearch<{ name: string }>({
			prompt: "extract",
			schema,
		});
		expect(result.object).toEqual({ name: "Haier" });
	});
});

describe("normalizeM3Output (qoder-cn 拍板 B-lite full-coverage)", () => {
	it("fills missing additionalDomains/aliases/competitors with [] (rule 1)", () => {
		const input = { brandName: "Haier" };
		const out = normalizeM3Output(input) as Record<string, unknown>;
		expect(out.additionalDomains).toEqual([]);
		expect(out.aliases).toEqual([]);
		expect(out.competitors).toEqual([]);
		expect(out.brandName).toBe("Haier"); // 已有字段不覆盖（rule 4）
	});

	it("converts string suggestedPrompts items to {prompt, tags: []} (rule 2)", () => {
		const input = { suggestedPrompts: ["prompt A", { prompt: "B" }] };
		const out = normalizeM3Output(input) as { suggestedPrompts: unknown[] };
		expect(out.suggestedPrompts).toEqual([
			{ prompt: "prompt A", tags: [] },
			{ prompt: "B", tags: [] },
		]);
	});

	it("fills sku.model=null + sku.oneLiner='' when missing (rule 3)", () => {
		const input = {
			productLines: [
				{ name: "Air Conditioner", skus: [{ name: "AC-1" }, { name: "AC-2", model: "X1", oneLiner: "best" }] },
			],
		};
		const out = normalizeM3Output(input) as {
			productLines: Array<{ skus: Array<{ name: string; model: unknown; oneLiner: unknown }> }>;
		};
		expect(out.productLines[0].skus[0].model).toBeNull();
		expect(out.productLines[0].skus[0].oneLiner).toBe("");
		expect(out.productLines[0].skus[1].model).toBe("X1"); // 已有不覆盖
		expect(out.productLines[0].skus[1].oneLiner).toBe("best");
	});

	it("does NOT overwrite existing top-level arrays (rule 4 - basic no mutation)", () => {
		const input = { additionalDomains: ["haier.com"], aliases: ["海尔"] };
		const out = normalizeM3Output(input);
		expect(out).toBe(input); // 引用相等（无修改）
	});

	it("normalizes competitor string items to full schema (B-lite rule: competitors[].*)", () => {
		const input = { competitors: ["Midea", { name: "Gree" }, { name: "Hisense", website: "https://hisense.com" }] };
		const out = normalizeM3Output(input) as {
			competitors: Array<{ name: string; website: string; aliases: string[]; additionalDomains: string[]; domains: string[] }>;
		};
		expect(out.competitors[0]).toEqual({ name: "Midea", website: "", aliases: [], additionalDomains: [], domains: [] });
		expect(out.competitors[1]).toEqual({ name: "Gree", website: "", aliases: [], additionalDomains: [], domains: [] });
		expect(out.competitors[2].name).toBe("Hisense");
		expect(out.competitors[2].website).toBe("https://hisense.com");
		expect(out.competitors[2].aliases).toEqual([]);
	});

	it("normalizes productLines[].* full schema (B-lite rule: productLines[].*)", () => {
		const input = {
			productLines: [
				{ skus: [{ model: "X1" }] }, // 缺 name/description/category + sku 缺 name/oneLiner
			],
		};
		const out = normalizeM3Output(input) as {
			productLines: Array<{
				name: string;
				description: string;
				category: string;
				skus: Array<{ name: string; model: unknown; oneLiner: string }>;
			}>;
		};
		expect(out.productLines[0].name).toBe("");
		expect(out.productLines[0].description).toBe("");
		expect(out.productLines[0].category).toBe("");
		expect(out.productLines[0].skus[0].name).toBe("");
		expect(out.productLines[0].skus[0].model).toBe("X1"); // 已有不覆盖
		expect(out.productLines[0].skus[0].oneLiner).toBe("");
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