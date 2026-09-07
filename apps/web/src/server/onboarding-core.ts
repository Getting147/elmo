/**
 * Brand-onboarding persistence helpers. Server-only — used by the API routes
 * under /api/v1/brands and by the server functions in ./onboarding.ts.
 *
 * Separated from onboarding.ts so that client components importing server
 * functions don't transitively pull in db/drizzle/pg (which breaks the
 * client bundle). Server functions live in onboarding.ts; everything else
 * lives here.
 */

import { MAX_COMPETITORS } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { ensureOrganization } from "@workspace/lib/db/provisioning";
import { brandProductLines, brandProductSkus, brands, competitors, prompts } from "@workspace/lib/db/schema";
import { computeSystemTags, sanitizeUserTags } from "@workspace/lib/tag-utils";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { dedupeAliases, dedupeDomains } from "@/lib/domain-categories";
import { createMultiplePromptJobSchedulers } from "@/lib/job-scheduler";

// ============================================================================
// Errors
// ============================================================================

export class BrandConflictError extends Error {
	constructor(public readonly brandId: string) {
		super(`Brand "${brandId}" already exists.`);
		this.name = "BrandConflictError";
	}
}

export class BrandNotFoundError extends Error {
	constructor(public readonly brandId: string) {
		super(`Brand "${brandId}" not found.`);
		this.name = "BrandNotFoundError";
	}
}

// ============================================================================
// Schemas
// ============================================================================

const competitorInputSchema = z.object({
	name: z.string().min(1),
	domains: z.array(z.string()).optional().default([]),
	aliases: z.array(z.string()).optional().default([]),
});

const promptInputSchema = z.object({
	value: z.string().min(1),
	tags: z.array(z.string()).optional().default([]),
	enabled: z.boolean().optional().default(true),
});

// Epic A-2 (V1.0): SKU / 产品线 schema（与 analyze.ts 一致）
const skuInputSchema = z.object({
	name: z.string().min(1),
	model: z.string().optional(),
	oneLiner: z.string().min(1),
	evidenceUrl: z.string().url("evidenceUrl must be a valid URL"),
});

const productLineInputSchema = z.object({
	name: z.string().min(1),
	category: z.string().optional(),
	differentiators: z.string().optional(),
	targetAudience: z.string().optional(),
	skus: z.array(skuInputSchema).optional().default([]),
});

type CompetitorInput = z.infer<typeof competitorInputSchema>;
type PromptInput = z.infer<typeof promptInputSchema>;
type ProductLineInput = z.infer<typeof productLineInputSchema>;

/**
 * POST /api/v1/brands body.
 *
 * The API speaks a single `domains` list to mirror the competitor endpoints.
 * Internally, the first cleaned entry is stored as the brand's `website`
 * (`https://<host>`) and the rest are stored in `additionalDomains`.
 */
export const createBrandInputSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	domains: z.array(z.string()).min(1),
	aliases: z.array(z.string()).optional(),
	competitors: z.array(competitorInputSchema).optional(),
	prompts: z.array(promptInputSchema).optional(),
});

/** PATCH /api/v1/brands/:brandId body. brandId comes from the URL. */
export const updateBrandBodySchema = z.object({
	brandName: z.string().min(1).optional(),
	domains: z.array(z.string()).min(1).optional(),
	aliases: z.array(z.string()).optional(),
	enabled: z.boolean().optional(),
});

/** Wizard save: brand-level fields + new prompts/competitors in one shot. */
export const wizardOnboardingInputSchema = z.object({
	brandId: z.string().min(1),
	brandName: z.string().min(1).optional(),
	website: z.string().min(1).optional(),
	additionalDomains: z.array(z.string()).optional(),
	aliases: z.array(z.string()).optional(),
	competitors: z.array(competitorInputSchema).optional(),
	prompts: z.array(promptInputSchema).optional(),
	// Epic A-2 (V1.0): 品牌档案 + 产品线/SKU
	summary: z.string().optional(),
	description: z.string().optional(),
	productLines: z.array(productLineInputSchema).optional(),
});

/** Internal shape for createBrand — matches storage (website + additionalDomains). */
export interface CreateBrandInput {
	id: string;
	name: string;
	website: string;
	additionalDomains?: string[];
	aliases?: string[];
	competitors?: CompetitorInput[];
	prompts?: PromptInput[];
}

/** Internal shape for updateBrand — matches storage. */
export interface UpdateBrandInput {
	brandId: string;
	brandName?: string;
	website?: string;
	additionalDomains?: string[];
	aliases?: string[];
	enabled?: boolean;
}

