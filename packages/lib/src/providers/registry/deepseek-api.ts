/**
 * DeepSeek API provider — BUG-001 / B02 (平台内部 LLM 统一 DeepSeek)
 *
 * 官方 OpenAI 兼容端点：https://api.deepseek.com/chat/completions
 * 支持模型：deepseek-chat (DeepSeek-V3), deepseek-reasoner (DeepSeek-R1)
 *
 * 关键特性：
 * 1. 结构化输出：采用官方 response_format: { type: "json_object" }
 * 2. 思考块清洗：自动剥离 <think>...</think> 标签，防止推理内容破坏 JSON.parse
 * 3. 结构兜底归一化：校验前补齐缺省数组/空值，严格保持 Zod 校验契约
 * 4. 严禁回退：若 Key 缺失或接口报错，明确抛出错误，禁止静默回退旧供应商
 */

import type { z } from "zod";
import { getCredential } from "../../secrets";
import { warnIfOutputCapped } from "../config";
import type {
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";

const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];

/** 获取安全配置的 API Key（优先 DEEPSEEK_API_KEY，兼容 LLM_API_KEY） */
export function getDeepSeekApiKey(): string | undefined {
	return (
		getCredential("DEEPSEEK_API_KEY") ||
		getCredential("LLM_API_KEY") ||
		process.env.DEEPSEEK_API_KEY ||
		process.env.LLM_API_KEY
	);
}

/** 获取基础 URL 端点 */
export function getDeepSeekBaseUrl(): string {
	let raw = process.env.DEEPSEEK_BASE_URL || process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
	raw = raw.trim().replace(/\/+$/, "");
	// 防止旧配置遗留的非 DeepSeek 端点（如 api.openai.com, api.anthropic.com 等）被错误引用
	if (
		raw.includes("openai.com") ||
		raw.includes("anthropic.com") ||
		raw.includes("openrouter.ai") ||
		raw.includes("volces.com")
	) {
		return DEFAULT_BASE_URL;
	}
	return raw;
}

/** 获取默认模型 */
export function getDeepSeekModel(): string {
	const model = process.env.DEEPSEEK_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL;
	// 避免 python 侧的 mock 别名干扰，标准模型名为 deepseek-chat 或 deepseek-reasoner
	if (model === "deepseek-flash" || model === "gpt-4o-mini") {
		return "deepseek-chat";
	}
	return model;
}

/**
 * 剥离 LLM 输出中的 <think>...</think> 思考块和 markdown 代码块语法。
 */
export function stripThinkingBlocks(text: string): string {
	return text
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
}

/** 是否可重试的 HTTP 状态（429 限流 + 5xx 服务器错误） */
function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

/**
 * 结构化输出结果容错归一化（防止模型漏给空数组导致 strict zod parse 报错）
 */
export function normalizeDeepSeekOutput(parsed: unknown): unknown {
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
			if (typeof lineObj.name !== "string") lineObj.name = "";
			if (typeof lineObj.description !== "string") lineObj.description = "";
			if (typeof lineObj.category !== "string") lineObj.category = "";
			if (Array.isArray(lineObj.skus)) {
				lineObj.skus = lineObj.skus.map((sku) => {
					if (!sku || typeof sku !== "object") return sku;
					const skuObj = sku as Record<string, unknown>;
					if (typeof skuObj.name !== "string") skuObj.name = "";
					if (typeof skuObj.model !== "string") skuObj.model = null;
					if (typeof skuObj.oneLiner !== "string") skuObj.oneLiner = "";
					if (typeof skuObj.evidenceUrl !== "string") skuObj.evidenceUrl = null;
					return skuObj;
				});
			} else {
				lineObj.skus = [];
			}
			return lineObj;
		});
	}

	return obj;
}

interface ChatChoice {
	message?: {
		content?: string;
		reasoning_content?: string;
	};
	finish_reason?: string;
}

interface ChatUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
}

interface ChatResponse {
	id?: string;
	created?: number;
	model?: string;
	choices?: ChatChoice[];
	usage?: ChatUsage;
}

