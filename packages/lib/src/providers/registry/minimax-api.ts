/**
 * MiniMax-M3 provider — Epic A-2 (V1.0) patch.
 *
 * OpenAI-compatible chat/completions endpoint at https://api.minimaxi.com/v1/.
 * geo-api real.py 9-5 实证：MiniMax-M3 + JSON 输出跑通。
 *
 * qoder-cn review 要点：minimax 无 webSearch 工具（不像 OpenAI Responses API），
 * 所以 runStructuredResearch 永远不传 tools/webSearch — 内部直接 default webSearch=false。
 *
 * qoder-cn 配额情报：2056 上限历史已充值恢复；provider 内做 429 指数退避重试（2 次 1s/3s）。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { getCredential } from "../../secrets";
import { warnIfOutputCapped } from "../config";
import type {
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";

const DEFAULT_MODEL = "MiniMax-M3";
const BASE_URL = "https://api.minimaxi.com/v1";
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];

/** 是否可重试的 HTTP 状态（含 429 限流 + 5xx 服务器错误 + AI_APICallError 子集） */
function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

/** 从异常对象提取可重试状态码（AI SDK 抛 AI_APICallError 含 statusCode） */
function getRetryableStatus(err: unknown): number | null {
	if (typeof err !== "object" || err === null) return null;
	const anyErr = err as { statusCode?: number; status?: number; response?: { status?: number } };
	const code = anyErr.statusCode ?? anyErr.status ?? anyErr.response?.status;
	return typeof code === "number" ? code : null;
}

/** 带指数退避的 generateText 包装（429/5xx 自动重试 N 次） */
async function generateTextWithRetry(
	fn: () => Promise<ReturnType<typeof generateText>>,
): Promise<Awaited<ReturnType<typeof generateText>>> {
	let lastErr: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastErr = err;
			const status = getRetryableStatus(err);
			if (status === null || !isRetryableStatus(status)) throw err;
			if (attempt === MAX_RETRIES) break;
			const delayMs = RETRY_DELAYS_MS[attempt] ?? 3000;
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
	throw lastErr;
}

function getMinimaxProvider() {
	const apiKey = getCredential("MINIMAX_API_KEY");
	if (!apiKey) {
		throw new Error("MINIMAX_API_KEY not configured");
	}
	return createOpenAICompatible({
		name: "minimax",
		apiKey,
		baseURL: BASE_URL,
	});
}

async function runMinimax(
	prompt: string,
	model: string,
	_options?: ProviderOptions,
): Promise<ScrapeResult> {
	const result = await generateTextWithRetry(() =>
		generateText({
			model: getMinimaxProvider()(model),
			prompt,
		}),
	);

	warnIfOutputCapped("minimax-api", model, result.finishReason);

	return {
		textContent: result.text,
		citations: [],
		modelVersion: model,
	};
}

export const minimaxApi: Provider = {
	id: "minimax-api",
	name: "MiniMax API (OpenAI-compatible)",

	isConfigured() {
		return !!getCredential("MINIMAX_API_KEY");
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const version = options?.version ?? DEFAULT_MODEL;
		return runMinimax(prompt, version, options);
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		// qoder-cn review 要点：minimax 无 webSearch 工具，固定不开
		const result = await generateTextWithRetry(() =>
			generateText({
				model: getMinimaxProvider()(DEFAULT_MODEL),
				output: Output.object({ schema }),
				prompt,
			}),
		);
		return {
			object: result.output as T,
			modelVersion: DEFAULT_MODEL,
		};
	},
};