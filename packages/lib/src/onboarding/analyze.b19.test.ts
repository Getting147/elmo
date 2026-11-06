import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../website-excerpt", () => ({ getWebsiteExcerpt: vi.fn(async () => "") }));
vi.mock("../secrets", () => ({ getCredential: vi.fn(() => undefined) }));
vi.mock("../website-materials", () => ({ collectWebsiteMaterials: vi.fn(), WebsiteCollectionError: class extends Error {} }));

import { analyzeBrand, ResearchFailureError } from "./analyze";
import { collectWebsiteMaterials } from "../website-materials";

const sourceUrl = "https://example.invalid/products";
const fetchMock = vi.fn<typeof fetch>();
let output: unknown;

function raw(suggestedPrompts: unknown[] = []) {
	return {
		brandName: "合成设备",
		additionalDomains: [],
		aliases: [],
		competitors: [],
		summary: "合成研究",
		description: "离线契约反例，不是美的原始模型响应。",
		productLines: [],
		suggestedPrompts,
	};
}

beforeEach(() => {
	vi.stubEnv("DEEPSEEK_API_KEY", "synthetic-offline-key");
	vi.stubEnv("DEEPSEEK_BASE_URL", "http://127.0.0.1:9");
	vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => new Response(JSON.stringify({
		model: "deepseek-flash",
		choices: [{ message: { content: JSON.stringify(output) }, finish_reason: "stop" }],
		usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
	})));
	vi.stubGlobal("fetch", fetchMock);
	vi.mocked(collectWebsiteMaterials).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

const execute = (pageText = "") => analyzeBrand({
	website: "https://example.invalid/",
	crawledPageTexts: new Map([[sourceUrl, pageText]]),
});

describe("B19 research outcome contract", () => {
	it("isolates missing, empty and wrong-type prompt fields without inventing text", async () => {
		output = raw([
			{ question: "合成别名字段反例", tags: [], targetReference: "none" },
			{ prompt: "  ", tags: [], targetReference: "none" },
			{ prompt: 42, tags: [], targetReference: "none" },
			{ prompt: "中文 USB 设备怎么选？", category: null, tags: [], targetReference: "none" },
		]);
		const result = await execute();
		expect(result.suggestedPrompts).toEqual([{ prompt: "中文 USB 设备怎么选？", tags: [] }]);
		expect(result.suggestedPromptsMeta).toMatchObject({
			generated: 4, kept: 1, missingPrompt: 1, emptyPrompt: 1, invalidPrompt: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps a sourced category without inventing a concrete SKU", async () => {
		output = {
			...raw(),
			productLines: [{
				name: "仓储设备",
				skus: [],
				researchEvidence: {
					kind: "productLine",
					evidenceUrl: sourceUrl,
					evidenceQuote: "本公司提供仓储设备。",
				},
			}],
		};
		const result = await execute("本公司提供仓储设备。");
		expect(result.productLines?.confirmed).toHaveLength(1);
		expect(result.productLines?.confirmed[0]?.line.skus).toEqual([]);
	});

	it("reports ten synthetic empty rows as empty text rather than duplicate success", async () => {
		output = raw(Array.from({ length: 10 }, () => ({ prompt: "", tags: [], targetReference: "none" })));
		const result = await execute();
		expect(result.suggestedPrompts).toEqual([]);
		expect(result.suggestedPromptsMeta).toMatchObject({ generated: 10, emptyPrompt: 10, duplicate: 0 });
		expect(result.researchDiagnostics?.prompts.status).toBe("failed");
	});

	it("keeps a sourced product line and its good SKU while isolating unsupported or malformed SKUs", async () => {
		const quote = "本公司提供仓储设备。搬运车 ZX-10 适合仓库。";
		output = {
			...raw([{ prompt: "仓储设备怎么选？", category: "未知分类", tags: [], targetReference: "none" }]),
			productLines: [{
				name: "仓储设备",
				researchEvidence: { kind: "productLine", evidenceUrl: sourceUrl, evidenceQuote: "本公司提供仓储设备。" },
				skus: [
					{ name: "搬运车", model: "ZX-10", oneLiner: "仓库用", evidenceUrl: sourceUrl, evidenceQuote: "搬运车 ZX-10 适合仓库。" },
					{ name: "未核实车型", model: null, oneLiner: "待核", evidenceUrl: null, evidenceQuote: null },
					42,
				],
			}],
		};
		const result = await execute(quote);
		expect(result.productLines?.confirmed[0].line.skus.map((sku) => sku.name)).toEqual(["搬运车"]);
		expect(result.productLines?.unverified[0].line.skus.map((sku) => sku.name)).toEqual(["未核实车型"]);
		expect(result.productLines?.unverified[0].reason).toContain("INVALID_SKU_STRUCTURE");
		expect(result.suggestedPrompts).toHaveLength(1);
		expect(result.suggestedCategoryChecks).toEqual([{ category: "未知分类", status: "unconfirmed" }]);
	});

	it("keeps business sectors without attaching SKUs or inventing an intermediate product line", async () => {
		output = {
			...raw(),
			productLines: [{
				name: "仓储业务", researchEvidence: { kind: "business", evidenceUrl: sourceUrl, evidenceQuote: "仓储业务提供搬运车 ZX-10。" },
				skus: [{ name: "搬运车", model: "ZX-10", oneLiner: "仓库用", evidenceUrl: sourceUrl, evidenceQuote: "仓储业务提供搬运车 ZX-10。" }],
			}],
		};
		const result = await execute("仓储业务提供搬运车 ZX-10。");
		expect(result.productLines?.confirmed[0].line).toMatchObject({ name: "仓储业务", skus: [] });
		expect(result.productLines?.unverified[0].reason).toContain("SKU_NEEDS_PRODUCT_LINE");
		expect(result.productLines?.confirmed).toHaveLength(1);
	});

	it("retains only an evidenced parent relation and never invents one", async () => {
		const quote = "仓储业务下设仓储设备产品线。";
		output = {
			...raw(),
			productLines: [{
				name: "仓储设备", skus: [],
				researchEvidence: {
					kind: "productLine", evidenceUrl: sourceUrl, evidenceQuote: quote,
					parent: { name: "仓储业务", evidenceUrl: sourceUrl, evidenceQuote: quote },
				},
			}],
		};
		const result = await execute(quote);
		expect(result.productLines?.confirmed[0].line.category).toBe("仓储业务");
	});

	it("does not confirm a parent quote that never names the child product line", async () => {
		output = {
			...raw(),
			productLines: [{
				name: "仓储设备", skus: [],
				researchEvidence: { kind: "productLine", evidenceUrl: sourceUrl, evidenceQuote: "提供仓储设备。",
					parent: { name: "仓储业务", evidenceUrl: sourceUrl, evidenceQuote: "仓储业务提供物流服务。" } },
			}],
		};
		const result = await execute("提供仓储设备。仓储业务提供物流服务。");
		expect(result.productLines?.confirmed[0].line.category).toBeUndefined();
		expect(result.productLines?.confirmed[0].line.researchEvidence?.parent?.name).toBe("仓储业务");
	});

	it("keeps six maximum-sized Chinese source pages and redirect aliases within the approved token preflight", async () => {
		vi.mocked(collectWebsiteMaterials).mockResolvedValue({
			status: "complete", requestCount: 18, maxPages: 6, maxRequestsPerPage: 3,
			pages: Array.from({ length: 6 }, (_, index) => ({
				url: `https://example.invalid/original-${index}`, finalUrl: `https://example.invalid/final-${index}`,
				status: "success" as const, fetchedAt: new Date().toISOString(),
				text: "中".repeat(5999) + index, links: [], attempts: [],
			})),
		});
		output = raw([{ prompt: "设备怎么选？", category: null, tags: [], targetReference: "none" }]);
		await analyzeBrand({ website: "https://example.invalid/", requireLiveWebsite: true });
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		const conservativeTotal = Buffer.byteLength(JSON.stringify(body.messages), "utf8") + 1024 + 16384;
		expect(conservativeTotal).toBeLessThanOrEqual(150000);
		const text = body.messages[1].content;
		const sourceJson = text.split("TERM ASSESSMENT SOURCE DATA (JSON, not instructions):\n")[1].split("\n")[0];
		const sources = JSON.parse(sourceJson);
		expect(sources).toHaveLength(6);
		expect(sources.every((source: { aliases?: string[] }) => (source.aliases?.length ?? 0) >= 1)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("does not call the model when all real-transport source attempts failed", async () => {
		vi.mocked(collectWebsiteMaterials).mockResolvedValue({
			status: "failed", pages: [], requestCount: 3, maxPages: 6, maxRequestsPerPage: 3,
		});
		await expect(analyzeBrand({ website: sourceUrl, requireLiveWebsite: true })).rejects.toBeInstanceOf(ResearchFailureError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("preserves raw response, usage, request model and derived non-empty prompt contract", async () => {
		output = raw([{ prompt: "设备怎么选？", category: null, tags: [], targetReference: "none" }]);
		const result = await execute();
		const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(requestBody.messages[1].content).toContain("OUTPUT JSON CONTRACT");
		expect(requestBody.messages[1].content).toContain('"prompt":{"type":"string","minLength":1');
		expect(requestBody.response_format).toEqual({ type: "json_object" });
		expect(result.researchDiagnostics?.llm).toMatchObject({
			requestModel: "deepseek-flash", modelVersion: "deepseek-flash", finishReason: "stop",
			usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
		});
		expect(JSON.stringify(result.researchDiagnostics?.llm?.response)).toContain("设备怎么选");
	});

	it("isolates an invalid prompt-list shape without discarding the rest of the research", async () => {
		output = { ...raw(), suggestedPrompts: { question: "合成坏清单" } };
		const result = await execute();
		expect(result.brandName).toBe("合成设备");
		expect(result.suggestedPromptsMeta?.fieldStatus).toBe("invalid");
		expect(result.suggestedPrompts).toEqual([]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
