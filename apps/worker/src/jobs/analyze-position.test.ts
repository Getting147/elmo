import { describe, expect, it } from "vitest";

import { analyzePosition } from "./analyze-position.js";

const BRAND = "Haier";
const ALIASES = ["海尔", "Haier Group"];

// 1. Claude/Anthropic：content 是 [{text:"..."}]
const CLAUDE_OUTPUT = {
	content: [
		{ type: "text", text: "1. Haier — best overall\n2. Samsung — premium pick\n3. LG — value pick" },
	],
};

// 2. OpenAI Chat Completions：choices[].message.content 字符串
const OPENAI_CHAT_OUTPUT = {
	choices: [
		{
			message: {
				role: "assistant",
				content:
					"Top recommendations:\n1. 海尔 (best smart home)\n2. Midea\n3. Gree for budget buyers",
			},
		},
	],
};

// 3. Gemini：candidates[0].content.parts[0].text
const GEMINI_OUTPUT = {
	candidates: [
		{
			content: {
				parts: [
					{
						text: "1. Haier — innovative\n2. Samsung — reliable\n3. Whirlpool — affordable",
					},
				],
				role: "model",
			},
			finishReason: "STOP",
		},
	],
};

// 4. OpenAI Responses API：output[0].content[0].text
const OPENAI_RESPONSES_OUTPUT = {
	id: "resp_abc123",
	output: [
		{
			type: "message",
			role: "assistant",
			content: [
				{
					type: "output_text",
					text: "Top 3 picks:\n1. 海尔 — leader in AI home\n2. Midea\n3. Hisense",
				},
			],
		},
	],
};

// 5. Bare text
const BARE_OUTPUT = { text: "1. Haier leads the market\n2. Others" };

describe("analyzePosition — provider output structures (P0-1 critical bug fix)", () => {
	it("Claude content array extracts brand at rank 1", () => {
		const r = analyzePosition(CLAUDE_OUTPUT, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("OpenAI Chat Completions extracts brand at rank 1 via alias", () => {
		const r = analyzePosition(OPENAI_CHAT_OUTPUT, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("Gemini candidates.parts extracts brand at rank 1", () => {
		const r = analyzePosition(GEMINI_OUTPUT, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("OpenAI Responses API output.content extracts brand at rank 1", () => {
		const r = analyzePosition(OPENAI_RESPONSES_OUTPUT, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("Bare text extracts brand at rank 1", () => {
		const r = analyzePosition(BARE_OUTPUT, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("returns null when brand is not in list", () => {
		const o = {
			content: [{ type: "text", text: "1. Samsung\n2. LG\n3. Sony" }],
		};
		const r = analyzePosition(o, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBeNull();
	});

	it("returns null when no list/comparison/recommendation pattern", () => {
		const o = {
			content: [{ type: "text", text: "Haier is a good brand but I cannot rank." }],
		};
		const r = analyzePosition(o, BRAND, ALIASES);
		expect(r.answerType).toBeNull();
		expect(r.answerRank).toBeNull();
	});

	it("handles comparison type", () => {
		const o = {
			content: [{ type: "text", text: "Haier vs Midea: Haier wins on AI features." }],
		};
		const r = analyzePosition(o, BRAND, ALIASES);
		expect(r.answerType).toBe("comparison");
		expect(r.answerRank).toBe(1);
	});

	it("handles recommendation type", () => {
		const o = {
			content: [{ type: "text", text: "I recommend Haier for smart home." }],
		};
		const r = analyzePosition(o, BRAND, ALIASES);
		expect(r.answerType).toBe("recommendation");
		expect(r.answerRank).toBe(1);
	});

	it("returns null for malformed/unknown input", () => {
		expect(analyzePosition(null, BRAND, ALIASES)).toEqual({
			answerRank: null,
			answerType: null,
		});
		expect(analyzePosition("plain string", BRAND, ALIASES)).toEqual({
			answerRank: null,
			answerType: null,
		});
		expect(analyzePosition(undefined, BRAND, ALIASES)).toEqual({
			answerRank: null,
			answerType: null,
		});
		expect(analyzePosition(42, BRAND, ALIASES)).toEqual({
			answerRank: null,
			answerType: null,
		});
	});

	it("brand not at position 1 → correct rank", () => {
		const o = {
			content: [
				{
					type: "text",
					text: "1. Samsung\n2. LG\n3. Haier — best value\n4. Sony",
				},
			],
		};
		const r = analyzePosition(o, BRAND, ALIASES);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(3);
	});

	it("matches via alias not primary name", () => {
		const o = {
			content: [{ type: "text", text: "1. 海尔集团 leads\n2. Samsung" }],
		};
		const r = analyzePosition(o, "Haier", ["海尔"]);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("multiple Gemini candidates concatenates all parts", () => {
		const o = {
			candidates: [
				{ content: { parts: [{ text: "1. " }, { text: "Haier" }] } },
				{ content: { parts: [{ text: " and 2. Samsung" }] } },
			],
		};
		const r = analyzePosition(o, BRAND, []);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(1);
	});

	it("deeply nested structure auto-extracts via recursion", () => {
		const o = {
			wrapper: {
				response: {
					payload: {
						content: [
							{ text: "1. Midea\n2. " },
							{ nested: { deep: { text: "Haier is third" } } },
						],
					},
				},
			},
		};
		const r = analyzePosition(o, BRAND, []);
		expect(r.answerType).toBe("list");
		expect(r.answerRank).toBe(2);
	});
});
