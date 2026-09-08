import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aiMock = vi.hoisted(() => ({ generateText: vi.fn() }));
const openaiCompatibleMock = vi.hoisted(() => ({
	model: vi.fn(() => "mock-minimax-model"),
}));

vi.mock("ai", () => ({
	generateText: aiMock.generateText,
	Output: { object: vi.fn(() => ({ __isOutputObject: true })) },
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: vi.fn(() => openaiCompatibleMock.model),
}));

import { minimaxApi } from "./minimax-api";

beforeEach(() => {
	process.env.MINIMAX_API_KEY = "sk-cp-test-key";
	aiMock.generateText.mockReset();
	aiMock.generateText.mockResolvedValue({
 text: "hello", finishReason: "stop" });
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
	delete process.env.MINIMAX_API_KEY;
});

describe("minimax-api isConfigured", () => {
	it("returns true when MINIMAX_API_KEY present", () => {
		expect(minimaxApi.isConfigured()).toBe(true);
	});

	it("returns false when MINIMAX_API_KEY absent", () => {
		delete process.env.MINIMAX_API_KEY;
		expect(minimaxApi.isConfigured()).toBe(false);
	});
});

describe("minimax-api run", () => {
	it("calls generateText with default MiniMax-M3 model", async () => {
		await minimaxApi.run("MiniMax-M3", "hello");
		expect(aiMock.generateText).toHaveBeenCalledTimes(1);
		const args = aiMock.generateText.mock.calls[0][0];
		expect(args.prompt).toBe("hello");
	});

	it("returns textContent + modelVersion", async () => {
		const result = await minimaxApi.run("MiniMax-M3", "hi");
		expect(result.textContent).toBe("hello");
		expect(result.modelVersion).toBe("MiniMax-M3");
		expect(result.citations).toEqual([]);
	});
});

describe("minimax-api runStructuredResearch", () => {
	it("never passes tools/webSearch — minimax has no web search", async () => {
		aiMock.generateText.mockResolvedValueOnce({
			output: { name: "Haier" },
			finishReason: "stop",
		});
		await minimaxApi.runStructuredResearch<{ name: string }>({
			prompt: "extract",
			schema: {} as never,
			webSearch: true, // 显式 true 也应被忽略
		});
		const args = aiMock.generateText.mock.calls[0][0];
		expect(args.tools).toBeUndefined();
		expect(args.providerOptions).toBeUndefined();
		expect(args.output).toBeDefined(); // Output.object
	});

	it("returns parsed object + MiniMax-M3 modelVersion", async () => {
		aiMock.generateText.mockResolvedValueOnce({
			output: { name: "Haier" },
			finishReason: "stop",
		});
		const result = await minimaxApi.runStructuredResearch<{ name: string }>({
			prompt: "extract",
			schema: {} as never,
		});
		expect(result.object).toEqual({ name: "Haier" });
		expect(result.modelVersion).toBe("MiniMax-M3");
	});
});

describe("minimax-api 429 retry", () => {
	it("retries twice on 429 then throws", async () => {
		const retryErr = Object.assign(new Error("rate limited"), { statusCode: 429 });
		aiMock.generateText
			.mockRejectedValueOnce(retryErr)
			.mockRejectedValueOnce(retryErr)
			.mockRejectedValueOnce(retryErr);

		// 用真实 timer 缩短 setTimeout 等价：jest.useFakeTimers 复杂，改用全局 timeout 短延迟
		// 这里只验证调用次数，间隔时长另测
		await expect(minimaxApi.run("MiniMax-M3", "p")).rejects.toThrow("rate limited");
		// 第 1 次 + 2 次 retry = 共 3 次
		expect(aiMock.generateText).toHaveBeenCalledTimes(3);
	}, 10000);

	it("retries then succeeds on 429-then-200", async () => {
		const retryErr = Object.assign(new Error("rate limited"), { statusCode: 429 });
		aiMock.generateText
			.mockRejectedValueOnce(retryErr)
			.mockResolvedValueOnce({ text: "after-retry", finishReason: "stop" });

		const result = await minimaxApi.run("MiniMax-M3", "p");
		expect(result.textContent).toBe("after-retry");
		expect(aiMock.generateText).toHaveBeenCalledTimes(2);
	}, 10000);

	it("does not retry on 400 (non-retryable status)", async () => {
		const badReqErr = Object.assign(new Error("bad request"), { statusCode: 400 });
		aiMock.generateText.mockRejectedValueOnce(badReqErr);

		await expect(minimaxApi.run("MiniMax-M3", "p")).rejects.toThrow("bad request");
		expect(aiMock.generateText).toHaveBeenCalledTimes(1); // 单次失败立即抛
	});
});