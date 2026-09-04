/**
 * Server functions for brand profile (Epic A: product lines + credentials).
 *
 * US-A02: product lines with differentiators (ground-truth source).
 * US-A03: credentials with third-party-public flag (E-E-A-T distinction).
 * Data model: brand_product_lines / brand_credentials (migration 0015, owned by bob).
 * Frontend reads/writes via server fn (direct db) — REST API is for report layer.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import {
	brandProductLines,
	brandCredentials,
	brands,
} from "@workspace/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

const CRED_TYPES = [
	"certification",
	"patent",
	"award",
	"membership",
	"case_study",
	"media",
] as const;

const productLineSchema = z.object({
	name: z.string().min(1, "name required"),
	category: z.string().optional().nullable(),
	coreParams: z.string().optional().nullable(),
	differentiators: z.string().min(1, "differentiators required"),
	targetAudience: z.string().optional().nullable(),
	position: z.number().int().min(0).optional().default(0),
});

const credentialSchema = z.object({
	credType: z.enum(CRED_TYPES),
	name: z.string().min(1, "name required"),
	year: z.string().optional().nullable(),
	isThirdPartyPublic: z.boolean(),
	url: z.string().optional().nullable(),
	position: z.number().int().min(0).optional().default(0),
});

async function requireBrand(brandId: string) {
	const session = await requireAuthSession();
	const brand = await db.query.brands.findFirst({
		where: and(eq(brands.id, brandId), eq(brands.organizationId, session.organizationId)),
	});
	if (!brand) throw new Error("Brand not found or no access");
	return brand;
}

export const getBrandProfileFn = createServerFn()
	.input(z.object({ brandId: z.string() }))
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		const [productLines, credentials] = await Promise.all([
			db.query.brandProductLines.findMany({
				where: eq(brandProductLines.brandId, input.brandId),
				orderBy: [brandProductLines.position],
			}),
			db.query.brandCredentials.findMany({
				where: eq(brandCredentials.brandId, input.brandId),
				orderBy: [brandCredentials.position],
			}),
		]);
		return { productLines, credentials };
	});

export const createProductLineFn = createServerFn()
	.input(z.object({ brandId: z.string() }).merge(productLineSchema))
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		const [row] = await db
			.insert(brandProductLines)
			.values({
				brandId: input.brandId,
				name: input.name,
				category: input.category ?? null,
				coreParams: input.coreParams ?? null,
				differentiators: input.differentiators,
				targetAudience: input.targetAudience ?? null,
				position: input.position ?? 0,
			})
			.returning();
		return row;
	});

export const updateProductLineFn = createServerFn()
	.input(
		z
			.object({
				brandId: z.string(),
				productLineId: z.string(),
			})
			.merge(productLineSchema.partial()),
	)
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		const [row] = await db
			.update(brandProductLines)
			.set({
				name: input.name,
				category: input.category ?? null,
				coreParams: input.coreParams ?? null,
				differentiators: input.differentiators,
				targetAudience: input.targetAudience ?? null,
				position: input.position,
			})
			.where(
				and(
					eq(brandProductLines.id, input.productLineId),
					eq(brandProductLines.brandId, input.brandId),
				),
			)
			.returning();
		if (!row) throw new Error("Product line not found");
		return row;
	});

export const deleteProductLineFn = createServerFn()
	.input(z.object({ brandId: z.string(), productLineId: z.string() }))
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		await db
			.delete(brandProductLines)
			.where(
				and(
					eq(brandProductLines.id, input.productLineId),
					eq(brandProductLines.brandId, input.brandId),
				),
			);
		return { ok: true };
	});

export const createCredentialFn = createServerFn()
	.input(z.object({ brandId: z.string() }).merge(credentialSchema))
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		const [row] = await db
			.insert(brandCredentials)
			.values({
				brandId: input.brandId,
				credType: input.credType,
				name: input.name,
				year: input.year ?? null,
				isThirdPartyPublic: input.isThirdPartyPublic,
				url: input.url ?? null,
				position: input.position ?? 0,
			})
			.returning();
		return row;
	});

export const updateCredentialFn = createServerFn()
	.input(
		z
			.object({
				brandId: z.string(),
				credentialId: z.string(),
			})
			.merge(credentialSchema.partial()),
	)
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		const [row] = await db
			.update(brandCredentials)
			.set({
				credType: input.credType,
				name: input.name,
				year: input.year ?? null,
				isThirdPartyPublic: input.isThirdPartyPublic,
				url: input.url ?? null,
				position: input.position,
			})
			.where(
				and(
					eq(brandCredentials.id, input.credentialId),
					eq(brandCredentials.brandId, input.brandId),
				),
			)
			.returning();
		if (!row) throw new Error("Credential not found");
		return row;
	});

export const deleteCredentialFn = createServerFn()
	.input(z.object({ brandId: z.string(), credentialId: z.string() }))
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		await db
			.delete(brandCredentials)
			.where(
				and(
					eq(brandCredentials.id, input.credentialId),
					eq(brandCredentials.brandId, input.brandId),
				),
			);
		return { ok: true };
	});

/**
 * Completeness (US-A05): three buckets, weighted 30/40/30.
 * product line complete = name + differentiators + targetAudience non-empty.
 * credential complete = name non-empty (+ thirdParty flag always set by schema).
 * overall = Σ(w_i × s_i) / Σ(present w_i); empty table = missing bucket (renormalize).
 */
export const getProfileCompletenessFn = createServerFn()
	.input(z.object({ brandId: z.string() }))
	.handler(async ({ input }) => {
		await requireBrand(input.brandId);
		const [productLines, credentials] = await Promise.all([
			db.query.brandProductLines.findMany({
				where: eq(brandProductLines.brandId, input.brandId),
			}),
			db.query.brandCredentials.findMany({
				where: eq(brandCredentials.brandId, input.brandId),
			}),
		]);

		const brandScore = 1; // brand basics (name/website/aliases) assumed present once brand exists
		const plComplete = productLines.filter(
			(p) => p.name && p.differentiators && p.targetAudience,
		).length;
		const plScore = productLines.length ? plComplete / productLines.length : null;
		const credScore = credentials.length ? 1 : null; // any credential row counts (schema enforces fields)

		const present: { w: number; s: number }[] = [];
		present.push({ w: 0.3, s: brandScore });
		if (plScore !== null) present.push({ w: 0.4, s: plScore });
		if (credScore !== null) present.push({ w: 0.3, s: credScore });
		const overall = present.length
			? Math.round((present.reduce((a, b) => a + b.w * b.s, 0) / present.reduce((a, b) => a + b.w, 0)) * 100)
			: 0;

		const missing: string[] = [];
		if (productLines.length === 0) missing.push("product_lines");
		if (credentials.length === 0) missing.push("credentials");

		return {
			overall,
			buckets: {
				productLines: plScore === null ? null : Math.round(plScore * 100),
				credentials: credScore === null ? null : Math.round(credScore * 100),
			},
			missing,
		};
	});
