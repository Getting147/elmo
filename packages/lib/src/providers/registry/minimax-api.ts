/**
 * MiniMax-M3 provider — Epic A-2 (V1.0) patch.
 *
 * OpenAI-compatible chat/completions endpoint at https://api.minimaxi.com/v1/.
 * fetch 直调（参考 mistral-api.ts mistralPost 先例）——避开 @ai-sdk/openai 模型名校验坑。
 *
 * geo-api real.py 9-5 实证：MiniMax-M3 + JSON 输出跑通。
 *
 * qoder-cn review 要点：minimax 无 webSearch 工具（不像 OpenAI Responses API），
 * runStructuredResearch 永远不开 webSearch — 调用方 schema 直出 JSON object。
 *
 * qoder-cn 配额情报：2056 上限历史已充值恢复；provider 内做 429 指数退避重试（2 次 1s/3s）。
 */
import { getCredential } from "../../secrets";
import { warnIfOutputCapped } from "../config";
import type {
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";
import { z } from "zod";

const DEFAULT_MODEL = "MiniMax-M3";
const BASE_URL = "https://api.minimaxi.com/v1";
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];

/**
 * 剥离 LLM 输出里的 <think>...</think> 思考块和 markdown code fence（geo-api 9-5 实证 MiniMax M3 常见）。
 * qoder-cn review 要点：M3 在 max_tokens > 1024 或 response_format=json_object 时会触发 thinking 模式，
 * 输出结构 = `<think>{...}\n</think>`{实际 JSON}` —— JSON.parse 不剥这两个就炸。
 * 顺序：先剥 think 块 → 再剥 ```json fences → 再 trim
 */
export function stripThinkingBlocks(text: string): string {
	return text
		.replace(/<think>[\s\S]*?<\/think>/g, "")
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
}

/** 是否可重试的 HTTP 状态（含 429 限流 + 5xx 服务器错误） */
function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

/**
 * qoder-cn 拍板 A（mtsc9awxa729ffc3d620 + hill 补全 2/3 mtsckd0n + mtsckhd73e8dc0f8806b）：
 * MiniMax M3 是推理模型，对 Zod schema 不严格遵循。runStructuredResearch 在拿到 parsed JSON
 * 后、schema.parse 前做 post-normalize 兜底；schema 保持 strict 不动避免弱化 GPT 路径契约。
 *
 * 规则：
 *   ① 顶层缺 additionalDomains / aliases / competitors → []
 *   ② suggestedPrompts 字符串项 → {prompt: 原文, tags: []}；对象缺 tags → []
 *   ③ productLines[].skus[].model 缺 → null；oneLiner 缺 → ""
 *   ④ 已有字段不覆盖
 */
export function normalizeM3Output(parsed: unknown): unknown {
	if (!parsed || typeof parsed !== "object") return parsed;
	const obj = parsed as Record<string, unknown>;

	if (!Array.isArray(obj.additionalDomains)) obj.additionalDomains = [];
	if (!Array.isArray(obj.aliases)) obj.aliases = [];
	if (!Array.isArray(obj.competitors)) obj.competitors = [];
	else {
		obj.competitors = obj.competitors.map((c) => {
			if (typeof c === "string") return { name: c, website: "", aliases: [], additionalDomains: [], domains: [] };
			if (c && typeof c === "object") {
				const item = c as Record<string, unknown>;
				if (typeof item.name !== "string") item.name = "";
				if (typeof item.website !== "string") item.website = "";
				if (!Array.isArray(item.aliases)) item.aliases = [];
				if (!Array.isArray(item.additionalDomains)) item.additionalDomains = [];
				if (!Array.isArray(item.domains)) item.domains = [];
				return item;
			}
			return { name: String(c ?? ""), website: "", aliases: [], additionalDomains: [], domains: [] };
		});
	}

	if (Array.isArray(obj.suggestedPrompts)) {
		obj.suggestedPrompts = obj.suggestedPrompts.map((p) => {
			if (typeof p === "string") return { prompt: p, tags: [] };
			if (p && typeof p === "object") {
				const item = p as Record<string, unknown>;
				if (!Array.isArray(item.tags)) item.tags = [];
				if (typeof item.prompt !== "string") item.prompt = String(item.prompt ?? "");
				return item;
			}
			return { prompt: String(p ?? ""), tags: [] };
		});
	}

	if (Array.isArray(obj.productLines)) {
		obj.productLines = obj.productLines.map((line) => {
			if (!line || typeof line !== "object") return line;
			const lineObj = line as Record<string, unknown>;
			// FDEV 2026-09-08 v6 复测补漏：缺 productLines[].name / .description / .category
			if (typeof lineObj.name !== "string") lineObj.name = "";
			if (typeof lineObj.description !== "string") lineObj.description = "";
			if (typeof lineObj.category !== "string") lineObj.category = "";
			if (Array.isArray(lineObj.skus)) {
				lineObj.skus = lineObj.skus.map((sku) => {
					if (!sku || typeof sku !== "object") return sku;
					const skuObj = sku as Record<string, unknown>;
					// qoder-cn 完整规则 2/3 (mtsckhd73e8dc0f8806b): 缺 model → null, 缺 oneLiner → ""
					// FDEV v6 补漏：skus[].name 缺也要补
					if (typeof skuObj.name !== "string") skuObj.name = "";
					if (typeof skuObj.model !== "string") skuObj.model = null;
					if (typeof skuObj.oneLiner !== "string") skuObj.oneLiner = "";
					return skuObj;
				});
			}
			return lineObj;
		});
	}

	return obj;
}

