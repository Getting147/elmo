import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
	deepseekApi,
	getDeepSeekApiKey,
	getDeepSeekBaseUrl,
	getDeepSeekModel,
	normalizeDeepSeekOutput,
	stripThinkingBlocks,
} from "./deepseek-api";

const fetchMock = vi.fn();

beforeEach(() => {
	process.env.DEEPSEEK_API_KEY = "sk-ds-test-key";
	delete process.env.LLM_API_KEY;
	fetchMock.mockReset();
	(globalThis as any).fetch = fetchMock;
});

afterEach(() => {
	vi.restoreAllMocks();
	delete process.env.DEEPSEEK_API_KEY;
	delete process.env.LLM_API_KEY;
	delete process.env.DEEPSEEK_BASE_URL;
	delete process.env.LLM_BASE_URL;
	delete process.env.DEEPSEEK_MODEL;
	delete process.env.LLM_MODEL;
	delete (globalThis as any).fetch;
});

function jsonResponse(status: number, body: object | string): Response {
	const text = typeof body === "string" ? body : JSON.stringify(body);
	return new Response(text, {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("deepseek-api isConfigured & credentials", () => {
	it("returns true when DEEPSEEK_API_KEY is present", () => {
		expect(deepseekApi.isConfigured()).toBe(true);
		expect(getDeepSeekApiKey()).toBe("sk-ds-test-key");
	});

	it("returns true when fallback LLM_API_KEY is present", () => {
		delete process.env.DEEPSEEK_API_KEY;
		process.env.LLM_API_KEY = "sk-llm-fallback-key";
		expect(deepseekApi.isConfigured()).toBe(true);
		expect(getDeepSeekApiKey()).toBe("sk-llm-fallback-key");
	});

	it("returns false when both keys are absent", () => {
		delete process.env.DEEPSEEK_API_KEY;
		delete process.env.LLM_API_KEY;
		expect(deepseekApi.isConfigured()).toBe(false);
		expect(getDeepSeekApiKey()).toBeUndefined();
	});

	it("resolves endpoint and model correctly", () => {
		expect(getDeepSeekBaseUrl()).toBe("https://api.deepseek.com");
		expect(getDeepSeekModel()).toBe("deepseek-chat");

		process.env.DEEPSEEK_BASE_URL = "https://custom.deepseek.proxy/v1/";
		expect(getDeepSeekBaseUrl()).toBe("https://custom.deepseek.proxy/v1");

		process.env.DEEPSEEK_MODEL = "deepseek-reasoner";
		expect(getDeepSeekModel()).toBe("deepseek-reasoner");
	});
});

describe("deepseek-api stripThinkingBlocks", () => {
	it("removes <think>...</think> blocks", () => {
		const raw = `<think>Analysis of company...</think>{"brandName":"SZJGFW"}`;
		expect(stripThinkingBlocks(raw)).toBe(`{"brandName":"SZJGFW"}`);
	});

	it("removes multi-line <think> blocks and code fences", () => {
		const raw = `\`\`\`json\n<think>\nline 1\nline 2\n</think>\n{"brandName":"Test"}\n\`\`\``;
		expect(stripThinkingBlocks(raw)).toBe(`{"brandName":"Test"}`);
	});
});

describe("deepseek-api normalizeDeepSeekOutput", () => {
	it("fills default arrays when omitted by LLM", () => {
		const normalized = normalizeDeepSeekOutput({
			brandName: "Acme",
		}) as any;
		expect(normalized.brandName).toBe("Acme");
		expect(normalized.additionalDomains).toEqual([]);
		expect(normalized.aliases).toEqual([]);
		expect(normalized.competitors).toEqual([]);
	});

	it("normalizes competitor objects", () => {
		const normalized = normalizeDeepSeekOutput({
			competitors: ["CompetitorA", { name: "CompetitorB" }],
		}) as any;
		expect(normalized.competitors[0].name).toBe("CompetitorA");
		expect(normalized.competitors[0].domains).toEqual([]);
		expect(normalized.competitors[1].name).toBe("CompetitorB");
		expect(normalized.competitors[1].aliases).toEqual([]);
	});

	it("normalizes suggestedPrompts and productLines", () => {
		const normalized = normalizeDeepSeekOutput({
			suggestedPrompts: ["Best light steel house", { prompt: "Prefab villa cost" }],
			productLines: [{ name: "Light Steel Villa", skus: [{ name: "Model A" }] }],
		}) as any;
		expect(normalized.suggestedPrompts[0]).toEqual({ prompt: "Best light steel house", tags: [] });
		expect(normalized.suggestedPrompts[1]).toEqual({ prompt: "Prefab villa cost", tags: [] });
		expect(normalized.productLines[0].skus[0].model).toBeNull();
		expect(normalized.productLines[0].skus[0].oneLiner).toBe("");
	});
});

describe("deepseek-api runStructuredResearch", () => {
	it("calls chat completions with json_object format and parses via Zod schema", async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, {
				model: "deepseek-chat",
				choices: [
					{
						message: {
							content: `<think>Reasoning...</think>{"brandName":"精工建轻钢","website":"http://www.szjgfw.com"}`,
						},
						finish_reason: "stop",
					},
				],
			}),
		);

		const schema = z.object({
			brandName: z.string(),
			website: z.string(),
			competitors: z.array(z.any()).default([]),
		});

		const result = await deepseekApi.runStructuredResearch?.({
			prompt: "Analyze szjgfw",
			schema,
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.deepseek.com/chat/completions");
		expect(init.method).toBe("POST");
		expect(init.headers.Authorization).toBe("Bearer sk-ds-test-key");

		const body = JSON.parse(init.body);
		expect(body.model).toBe("deepseek-chat");
		expect(body.response_format).toEqual({ type: "json_object" });
		expect(body.messages[0].role).toBe("system");
		expect(result.object.brandName).toBe("精工建轻钢");
	});

	it("throws explicit error when API returns HTTP 401 (no fallback)", async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Authentication Fails" }));

		const schema = z.object({ brandName: z.string() });
		await expect(deepseekApi.runStructuredResearch?.({ prompt: "test", schema })).rejects.toThrow(
			"DeepSeek API error (401)",
		);
	});

	it("throws explicit error when API Key is missing", async () => {
		delete process.env.DEEPSEEK_API_KEY;
		delete process.env.LLM_API_KEY;

		const schema = z.object({ brandName: z.string() });
		await expect(deepseekApi.runStructuredResearch?.({ prompt: "test", schema })).rejects.toThrow(
			"DeepSeek API Key 未配置",
		);
	});
});
