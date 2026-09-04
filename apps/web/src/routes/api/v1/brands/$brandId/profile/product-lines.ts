/**
 * /api/v1/brands/:brandId/profile/product-lines — 产品线逐条 CRUD（Epic A-1）
 *
 * POST   新增（id 自动生成 `bpl_<uuid>`）
 * PUT    单条更新（body.id 必填；不传 → 422）
 * DELETE 单条删除（body.id 必填；不传 → 422；行不存在 → 404）
 *
 * 设计：B3 查重 = warning 不 422（B3 评审调整）
 * 字段约束：A1-2（name+differentiators 必填，targetAudience 必填）
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import {
	brandProductLines,
	brands,
} from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { ApiError, createApiHandler } from "@/lib/api/handler";

const PRODUCT_LINE_BASE = {
	name: z.string().trim().min(1, "name is required"),
	category: z.string().trim().optional(),
	coreParams: z.string().trim().optional(),
	differentiators: z.string().trim().min(1, "differentiators is required"),
	targetAudience: z.string().trim().min(1, "targetAudience is required"),
	position: z.number().int().default(0),
};

const createBody = z.object({
	brandId: z.string().trim().min(1).optional(),
	...PRODUCT_LINE_BASE,
});

const updateBody = z.object({
	id: z.string().regex(/^bpl_/, "id must start with bpl_"),
	...PRODUCT_LINE_BASE,
});

const deleteBody = z.object({
	id: z.string().regex(/^bpl_/, "id must start with bpl_"),
});

// B3 查重：lower(trim(differentiators)) 重复检测（warning 不 422）
async function findDuplicateDifferentiator(
	brandId: string,
	differentiators: string,
	excludeId?: string,
): Promise<{ id: string } | null> {
	const norm = differentiators.trim().toLowerCase();
	const rows = await db
		.select({ id: brandProductLines.id, differentiators: brandProductLines.differentiators })
		.from(brandProductLines)
		.where(eq(brandProductLines.brandId, brandId));
	for (const r of rows) {
		if (excludeId && r.id === excludeId) continue;
		if (r.differentiators.trim().toLowerCase() === norm) return r;
	}
	return null;
}

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
		.select({ id: brandProductLines.id, brandId: brandProductLines.brandId })
		.from(brandProductLines)
		.where(eq(brandProductLines.id, id))
		.limit(1);
	if (row.length === 0) {
		throw new ApiError(404, "Not Found", `Product line "${id}" not found.`);
	}
	if (row[0].brandId !== brandId) {
		throw new ApiError(
			403,
			"Forbidden",
			`Product line "${id}" does not belong to brand "${brandId}".`,
		);
	}
}

export const Route = createFileRoute("/api/v1/brands/$brandId/profile/product-lines")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: createBody,
				status: 201,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);

					const dup = await findDuplicateDifferentiator(brandId, body.differentiators);

					const id = `bpl_${randomUUID()}`;
					const [row] = await db
						.insert(brandProductLines)
						.values({
							id,
							brandId,
							name: body.name,
							category: body.category ?? null,
							coreParams: body.coreParams ?? null,
							differentiators: body.differentiators,
							targetAudience: body.targetAudience,
							position: body.position,
						})
						.returning();

					return {
						...row,
						warnings: dup
							? [
									{
										field: "differentiators",
										message: `Duplicate differentiators detected (existing id=${dup.id})`,
									},
								]
							: [],
					};
				},
			}),

			PUT: createApiHandler({
				body: updateBody,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);
					await ensureRowBelongsToBrand(brandId, body.id);

					const dup = await findDuplicateDifferentiator(
						brandId,
						body.differentiators,
						body.id, // 排除自己
					);

					const [row] = await db
						.update(brandProductLines)
						.set({
							name: body.name,
							category: body.category ?? null,
							coreParams: body.coreParams ?? null,
							differentiators: body.differentiators,
							targetAudience: body.targetAudience,
							position: body.position,
							// updated_at 自动通过 Drizzle .$onUpdate 维护（A1-10 断言）
						})
						.where(eq(brandProductLines.id, body.id))
						.returning();

					return {
						...row,
						warnings: dup
							? [
									{
										field: "differentiators",
										message: `Duplicate differentiators detected (existing id=${dup.id})`,
									},
								]
							: [],
					};
				},
			}),

			DELETE: createApiHandler({
				body: deleteBody,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);
					await ensureRowBelongsToBrand(brandId, body.id);

					const [row] = await db
						.delete(brandProductLines)
						.where(eq(brandProductLines.id, body.id))
						.returning({ id: brandProductLines.id });

					return { deleted: row[0].id };
				},
			}),
		},
	},
});
