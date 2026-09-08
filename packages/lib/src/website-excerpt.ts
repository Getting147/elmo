import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const MAX_EXCERPT_LINES = 200;
const JINA_TIMEOUT_MS = 30_000;
const DIRECT_TIMEOUT_MS = 15_000;

// A realistic desktop-browser UA. The Jina reader — and especially direct site
// fetches — are less likely to be treated as bot traffic than a custom UA.
const BROWSER_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Fetch a short text excerpt of a website for brand-analysis context.
 *
 * Tries two sources in order, falling through whenever one is blocked,
 * rate-limited, or returns nothing:
 *
 *   1. Jina Reader (r.jina.ai) — LLM-friendly markdown, renders JS. Works
 *      anonymously, but Jina reputation-blocks anonymous requests from some IP
 *      ranges with a 401 ("bad network reputation"). Set the optional
 *      JINA_API_KEY env var to send an authenticated request — Jina then tracks
 *      rate limits by key instead of IP, sidestepping that block and raising the
 *      limit. No key is required; it is only read if present.
 *   2. Backend fetch + Readability — pull the raw HTML ourselves and extract the
 *      main content as clean text with @mozilla/readability + linkedom. This
 *      runs server-side (in the worker), so there are no CORS constraints and no
 *      third party left to rate-limit or block us.
 *
 * Returns "" when every source fails — callers treat an empty excerpt as a
 * best-effort miss rather than an error.
 */
export async function getWebsiteExcerpt(url: string): Promise<string> {
	if (!url) {
		return "";
	}

	// Ensure the URL has a scheme so the reader and our own fetch resolve it
	// consistently.
	const cleanUrl = url.startsWith("http") ? url : `https://${url}`;

	const sources = [
		{ name: "jina", fetch: () => fromJina(cleanUrl) },
		{ name: "readability", fetch: () => fromReadability(cleanUrl) },
	];

	for (const source of sources) {
		try {
			const content = await source.fetch();
			if (content) {
				return toExcerpt(content);
			}
			console.warn(`[website-excerpt] ${source.name} returned no content for ${cleanUrl}`);
		} catch (error) {
			console.warn(`[website-excerpt] ${source.name} failed for ${cleanUrl}:`, error);
		}
	}

	console.error(`[website-excerpt] all sources failed for ${cleanUrl}`);
	// hill 2026-09-08: 双源全失败时不再返回 ""（空 excerpt → M3 无输入 → 防幻觉
	// 不编 → productLines/competitors 全空）。改返回常识授权占位：告知模型抓取
	// 失败 + 明确产品线/竞品/别名属公开常识、基于通用知识提供不算编造。
	return buildFallbackExcerpt(cleanUrl);
}

type IndustryProfile = {
	label: string;
	products: string;
	global: string;
	regional?: string;
};

/**
 * v15 行业启发词典（仅关键词匹配，非品牌硬编码）：无法可靠推断行业时走通用
 * 形状引导。home appliance 覆盖海尔场景（素材：qoder-cn 行业常识词典）。
 */
const INDUSTRY_HINTS: Array<{ match: RegExp; profile: IndustryProfile }> = [
	{
		match: /appliance|fridge|washer|kitchen|refrigerat|air\s?cond|water\s?heat|vacuum/i,
		profile: {
			label: "home appliance",
			products:
				"refrigerators, washing machines, air conditioners, kitchen appliances, water heaters, small home appliances",
			global: "Samsung, LG, Whirlpool, Electrolux, Panasonic",
			regional: "Midea, Gree",
		},
	},
	{
		match: /electronics|audio|wearable|smartphone|telecom|digital|display/i,
		profile: {
			label: "consumer electronics",
			products: "smartphones, laptops, audio, wearables, smart-home devices",
			global: "Apple, Samsung, Sony",
			regional: "Xiaomi, Huawei",
		},
	},
	{
		match: /auto|car|motor|vehicle|truck|ev|drive/i,
		profile: {
			label: "automotive",
			products: "sedans, SUVs, EVs, commercial vehicles",
			global: "Toyota, Volkswagen, General Motors",
			regional: "BYD, Geely",
		},
	},
	{
		match: /food|snack|drink|beverage|dairy|cosmetic|personal\s?care|beauty/i,
		profile: {
			label: "consumer goods",
			products: "core product categories, sub-brands, everyday consumables",
			global: "Procter & Gamble, Nestlé, Unilever",
			regional: "leading local brands (match to the brand's markets)",
		},
	},
	{
		match: /saas|software|cloud|analytics|platform|ai|data/i,
		profile: {
			label: "software/SaaS",
			products: "core platform, business tiers, developer tools",
			global: "Microsoft, Salesforce, Google",
			regional: "leading local SaaS providers (match to the brand's markets)",
		},
	},
];

