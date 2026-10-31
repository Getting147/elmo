import { describe, it, expect } from "vitest";
import {
	getAvailableModels,
	ALL_MODELS_VALUE,
	isDoubaoModel,
	isUnsupportedBaselineModel,
	isModelMatch,
} from "@/lib/model-filter";

describe("getAvailableModels", () => {
	it("returns an empty list for an empty input", () => {
		expect(getAvailableModels([])).toEqual([]);
	});

	it("returns just the model when only one is configured (no 'all' sentinel)", () => {
		expect(getAvailableModels(["chatgpt"])).toEqual(["chatgpt"]);
	});

	it("prepends 'all' when multiple models are configured", () => {
		expect(getAvailableModels(["chatgpt", "claude"])).toEqual([ALL_MODELS_VALUE, "chatgpt", "claude"]);
	});

	it("preserves the caller's ordering of concrete models", () => {
		expect(getAvailableModels(["perplexity", "grok", "gemini"])).toEqual([
			ALL_MODELS_VALUE,
			"perplexity",
			"grok",
			"gemini",
		]);
	});

	it("works for arbitrary deployment-configured model ids, not just the ones Elmo knows about", () => {
		expect(getAvailableModels(["my-custom-model", "another-model"])).toEqual([
			ALL_MODELS_VALUE,
			"my-custom-model",
			"another-model",
		]);
	});
});

describe("isDoubaoModel and isUnsupportedBaselineModel (F03)", () => {
	it("correctly identifies Doubao variants with exact and prefix matching", () => {
		expect(isDoubaoModel("doubao-pro-32k")).toBe(true);
		expect(isDoubaoModel("doubao-lite-4k")).toBe(true);
		expect(isDoubaoModel("doubao")).toBe(true);
		expect(isDoubaoModel("ark")).toBe(true);
		expect(isDoubaoModel("ark-doubao-pro")).toBe(true);
		expect(isDoubaoModel("ark_endpoint_01")).toBe(true);
		expect(isDoubaoModel("volcengine-doubao")).toBe(true);
		expect(isDoubaoModel("volces-model")).toBe(true);
	});

	it("strictly rejects models that merely contain 'ark' substring (e.g. spark, dark, benchmark)", () => {
		expect(isDoubaoModel("spark")).toBe(false);
		expect(isDoubaoModel("spark-v3")).toBe(false);
		expect(isDoubaoModel("dark")).toBe(false);
		expect(isDoubaoModel("benchmark")).toBe(false);
		expect(isDoubaoModel("market-llm")).toBe(false);
		expect(isDoubaoModel("gpt-4o")).toBe(false);
		expect(isDoubaoModel("gemini-2.0-flash")).toBe(false);
		expect(isDoubaoModel("claude-3-5-sonnet")).toBe(false);
	});

	it("treats spark and other non-Doubao models as unsupported baseline models", () => {
		expect(isUnsupportedBaselineModel("spark")).toBe(true);
		expect(isUnsupportedBaselineModel("gpt-4o")).toBe(true);
		expect(isUnsupportedBaselineModel("gemini")).toBe(true);
		expect(isUnsupportedBaselineModel("benchmark")).toBe(true);
		expect(isUnsupportedBaselineModel("doubao-pro-32k")).toBe(false);
		expect(isUnsupportedBaselineModel("ark")).toBe(false);
		expect(isUnsupportedBaselineModel(ALL_MODELS_VALUE)).toBe(false);
		expect(isUnsupportedBaselineModel("all")).toBe(false);
		expect(isUnsupportedBaselineModel(undefined)).toBe(false);
		expect(isUnsupportedBaselineModel(null)).toBe(false);
	});

	it("correctly tests isModelMatch across filter and run models", () => {
		expect(isModelMatch("doubao", "doubao-pro-32k")).toBe(true);
		expect(isModelMatch("doubao-pro-32k", "doubao-pro-32k")).toBe(true);
		expect(isModelMatch(ALL_MODELS_VALUE, "doubao-pro-32k")).toBe(true);
		expect(isModelMatch(undefined, "doubao-pro-32k")).toBe(true);
		expect(isModelMatch("", "doubao-pro-32k")).toBe(true);
		expect(isModelMatch("spark", "doubao-pro-32k")).toBe(false);
		expect(isModelMatch("gpt-4o", "doubao-pro-32k")).toBe(false);
		expect(isModelMatch("doubao-lite", "doubao-pro-32k")).toBe(false);
	});
});
