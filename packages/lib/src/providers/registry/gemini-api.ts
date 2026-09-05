import { getCredential } from "../../secrets";
import { parseCitationUrl } from "../../text-extraction";
import type { Provider, ScrapeResult, ProviderOptions } from "../types";

const DEFAULT_MODEL = "gemini-3.6-flash";

export const geminiApi: Provider = {
	id: "gemini-api",
	name: "Google Gemini API",

	isConfigured() {
		return !!getCredential("GEMINI_API_KEY");
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const apiKey = getCredential("GEMINI_API_KEY");
		if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

		const version = options?.version || DEFAULT_MODEL;
		const webSearch = options?.webSearch === true;

		const body: Record<string, unknown> = {
			contents: [{ parts: [{ text: prompt }] }],
		};
		if (webSearch) {
			body.tools = [{ googleSearch: {} }];
		}

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${version}:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Gemini API error (${response.status}): ${errText}`);
		}

		const data = await response.json();
		const candidate = data.candidates?.[0];
		const textContent = (candidate?.content?.parts ?? [])
			.map((p: { text?: string }) => p.text ?? "")
			.join("");

		// Google Search grounding citations: keep only chunks the answer actually
		// references (groundingSupports), falling back to all chunks when the API
		// omits the support map.
		const citations: NonNullable<ScrapeResult["citations"]> = [];
		const groundingChunks: Array<{ web?: { uri?: string; title?: string } }> =
			candidate?.groundingMetadata?.groundingChunks ?? [];
		const supports: Array<{ groundingChunkIndices?: number[] }> =
			candidate?.groundingMetadata?.groundingSupports ?? [];
		const referenced = new Set<number>();
		for (const s of supports) {
			for (const i of s.groundingChunkIndices ?? []) referenced.add(i);
		}
		let idx = 0;
		groundingChunks.forEach((chunk, i) => {
			const uri = chunk?.web?.uri;
			if (!uri) return;
			if (referenced.size > 0 && !referenced.has(i)) return;
			const c = parseCitationUrl(uri, chunk?.web?.title, idx);
			if (c) {
				citations.push(c);
				idx++;
			}
		});

		return {
			rawOutput: data,
			webQueries: webSearch ? ["unavailable"] : [],
			textContent,
			citations,
			modelVersion: version,
		};
	},
};