async function fetchWithRetry(url: string, init: RequestInit, retries = MAX_RETRIES): Promise<Response> {
	let lastError: unknown;
	for (let i = 0; i <= retries; i++) {
		try {
			const res = await fetch(url, init);
			if (res.ok || !isRetryableStatus(res.status) || i === retries) {
				return res;
			}
			console.warn(`[deepseek-api] HTTP ${res.status}, retrying in ${RETRY_DELAYS_MS[i] ?? 1000}ms...`);
		} catch (err) {
			lastError = err;
			if ((err as Error).name === "AbortError") throw err;
			if (i === retries) throw err;
		}
		await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[i] ?? 1000));
	}
	throw lastError;
}

/** 调用 DeepSeek chat/completions 接口 */
export async function deepseekChat(
	messages: { role: string; content: string }[],
	options?: {
		model?: string;
		maxTokens?: number;
		responseFormat?: object;
		timeoutMs?: number;
		maxRetries?: number;
	},
): Promise<ChatResponse> {
	const apiKey = getDeepSeekApiKey();
	if (!apiKey) {
		throw new Error(
			"DeepSeek API Key 未配置。请在环境配置中设置 DEEPSEEK_API_KEY 或 LLM_API_KEY（严禁回退未续费旧供应商）。",
		);
	}

	const baseUrl = getDeepSeekBaseUrl();
	const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

	const body: Record<string, unknown> = {
		model: options?.model ?? getDeepSeekModel(),
		messages,
	};
	if (options?.maxTokens) body.max_tokens = options.maxTokens;
	if (options?.responseFormat) body.response_format = options.responseFormat;

	const controller = new AbortController();
	const timeoutMs = options?.timeoutMs ?? 90_000;
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const res = await fetchWithRetry(
			endpoint,
			{
				method: "POST",
				signal: controller.signal,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
			options?.maxRetries,
		);

		if (!res.ok) {
			const errText = await res.text();
			throw new Error(`DeepSeek API error (${res.status}): ${errText}`);
		}
		return (await res.json()) as ChatResponse;
	} catch (err) {
		if ((err as Error).name === "AbortError") {
			throw new Error(`DeepSeek API 请求超时 (${timeoutMs}ms) (AbortError)`);
		}
		throw err;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function runDeepSeek(prompt: string, model: string, _options?: ProviderOptions): Promise<ScrapeResult> {
	const data = await deepseekChat([{ role: "user", content: prompt }], { model });
	const text = data?.choices?.[0]?.message?.content ?? "";
	warnIfOutputCapped("deepseek-api", model, data?.choices?.[0]?.finish_reason);

	return {
		textContent: text,
		rawOutput: data,
		webQueries: [],
		citations: [],
		modelVersion: data?.model ?? model,
	};
}

export const deepseekApi: Provider = {
	id: "deepseek-api",
	name: "DeepSeek API (Official)",

	isConfigured() {
		return !!getDeepSeekApiKey();
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const version = options?.version ?? model ?? getDeepSeekModel();
		return runDeepSeek(prompt, version, options);
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		maxRetries,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const model = getDeepSeekModel();
		const startTs = Date.now();
		console.log(`[deepseek-api] runStructuredResearch start: model=${model}, promptLen=${prompt.length}`);

		const data = await deepseekChat(
			[
				{
					role: "system",
					content:
						"You are a precise JSON extractor. Respond only with a single valid JSON object matching the requested schema. Never include thinking blocks, commentary, or markdown fences around the JSON.",
				},
				{ role: "user", content: prompt },
			],
			{ model, responseFormat: { type: "json_object" }, maxRetries },
		);

		console.log(`[deepseek-api] LLM responded in ${Date.now() - startTs}ms`);
		const rawText = data?.choices?.[0]?.message?.content ?? "{}";
		const cleaned = stripThinkingBlocks(rawText);

		let parsed: unknown;
		try {
			parsed = JSON.parse(cleaned);
		} catch (err) {
			console.error("[deepseek-api] Failed to parse JSON:", cleaned);
			throw new Error(`DeepSeek returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
		}

		const normalized = normalizeDeepSeekOutput(parsed);
		const validated = (schema as z.ZodType).parse(normalized) as T;

		return {
			object: validated,
			modelVersion: data?.model ?? model,
			raw: data,
			usage: data?.usage,
			prompt,
		};
	},
};
