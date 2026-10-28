import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveResearchProvider } from "./llm";

const ENV_KEYS = [
	"ONBOARDING_LLM_TARGET",
	"DEEPSEEK_API_KEY",
	"LLM_API_KEY",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENROUTER_API_KEY",
	"OLOSTEP_API_KEY",
	"BRIGHTDATA_API_TOKEN",
	"OXYLABS_USERNAME",
	"OXYLABS_PASSWORD",
	"MISTRAL_API_KEY",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const v = savedEnv[key];
		if (v === undefined) delete process.env[key];
		else process.env[key] = v;
	}
});

describe("resolveResearchProvider", () => {
	it("uses explicit DeepSeek override when set", () => {
		process.env.DEEPSEEK_API_KEY = "sk-ds-key";
		const provider = resolveResearchProvider({
			DEEPSEEK_API_KEY: "sk-ds-key",
			ONBOARDING_LLM_TARGET: "deepseek:deepseek-api",
		});
		expect(provider.id).toBe("deepseek-api");
	});

	it("strictly rejects legacy non-DeepSeek providers even if explicitly targeted", () => {
		process.env.ANTHROPIC_API_KEY = "x";
		expect(() =>
			resolveResearchProvider({
				ANTHROPIC_API_KEY: "x",
				ONBOARDING_LLM_TARGET: "claude:anthropic-api",
			}),
		).toThrow(/disabled by policy/);

		process.env.OPENAI_API_KEY = "x";
		expect(() =>
			resolveResearchProvider({
				OPENAI_API_KEY: "x",
				ONBOARDING_LLM_TARGET: "chatgpt:openai-api:gpt-5-mini",
			}),
		).toThrow(/disabled by policy/);
	});

	it("throws when explicit override points at an unconfigured deepseek provider", () => {
		expect(() =>
			resolveResearchProvider({
				ONBOARDING_LLM_TARGET: "deepseek:deepseek-api",
			}),
		).toThrow(/isn't configured/);
	});

	it("throws when ONBOARDING_LLM_TARGET points at a scraper", () => {
		process.env.OLOSTEP_API_KEY = "x";
		expect(() =>
			resolveResearchProvider({
				OLOSTEP_API_KEY: "x",
				ONBOARDING_LLM_TARGET: "gemini:olostep:online",
			}),
		).toThrow(/disabled by policy/);
	});

	it("prefers DeepSeek when DEEPSEEK_API_KEY is configured", () => {
		process.env.DEEPSEEK_API_KEY = "sk-ds-key";
		process.env.OPENAI_API_KEY = "old-expired-openai";
		const provider = resolveResearchProvider();
		expect(provider.id).toBe("deepseek-api");
	});

	it("prefers DeepSeek when LLM_API_KEY is configured", () => {
		process.env.LLM_API_KEY = "sk-llm-key";
		const provider = resolveResearchProvider();
		expect(provider.id).toBe("deepseek-api");
	});

	it("strictly rejects fallback to expired legacy providers (OpenAI/Anthropic/Mistral/OpenRouter)", () => {
		// 即使环境中残留旧 Key，也不得自动回退
		process.env.OPENAI_API_KEY = "old-key";
		process.env.OPENROUTER_API_KEY = "old-key";
		process.env.ANTHROPIC_API_KEY = "old-key";
		process.env.MISTRAL_API_KEY = "old-key";
		expect(() => resolveResearchProvider()).toThrow(/DeepSeek/);
	});

	it("ignores scraper providers entirely", () => {
		process.env.OLOSTEP_API_KEY = "x";
		process.env.BRIGHTDATA_API_TOKEN = "y";
		expect(() => resolveResearchProvider({ OLOSTEP_API_KEY: "x", BRIGHTDATA_API_TOKEN: "y" })).toThrow(
			/at least one direct LLM API/,
		);
	});

	it("throws when no provider is configured", () => {
		expect(() => resolveResearchProvider({})).toThrow(/at least one direct LLM API/);
	});
});
