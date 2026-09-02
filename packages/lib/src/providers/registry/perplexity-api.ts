import { getCredential } from "../../secrets";
import type { Provider, ScrapeResult, ProviderOptions } from "../types";

const DEFAULT_MODEL = "sonar";

export const perplexityApi: Provider = {
	id: "perplexity-api",
	name: "Perplexity API",

	isConfigured() {
		return !!getCredential("PERPLEXITY_API_KEY");
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const apiKey = getCredential("PERPLEXITY_API_KEY");
		if (!apiKey) throw new Error("PERPLEXITY_API_KEY is not configured");

		const version = options?.version || DEFAULT_MODEL;

		const response = await fetch("https://api.perplexity.ai/chat/completions", {
			method: "POST",
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: version,
				messages: [{ role: "user", content: prompt }],
			}),
		});

		if (!response.ok) {
			const errText = await response.text();
			throw new Error(`Perplexity API error (${response.status}): ${errText}`);
		}

		const data = await response.json();
		const textContent = data.choices?.[0]?.message?.content || "";
		const citations: Array<{ url: string; domain: string; title?: string; citationIndex: number }> = [];
		const sources = data.citations || [];

		let idx = 0;
		for (const url of sources) {
			try {
				const domain = new URL(url).hostname.replace(/^www\./, "");
				citations.push({ url, domain, title: domain, citationIndex: idx++ });
			} catch {
				// ignore
			}
		}

		return {
			rawOutput: data,
			webQueries: ["online query"],
			textContent,
			citations,
			modelVersion: version,
		};
	},
};
