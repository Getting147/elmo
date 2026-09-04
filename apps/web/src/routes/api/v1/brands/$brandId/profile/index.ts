/**
 * /api/v1/brands/:brandId/profile — 品牌档案详情（Epic A-1）。
 *
 * GET: 一次拉全（product_lines + credentials + completeness）
 * 用途：NegencyGEO 报告层（节点⑦ A-2 报告呈现）+ 外部脚本集成
 * 鉴权：API key（沿用 v1/prompts 的 createApiHandler）
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import {
	brandProductLines,
	brandCredentials,
	competitors,
	brands,
} from "@workspace/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import {
	computeCompleteness,
	completenessTier,
} from "@workspace/lib/profile-completeness";
import { ApiError, createApiHandler } from "@/lib/api/handler";

export const Route = createFileRoute("/api/v1/brands/$brandId/profile/")({
	server: {
		handlers: {
			GET: createApiHandler({
				handle: async ({ params }) => {
					const { brandId } = params;
					// 1. brand 基础信息（用于 completeness 品牌判定 + 404 守卫）
					const brandRow = await db
						.select({
							id: brands.id,
							name: brands.name,
							website: brands.website,
							aliases: brands.aliases,
						})
						.from(brands)
						.where(eq(brands.id, brandId))
						.limit(1);
					if (brandRow.length === 0) {
						throw new ApiError(404, "Not Found", `Brand "${brandId}" not found.`);
					}
					const brand = brandRow[0];

					// 2. competitor count（品牌完整判定 + completeness 输入）
					const competitorRows = await db
						.select({ id: competitors.id })
						.from(competitors)
						.where(eq(competitors.brandId, brandId));
					const competitorCount = competitorRows.length;

					// 3. product lines（按 position ASC 排序）
					const productLines = await db
						.select()
						.from(brandProductLines)
						.where(eq(brandProductLines.brandId, brandId))
						.orderBy(
							asc(brandProductLines.position),
							asc(brandProductLines.createdAt),
						);

					// 4. credentials（按 position ASC 排序）
					const credentials = await db
						.select()
						.from(brandCredentials)
						.where(eq(brandCredentials.brandId, brandId))
						.orderBy(
							asc(brandCredentials.position),
							asc(brandCredentials.createdAt),
						);

					// 5. completeness（共享 lib 模块：与 server fn 同源）
					const completeness = computeCompleteness({
						brand: {
							name: brand.name,
							website: brand.website,
							aliases: brand.aliases,
							competitorCount,
						},
						productLines: productLines.map((pl) => ({
							name: pl.name,
							differentiators: pl.differentiators,
							targetAudience: pl.targetAudience,
						})),
						credentials: credentials.map((c) => ({
							isThirdPartyPublic: c.isThirdPartyPublic,
						})),
					});

					return {
						product_lines: productLines,
						credentials,
						completeness: {
							...completeness,
							tier: completenessTier(completeness.overall),
							warning: completeness.overall < 0.6,
						},
					};
				},
			}),
		},
	},
});
