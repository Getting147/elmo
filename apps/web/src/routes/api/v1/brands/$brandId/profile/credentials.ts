/**
 * /api/v1/brands/:brandId/profile/credentials — 资质背书逐条 CRUD（Epic A-1）
 *
 * POST  新增背书
 * PUT   批量更新（body.credentials = [{id, ...}]，按 id 走）
 * DELETE 批量删除（body.ids = ["bcr_xxx", ...]）
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

// A1-5 cred_type enum 6 值（沿用 schema.ts CRED_TYPES）
const credTypeEnum = z.enum(CRED_TYPES);

// year 宽松 pattern：YYYY / YYYY-YYYY / "至今" / 中文年份（如 2024 年）
const yearPattern = /^\d{4}(-\d{4})?(\s*年)?$|^至今$/;

const createCredentialBody = z.object({
	brandId: z.string().trim().min(1).optional(),
	credType: credTypeEnum,
	name: z.string().trim().min(1, "name is required"),
	year: z
		.string()
		.trim()
		.regex(yearPattern, "year must be YYYY or YYYY-YYYY (optional 年/至今)")
		.optional(),
	isThirdPartyPublic: z.boolean({
		required_error: "is_third_party_public is required (A1-6)",
		invalid_type_error: "is_third_party_public must be boolean (A1-6)",
	}),
	url: z.string().url("url must be valid URL").optional(),
	position: z.number().int().default(0),
});

async function ensureBrandExists(brandId: string): Promise<void> {
	const row = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1);
	if (row.length === 0) {
		throw new ApiError(404, "Not Found", `Brand "${brandId}" not found.`);
	}
}

export const Route = createFileRoute("/api/v1/brands/$brandId/profile/credentials")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: createCredentialBody,
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
		},
	},
});