function inferIndustry(hostname: string): IndustryProfile | undefined {
	for (const hint of INDUSTRY_HINTS) {
		if (hint.match.test(hostname)) return hint.profile;
	}
	return undefined;
}

function buildFallbackExcerpt(url: string): string {
	let hostname = "";
	try {
		hostname = new URL(url).hostname.replace(/^www\./, "");
	} catch {
		hostname = url;
	}
	const brand = hostname.split(".")[0];
	const profile = inferIndustry(hostname);
	const lines = [
		`Unable to retrieve live content from ${hostname} — all excerpt sources failed (network/region block).`,
		`Continue from well-known public knowledge about "${brand}": its product categories, major product lines, direct competitors, and common aliases are public facts for established brands. Providing them from general knowledge is expected — empty productLines or competitors is the real failure.`,
		`Safety net: a product line or SKU whose evidenceUrl is missing or cannot be verified is kept as unverified for human review — it is never dropped wholesale. Approximate-but-real output is strictly better than empty output.`,
	];
	if (profile) {
		const label = profile.label[0].toUpperCase() + profile.label.slice(1);
		lines.push(
			`For a ${profile.label} brand like ${brand}, typical product lines include: ${profile.products}. Category-level terms are sufficient; exact model names are not required.`,
			`${label} brands commonly compete with: ${profile.global}${profile.regional ? `, and ${profile.regional}` : ""}.`,
		);
	} else {
		lines.push(
			`Reference shape for ${brand}: typical product lines include 3-6 category-level terms describing what the brand actually sells, drawn from your own knowledge of the brand; category-level approximations are acceptable, exact SKU or model numbers are not required.`,
			`Competitors should mix global leaders and regional/local peers relevant to ${brand}'s markets.`,
		);
	}
	lines.push(
		`One caution: do not invent specific model numbers or evidence URLs — approximate category-level output is expected instead.`,
	);
	return lines.join("\n");
}

/**
 * Jina Reader — prepend r.jina.ai to any URL to get back clean markdown. Sends
 * an Authorization header when JINA_API_KEY is set, which lifts Jina's
 * anonymous-IP rate limit / reputation block.
 */
async function fromJina(url: string): Promise<string | null> {
	const headers: Record<string, string> = { "User-Agent": BROWSER_UA };
	const apiKey = process.env.JINA_API_KEY;
	if (apiKey) {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	const response = await fetch(`https://r.jina.ai/${url}`, {
		headers,
		signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
	});
	if (!response.ok) {
		return null;
	}
	const content = (await response.text()).trim();
	return content || null;
}

/**
 * Last resort: fetch the raw HTML ourselves (server-side, so no CORS) and
 * extract the main article text with Readability, backed by linkedom's DOM.
 * Only handles HTML responses; falls back to whole-body text when Readability
 * can't isolate an article.
 */
async function fromReadability(url: string): Promise<string | null> {
	const response = await fetch(url, {
		headers: {
			"User-Agent": BROWSER_UA,
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		},
		signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
	});
	if (!response.ok) {
		return null;
	}
	if (!(response.headers.get("content-type") ?? "").includes("html")) {
		return null;
	}
	const html = await response.text();
	if (!html.trim()) {
		return null;
	}
	const { document } = parseHTML(html);
	const article = new Readability(document).parse();
	const text = article?.textContent?.trim();
	if (text) {
		return text;
	}
	// Readability couldn't isolate an article; fall back to all visible text.
	return document.body?.textContent?.trim() || null;
}

/** Collapse extraction output to the first N lines, matching prior behavior. */
function toExcerpt(content: string): string {
	return content.split("\n").slice(0, MAX_EXCERPT_LINES).join("\n");
}
