/**
 * /api/v1/brands/:brandId/profile/product-lines — 产品线逐条 CRUD（Epic A-1）
 *
 * POST  新增产品线
 * PUT   批量更新（body.productLines = [{id, name, category, ...}]，按 id 走）
 * DELETE 批量删除（body.ids = ["bpl_xxx", ...]）
 *
 * 设计：B3 查重 = warning 不 422（B3 评审调整）
 * 字段约束：A1-2（name+differentiators 必填，targetAudience 必填 = 完整定义三件套）
 *          US-A02：name/category/coreParams/differentiators/targetAudience/position
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import {
	brandProductLines,
	brands,
} from "@workspace/lib/db/schema";
import { eq, inArray, asc } from "drizzle-orm";
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

const createProductLineBody = z.object({
	brandId: z.string().trim().min(1).optional(), // 可省略（path 优先）
	...PRODUCT_LINE_BASE,
});

// B3 查重：lower(trim(differentiators)) 重复检测（warning 不 422）
async function findDuplicateDifferentiator(
	brandId: string,
	differentiators: string,
	excludeId?: string,
): Promise<{ id: string; differentiators: string } | null> {
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

export const Route = createFileRoute("/api/v1/brands/$brandId/profile/product-lines")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: createProductLineBody,
				status: 201,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					await ensureBrandExists(brandId);

					// B3 查重 warning（不阻塞，但响应里给警告）
					const dup = await findDuplicateDifferentiator(brandId, body.differentiators);

					// id 自动生成（PG id text PK 无 default；crypto.randomUUID() 不可预测）
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
						// A1-3 同 brand 不同 id 不串 → 直接返回新 id 确认
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
		},
	},
});