/** 带指数退避的 fetch 包装（429/5xx 自动重试 N 次） */
async function fetchWithRetry(
	input: string,
	init: RequestInit,
): Promise<Response> {
	let lastErr: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const res = await fetch(input, init);
			if (isRetryableStatus(res.status)) {
				if (attempt === MAX_RETRIES) return res; // 最后一次让上层读 body 抛
				await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 3000));
				continue;
			}
			return res;
		} catch (err) {
			lastErr = err;
			if (attempt === MAX_RETRIES) break;
			await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] ?? 3000));
		}
	}
	throw lastErr;
}

interface ChatChoice {
	message?: { content?: string };
	finish_reason?: string;
}

interface ChatResponse {
	model?: string;
	choices?: ChatChoice[];
}

/** 调用 minimax chat/completions，返回 text + raw + modelVersion */
async function minimaxChat(messages: { role: string; content: string }[], options?: {
	model?: string;
	maxTokens?: number;
	responseFormat?: object;
}): Promise<ChatResponse> {
	const apiKey = getCredential("MINIMAX_API_KEY");
	if (!apiKey) throw new Error("MINIMAX_API_KEY not configured");
	const body: Record<string, unknown> = {
		model: options?.model ?? DEFAULT_MODEL,
		messages,
	};
	if (options?.maxTokens) body.max_tokens = options.maxTokens;
	if (options?.responseFormat) body.response_format = options.responseFormat;

	const controller = new AbortController();
	// FDEV 2026-09-08 拍板：MiniMax M3 上次 600s 超时 hang（api 端响应慢/挂死），
	// 加 120s 单次超时（不含 MAX_RETRIES 重试时间）；若超时 controller.abort 立即抛错，避免 pg-boss 600s 强杀。
	const timeoutMs = 120_000;
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetchWithRetry(`${BASE_URL}/chat/completions`, {
			method: "POST",
			signal: controller.signal,
			headers: {
				Authorization: "Bearer " + apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`MiniMax API error (${res.status}): ${await res.text()}`);
		}
		return res.json() as Promise<ChatResponse>;
	} catch (err) {
		if ((err as Error).name === "AbortError") {
			throw new Error(`MiniMax API timeout after ${timeoutMs}ms (AbortError) - likely api hang`);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function runMinimax(
	prompt: string,
	model: string,
	_options?: ProviderOptions,
): Promise<ScrapeResult> {
	const data = await minimaxChat([{ role: "user", content: prompt }], { model });
	const text = data?.choices?.[0]?.message?.content ?? "";
	warnIfOutputCapped("minimax-api", model, data?.choices?.[0]?.finish_reason);

	return {
		textContent: text,
		citations: [],
		modelVersion: data?.model ?? model,
	};
}

export const minimaxApi: Provider = {
	id: "minimax-api",
	name: "MiniMax API (OpenAI-compatible)",

	isConfigured() {
		return !!getCredential("MINIMAX_API_KEY");
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const version = options?.version ?? model ?? DEFAULT_MODEL;
		return runMinimax(prompt, version, options);
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		// qoder-cn review 要点（06:28 f6811e1f）：minimax M3 输出可能含 <think>...</think> 思考块，
		// 必须先剥离再 JSON.parse，否则 schema.parse 失败 → 整个 wizard 卡死。
		// geo-api 9-5 实证：M3 thinking 模式触发条件是 max_tokens > 1024 或 response_format=json_object。
		const startTs = Date.now();
		console.log(`[minimax-api] runStructuredResearch start: model=${DEFAULT_MODEL}, promptLen=${prompt.length}`);
		const data = await minimaxChat(
			[
				{
					role: "system",
					content: "You are a precise JSON extractor. Respond only with a single JSON object matching the requested schema. Never include thinking blocks, commentary, or markdown fences around the JSON.",
				},
				{ role: "user", content: prompt },
			],
			{ model: DEFAULT_MODEL, responseFormat: { type: "json_object" } },
		);
		console.log(`[minimax-api] LLM responded in ${Date.now() - startTs}ms`);
		const rawText = data?.choices?.[0]?.message?.content ?? "{}";
		console.log(`[minimax-api] rawText length=${rawText.length}, first100=${rawText.slice(0,100).replace(/\n/g, " ")}`);
		const cleaned = stripThinkingBlocks(rawText);
		const parsed = JSON.parse(cleaned);
		console.log(`[minimax-api] parsed keys=${Object.keys(parsed).join(",")}`);
		// qoder-cn 拍板 A（2026-09-08 07:19 mtsc9awxa729ffc3d620）：MiniMax M3 是推理模型，
		// 对 Zod schema 不严格遵循。runStructuredResearch 内做 post-normalize 兜底，
		// schema 保持 strict 不动以避免弱化 GPT 路径契约。
		// 规则：① 顶层缺 additionalDomains/aliases/competitors → 默认 []
		//       ② suggestedPrompts 字符串数组 → 转 {prompt: str, tags: []}
		//       ③ productLines[].skus[].model/oneLiner 缺字段补默认值
		const normalized = normalizeM3Output(parsed);
		const validated = schema.parse(normalized) as T;
		return {
			object: validated,
			modelVersion: data?.model ?? DEFAULT_MODEL,
		};
	},
};