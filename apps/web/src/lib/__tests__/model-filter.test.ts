import { describe, it, expect } from "vitest";
import {
	getAvailableModels,
	getBaselineModelAliases,
	getBaselineModelOptions,
	isBaselineModelMismatch,
	isModelFilterSpecified,
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

describe("baseline model identity", () => {
	it("only exposes the model the active run actually executed", () => {
		expect(getBaselineModelOptions("doubao-seed-2-1-pro-260628")).toEqual([
			"doubao-seed-2-1-pro-260628",
		]);
		expect(getBaselineModelOptions("  doubao-seed-2-1-pro-260628  ")).toEqual([
			"doubao-seed-2-1-pro-260628",
		]);
	});

	it("does not invent an option when the run identity is missing", () => {
		expect(getBaselineModelOptions(undefined)).toEqual([]);
		expect(getBaselineModelOptions(null)).toEqual([]);
		expect(getBaselineModelOptions("")).toEqual([]);
		expect(getBaselineModelOptions("   ")).toEqual([]);
	});

	it("maps only the confirmed legacy doubao alias to a concrete run model", () => {
		expect(getBaselineModelAliases("doubao-seed-2-1-pro-260628")).toEqual({
			doubao: "doubao-seed-2-1-pro-260628",
		});
		expect(getBaselineModelAliases("ark-doubao-pro")).toEqual({ doubao: "ark-doubao-pro" });
		expect(getBaselineModelAliases("doubao")).toEqual({ doubao: "doubao" });
		expect(getBaselineModelAliases("gpt-4o")).toEqual({});
		expect(getBaselineModelAliases(undefined)).toEqual({});
	});

	it("keeps different concrete versions distinct", () => {
		expect(isModelMatch("doubao-seed-1-6-flash", "doubao-seed-2-1-pro-260628")).toBe(false);
		expect(isModelMatch("doubao-seed-2-1-pro-260628", "doubao-seed-1-6-flash")).toBe(false);
		expect(isModelMatch("doubao", "doubao-seed-2-1-pro-260628")).toBe(true);
	});

	it("flags concrete filters that cannot apply to the run identity", () => {
		expect(isModelFilterSpecified(ALL_MODELS_VALUE)).toBe(false);
		expect(isModelFilterSpecified(undefined)).toBe(false);
		expect(isModelFilterSpecified("")).toBe(false);
		expect(isModelFilterSpecified("doubao")).toBe(true);

		expect(isBaselineModelMismatch(ALL_MODELS_VALUE, "doubao-seed-2-1-pro-260628")).toBe(false);
		expect(isBaselineModelMismatch(undefined, "doubao-seed-2-1-pro-260628")).toBe(false);
		expect(isBaselineModelMismatch("doubao", "doubao-seed-2-1-pro-260628")).toBe(false);
		expect(
			isBaselineModelMismatch("doubao-seed-2-1-pro-260628", "doubao-seed-2-1-pro-260628"),
		).toBe(false);
		expect(isBaselineModelMismatch("doubao-seed-1-6-flash", "doubao-seed-2-1-pro-260628")).toBe(
			true,
		);
		expect(isBaselineModelMismatch("doubao", null)).toBe(true);
		expect(isBaselineModelMismatch("doubao", undefined)).toBe(true);
	});
});