export type WizardOnboardingInput = z.infer<typeof wizardOnboardingInputSchema> & {
	summary?: string;
	description?: string;
	productLines?: ProductLineInput[];
};

export interface BrandResult {
	id: string;
	name: string;
	domains: string[];
	aliases: string[];
	enabled: boolean;
	onboarded: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// ============================================================================
// Helpers
// ============================================================================

function validateAndFormatWebsite(url: string): string {
	const trimmed = url.trim();
	const formatted = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
	const parsed = new URL(formatted);
	if (!["http:", "https:"].includes(parsed.protocol)) {
		throw new Error("Website URL must use http or https");
	}
	if (!parsed.hostname) {
		throw new Error("Website URL must have a valid hostname");
	}
	return formatted;
}

export function buildBrandResult(row: typeof brands.$inferSelect): BrandResult {
	const websiteHost = new URL(row.website).hostname.replace(/^www\./, "");
	return {
		id: row.id,
		name: row.name,
		domains: [websiteHost, ...row.additionalDomains],
		aliases: row.aliases,
		enabled: row.enabled,
		onboarded: row.onboarded,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * Validation error thrown by the API → internal converters when the supplied
 * `domains` array contains no valid entries after cleaning. Callers should
 * surface this as a 400.
 */
export class InvalidDomainsError extends Error {
	constructor(message = "domains: at least one valid domain is required") {
		super(message);
		this.name = "InvalidDomainsError";
	}
}

function splitDomainsForStorage(domains: string[]): { website: string; additionalDomains: string[] } {
	const cleaned = dedupeDomains(domains);
	if (cleaned.length === 0) throw new InvalidDomainsError();
	const [primary, ...rest] = cleaned;
	return { website: `https://${primary}`, additionalDomains: rest };
}

/** Convert POST /api/v1/brands body into the internal createBrand input. */
export function apiCreateInputToInternal(input: z.infer<typeof createBrandInputSchema>): CreateBrandInput {
	const { website, additionalDomains } = splitDomainsForStorage(input.domains);
	return {
		id: input.id,
		name: input.name,
		website,
		additionalDomains,
		aliases: input.aliases,
		competitors: input.competitors,
		prompts: input.prompts,
	};
}

/** Convert PATCH /api/v1/brands/:brandId body into the internal updateBrand input. */
export function apiUpdateInputToInternal(
	brandId: string,
	input: z.infer<typeof updateBrandBodySchema>,
): UpdateBrandInput {
	const result: UpdateBrandInput = {
		brandId,
		brandName: input.brandName,
		aliases: input.aliases,
		enabled: input.enabled,
	};
	if (input.domains !== undefined) {
		const { website, additionalDomains } = splitDomainsForStorage(input.domains);
		result.website = website;
		result.additionalDomains = additionalDomains;
	}
	return result;
}

async function insertCompetitors(args: {
	brandId: string;
	tx?: typeof db;
	websiteHost: string;
	source: { name: string; domains: string[]; aliases: string[] }[];
	tx?: typeof db;
}): Promise<number> {
	if (args.source.length === 0) return 0;

	const existing = await db.query.competitors.findMany({
		where: eq(competitors.brandId, args.brandId),
	});
	const existingDomains = new Set(existing.flatMap((c) => c.domains));

	const toInsert: Array<{ brandId: string; name: string; domains: string[]; aliases: string[] }> = [];
	for (const c of args.source) {
		const cleaned = dedupeDomains(c.domains).filter((d) => d !== args.websiteHost);
		if (cleaned.length === 0) continue;
		if (cleaned.some((d) => existingDomains.has(d))) continue;
		toInsert.push({
			brandId: args.brandId,
			name: c.name.trim(),
			domains: cleaned,
			aliases: dedupeAliases(c.aliases),
		});
	}
	if (toInsert.length === 0) return 0;

	const [{ count: currentCount }] = await db
		.select({ count: count() })
		.from(competitors)
		.where(eq(competitors.brandId, args.brandId));
	if ((currentCount || 0) + toInsert.length > MAX_COMPETITORS) {
		throw new Error(
			`Cannot add competitors. Would exceed maximum of ${MAX_COMPETITORS} (currently ${currentCount}, adding ${toInsert.length}).`,
		);
	}

	await db.insert(competitors).values(toInsert);
	return toInsert.length;
}

async function insertPrompts(args: {
	brandId: string;
	tx?: typeof db;
	brandName: string;
	website: string;
	source: { value: string; tags: string[]; enabled: boolean }[];
	dedupeAgainstExisting: boolean;
}): Promise<number> {
	if (args.source.length === 0) return 0;

	const seen = new Set<string>();
	if (args.dedupeAgainstExisting) {
		const existing = await db.query.prompts.findMany({
			where: eq(prompts.brandId, args.brandId),
		});
		for (const p of existing) seen.add(p.value.toLowerCase());
	}

	const rows: Array<{
		brandId: string;
		value: string;
		enabled: boolean;
		tags: string[];
		systemTags: string[];
		// P0-3: onboarding 批量建 prompt 默认 market=null（不限）；按市场分桶走 API/UI 入口
		market: string | null;
	}> = [];
	for (const p of args.source) {
		const value = p.value.trim();
		if (!value) continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push({
			brandId: args.brandId,
			value,
			enabled: p.enabled,
			tags: p.tags,
			systemTags: computeSystemTags(value, args.brandName, args.website),
			market: null,
		});
	}
	if (rows.length === 0) return 0;

	const inserted = await db.insert(prompts).values(rows).returning({ id: prompts.id });
	await createMultiplePromptJobSchedulers(inserted.map((r) => r.id));
	return inserted.length;
}

// Epic A-2 (V1.0): 产品线 + SKU 灌库
async function insertProductLines(args: {
	brandId: string;
	tx?: typeof db;
	source: ProductLineInput[];
}): Promise<{ productLineId: string; skuCount: number }[]> {
	if (args.source.length === 0) return [];
	const results: { productLineId: string; skuCount: number }[] = [];
	for (let i = 0; i < args.source.length; i++) {
		const pl = args.source[i];
		if (!pl.name || !pl.skus || pl.skus.length === 0) continue;
		const id = `bpl_${i}_${args.brandId}`;
		await db
			.insert(brandProductLines)
			.values({
				id,
				brandId: args.brandId,
				name: pl.name,
				category: pl.category ?? null,
				coreParams: pl.differentiators ?? null,
				// differentiators 列 NOT NULL（A-1 契约）——LLM 未产出时空串兜底
				differentiators: pl.differentiators ?? "",
				targetAudience: pl.targetAudience ?? null,
				position: i,
			})
			.onConflictDoNothing();

		for (let j = 0; j < pl.skus.length; j++) {
			const sku = pl.skus[j];
			const skuId = `bsku_${i}_${j}_${args.brandId}`;
			await db
				.insert(brandProductSkus)
				.values({
					id: skuId,
					brandId: args.brandId,
					productLineId: id,
					name: sku.name,
					model: sku.model ?? null,
					oneLiner: sku.oneLiner,
					evidenceUrl: sku.evidenceUrl,
					position: j,
				})
				.onConflictDoNothing();
		}
		results.push({ productLineId: id, skuCount: pl.skus.length });
	}
	return results;
}

// Epic A-2 (V1.0): brands.summary / brands.description 更新
async function updateBrandSummaryDescription(args: {
	brandId: string;
	tx?: typeof db;
	summary?: string;
	description?: string;
}): Promise<void> {
	const updates: Record<string, string> = {};
	if (args.summary !== undefined) updates.summary = args.summary;
	if (args.description !== undefined) updates.description = args.description;
	if (Object.keys(updates).length === 0) return;
	await db.update(brands).set(updates).where(eq(brands.id, args.brandId));
}

// ============================================================================
// createBrand — pure create
// ============================================================================

export async function createBrand(input: CreateBrandInput): Promise<BrandResult> {
	const formattedWebsite = validateAndFormatWebsite(input.website);
	const websiteHost = new URL(formattedWebsite).hostname.replace(/^www\./, "");

	const additionalDomains = dedupeDomains(input.additionalDomains ?? []).filter((d) => d !== websiteHost);
	const aliases = dedupeAliases(input.aliases ?? []);

	// Brands are hard-scoped to an org via a NOT NULL FK. This create path (the
	// admin API) supplies the brand id directly and historically created brands
	// whose id == the org id, so materialize that org first. No-op when it
	// already exists (e.g. a whitelabel org already synced from Auth0).
	await ensureOrganization({ id: input.id, name: input.name });

	const [inserted] = await db
		.insert(brands)
		.values({
			id: input.id,
			organizationId: input.id,
			name: input.name,
			website: formattedWebsite,
			additionalDomains,
			aliases,
			enabled: true,
			onboarded: true,
		})
		.onConflictDoNothing()
		.returning({ id: brands.id });
	if (!inserted) throw new BrandConflictError(input.id);

	await insertCompetitors({
		brandId: input.id,
		websiteHost,
		source: (input.competitors ?? []).map((c) => ({
			name: c.name,
			domains: c.domains ?? [],
			aliases: c.aliases ?? [],
		})),
	});

	await insertPrompts({
		brandId: input.id,
		brandName: input.name,
		website: formattedWebsite,
		source: (input.prompts ?? []).map((p) => ({
			value: p.value,
			tags: sanitizeUserTags(p.tags ?? []),
			enabled: p.enabled ?? true,
		})),
		dedupeAgainstExisting: false,
	});

	const refreshed = await db.query.brands.findFirst({ where: eq(brands.id, input.id) });
	if (!refreshed) throw new BrandNotFoundError(input.id);
	return buildBrandResult(refreshed);
}

// ============================================================================
// updateBrand — pure brand-level update
// ============================================================================

export async function updateBrand(input: UpdateBrandInput, tx?: typeof db): Promise<BrandResult> {
	const dbc = tx ?? db;
	const existing = await dbc.query.brands.findFirst({ where: eq(brands.id, input.brandId) });
	if (!existing) throw new BrandNotFoundError(input.brandId);

	const formattedWebsite = input.website ? validateAndFormatWebsite(input.website) : null;
	const websiteHost = formattedWebsite
		? new URL(formattedWebsite).hostname.replace(/^www\./, "")
		: existing.website
			? new URL(existing.website).hostname.replace(/^www\./, "")
			: null;

	const patch: Partial<typeof brands.$inferInsert> = { updatedAt: new Date() };
	if (input.brandName !== undefined) patch.name = input.brandName;
	if (formattedWebsite !== null) patch.website = formattedWebsite;
	if (input.additionalDomains !== undefined) {
		patch.additionalDomains = dedupeDomains(input.additionalDomains).filter((d) => d !== websiteHost);
	}
	if (input.aliases !== undefined) patch.aliases = dedupeAliases(input.aliases);
	if (input.enabled !== undefined) patch.enabled = input.enabled;

	await dbc.update(brands).set(patch).where(eq(brands.id, input.brandId));
	const refreshed = await dbc.query.brands.findFirst({ where: eq(brands.id, input.brandId) });
	if (!refreshed) throw new BrandNotFoundError(input.brandId);
	return buildBrandResult(refreshed);
}

// ============================================================================
// Wizard save — brand fields + new prompts/competitors in one shot
// ============================================================================

export async function saveWizardOnboarding(input: WizardOnboardingInput, tx?: typeof db): Promise<BrandResult> {
	const txToUse = tx ?? db;
	await updateBrand(
		{
			brandId: input.brandId,
			brandName: input.brandName,
			website: input.website,
			additionalDomains: input.additionalDomains,
			aliases: input.aliases,
		},
		txToUse,
	);

	await txToUse.update(brands).set({ onboarded: true, updatedAt: new Date() }).where(eq(brands.id, input.brandId));

	const existing = await txToUse.query.brands.findFirst({ where: eq(brands.id, input.brandId) });
	if (!existing) throw new BrandNotFoundError(input.brandId);
	let websiteHost = "";
	try {
		const rawUrl = existing.website.startsWith("http") ? existing.website : `https://${existing.website}`;
		websiteHost = new URL(rawUrl).hostname.replace(/^www\./, "");
	} catch {
		websiteHost = existing.website
			.replace(/^https?:\/\//, "")
			.split("/")[0]
			.replace(/^www\./, "");
	}

	await insertCompetitors({
		brandId: input.brandId,
		tx: txToUse,
		websiteHost,
		source: (input.competitors ?? []).map((c) => ({
			name: c.name,
			domains: c.domains ?? [],
			aliases: c.aliases ?? [],
		})),
	});

	await insertPrompts({
		brandId: input.brandId,
		tx: txToUse,
		brandName: existing.name,
		website: existing.website,
		source: (input.prompts ?? []).map((p) => ({
			value: p.value,
			tags: sanitizeUserTags(p.tags ?? []),
			enabled: p.enabled ?? true,
		})),
		dedupeAgainstExisting: true,
	});

	// Epic A-2 (V1.0): 公司档案 summary/description + 产品线/SKU
	if (input.summary !== undefined || input.description !== undefined) {
		await updateBrandSummaryDescription({
			brandId: input.brandId,
			tx: txToUse,
			summary: input.summary,
			description: input.description,
		});
	}
	if (input.productLines && input.productLines.length > 0) {
		await insertProductLines({
			brandId: input.brandId,
			tx: txToUse,
			source: input.productLines,
		});
	}

	const refreshed = await txToUse.query.brands.findFirst({ where: eq(brands.id, input.brandId) });
	if (!refreshed) throw new BrandNotFoundError(input.brandId);
	return buildBrandResult(refreshed);
}
