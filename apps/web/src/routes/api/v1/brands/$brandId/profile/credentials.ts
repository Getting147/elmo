/**
 * /api/v1/brands/:brandId/profile/credentials — 资质背书逐条 CRUD（Epic A-1）
 *
 * POST   新增（id 自动生成 `bcr_<uuid>`）
 * PUT    单条更新（body.id 必填）
 * DELETE 单条删除（body.id 必填）
 *
 * 设计：A1-5 cred_type enum 6 值 + A1-6 is_third_party_public 必填布尔
 *       year TEXT 宽松 pattern（兼容 "2023-2024" / "至今"）
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import {
	brandCredentials,
	brands,
	CRED_TYPES,
} from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ApiError, createApiHandler } from "@/lib/api/handler";

const credTypeEnum = z.enum(CRED_TYPES);

// year 宽松 pattern：YYYY / YYYY-YYYY / "至今" / 中文年份（如 2024 年）
const yearPattern = /^\d{4}(-\d{4})?(\s*年)?$|^至今$/;

const credentialBase = {
	credType: credTypeEnum,
	name: z.string().trim().min(1, "name is required"),
	year: z
		.string()
		.trim()
		.regex(yearPattern, "year must be YYYY or YYYY-YYYY (optional 年/至今)")
		.optional(),
	isThirdPartyPublic: z.boolean({
		message: "is_third_party_public is required and must be boolean (A1-6)",
	}),
	url: z.string().url("url must be valid URL").optional(),
	position: z.number().int().default(0),
};

const createBody = z.object({
	brandId: z.string().trim().min(1).optional(),
	...credentialBase,
});

const updateBody = z.object({
	id: z.string().regex(/^bcr_/, "id must start with bcr_"),
	...credentialBase,
});

const deleteBody = z.object({
	id: z.string().regex(/^bcr_/, "id must start with bcr_"),
});

async function ensureBrandExists(brandId: string): Promise<void> {
	const row = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1);
	if (row.length === 0) {
		throw new ApiError(404, "Not Found", `Brand "${brandId}" not found.`);
	}
}

async function ensureRowBelongsToBrand(
	brandId: string,
	id: string,
): Promise<void> {
	const row = await db
		.select({ id: brandCredentials.id, brandId: brandCredentials.brandId })
		.from(brandCredentials)
		.where(eq(brandCredentials.id, id))
		.limit(1);
	if (row.length === 0) {
		throw new ApiError(404, "Not Found", `Credential "${id}" not found.`);
	}
	if (row[0].brandId !== brandId) {
		throw new ApiError(
			403,
			"Forbidden",
			`Credential "${id}" does not belong to brand "${brandId}".`,
		);
	}
}

export const Route = createFileRoute("/api/v1/brands/$brandId/profile/credentials")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: createBody,
				status: 201,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);

					const id = `bcr_${randomUUID()}`;
					const [row] = await db
						.insert(brandCredentials)
						.values({
							id,
							brandId,
							credType: body.credType,
							name: body.name,
							year: body.year ?? null,
							isThirdPartyPublic: body.isThirdPartyPublic,
							url: body.url ?? null,
							position: body.position,
						})
						.returning();

					return row;
				},
			}),

			PUT: createApiHandler({
				body: updateBody,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);
					await ensureRowBelongsToBrand(brandId, body.id);

					const [row] = await db
						.update(brandCredentials)
						.set({
							credType: body.credType,
							name: body.name,
							year: body.year ?? null,
							isThirdPartyPublic: body.isThirdPartyPublic,
							url: body.url ?? null,
							position: body.position,
							// updated_at 自动通过 Drizzle .$onUpdate 维护
						})
						.where(eq(brandCredentials.id, body.id))
						.returning();

					return row;
				},
			}),

			DELETE: createApiHandler({
				body: deleteBody,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);
					await ensureRowBelongsToBrand(brandId, body.id);

					const deleted = await db
						.delete(brandCredentials)
						.where(eq(brandCredentials.id, body.id))
						.returning({ id: brandCredentials.id });

					if (deleted.length === 0 || !deleted[0]) {
						throw new ApiError(500, "Internal Error", "Delete returned no row.");
					}
					return { deleted: deleted[0].id };
				},
			}),
		},
	},
});
