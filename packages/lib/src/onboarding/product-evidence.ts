import { z } from "zod";
import { getCrawledPageText } from "./evidence";

const citedSourceSchema = z.object({
	evidenceUrl: z.string().nullable(),
	evidenceQuote: z.string().nullable(),
});

export const productResearchEvidenceSchema = citedSourceSchema.extend({
	kind: z.enum(["business", "productLine", "uncertain"]),
	parent: citedSourceSchema.extend({ name: z.string().min(1) }).optional().nullable().describe(
		"Explicit business-sector parent of this product line. Its verbatim relationship quote must contain both the parent's name and this product line's name. Omit an unknown relationship rather than inventing an intermediate category.",
	),
});

export type ProductResearchEvidence = z.infer<typeof productResearchEvidenceSchema>;
export type SourceCheck = "verified" | "missingSource" | "urlNotInCrawl" | "quoteNotFound" | "nameNotInQuote";

export function checkSourceQuote(
	name: string,
	source: { evidenceUrl?: string | null; evidenceQuote?: string | null },
	pages: Map<string, string>,
): SourceCheck {
	const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
	const quote = source.evidenceQuote ? normalize(source.evidenceQuote) : "";
	if (!source.evidenceUrl?.trim() || !quote) return "missingSource";
	const text = getCrawledPageText(source.evidenceUrl, pages);
	if (text === undefined) return "urlNotInCrawl";
	if (!normalize(text).includes(quote)) return "quoteNotFound";
	if (!normalize(name) || !quote.includes(normalize(name))) return "nameNotInQuote";
	return "verified";
}
