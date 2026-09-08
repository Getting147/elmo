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

/** 是否可重试的 HTTP 状态（含 429 限流 + 5xx 服务器错误） */
function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
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

	const res = await fetchWithRetry(`${BASE_URL}/chat/completions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`MiniMax API error (${res.status}): ${await res.text()}`);
	}
	return res.json() as Promise<ChatResponse>;
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
		// qoder-cn review 要点：minimax 无 webSearch 工具，固定不开
		// 用 response_format json_object 引导输出 JSON；调用方传入的 zod schema 在 provider 内解析校验
		const data = await minimaxChat(
			[
				{
					role: "system",
					content: "You are a precise JSON extractor. Respond only with a single JSON object matching the requested schema.",
				},
				{ role: "user", content: prompt },
			],
			{ model: DEFAULT_MODEL, responseFormat: { type: "json_object" } },
		);
		const text = data?.choices?.[0]?.message?.content ?? "{}";
		const parsed = JSON.parse(text);
		const validated = schema.parse(parsed) as T;
		return {
			object: validated,
			modelVersion: data?.model ?? DEFAULT_MODEL,
		};
	},
};