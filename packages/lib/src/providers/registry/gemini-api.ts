import { getCredential } from "../../secrets";
import type { Provider, ScrapeResult, ProviderOptions } from "../types";

const DEFAULT_MODEL = "gemini-2.5-flash";

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

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${version}:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
				}),
			},
		);

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Gemini API error (${response.status}): ${errText}`);
		}

		const data = await response.json();
		const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

		return {
			rawOutput: data,
			webQueries: [],
			textContent,
			citations: [],
			modelVersion: version,
		};
	},
};
