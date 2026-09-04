/**
 * /api/v1/brands/:brandId/profile/completeness — 仅完整度（轻量 polling）
 *
 * 区别于 GET /profile：本端点只查 product_lines 计数 + credentials 计数 + competitors 计数，
 * 不返回 product_lines/credentials 完整数据。用于 UI 在编辑表单时频繁轮询完整度状态。
 *
 * 共享 lib modules（@workspace/lib/profile-completeness）— 与 elmo server fn 同源
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import {
	brandProductLines,
	brandCredentials,
	competitors,
	brands,
} from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import {
	computeCompleteness,
	completenessTier,
	isCompletenessWarning,
} from "@workspace/lib/profile-completeness";
import { ApiError, createApiHandler } from "@/lib/api/handler";

export const Route = createFileRoute("/api/v1/brands/$brandId/profile/completeness")({
	server: {
		handlers: {
			GET: createApiHandler({
				handle: async ({ params }) => {
					const { brandId } = params;
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

					// 只取必要字段（name + differentiators + targetAudience + isThirdPartyPublic）
					// + counts（competitorCount + productLines.length + credentials.length）
					const plRows = await db
						.select({
							name: brandProductLines.name,
							differentiators: brandProductLines.differentiators,
							targetAudience: brandProductLines.targetAudience,
						})
						.from(brandProductLines)
						.where(eq(brandProductLines.brandId, brandId));

					const credRows = await db
						.select({ isThirdPartyPublic: brandCredentials.isThirdPartyPublic })
						.from(brandCredentials)
						.where(eq(brandCredentials.brandId, brandId));

					const competitorRows = await db
						.select({ id: competitors.id })
						.from(competitors)
						.where(eq(competitors.brandId, brandId));

					const completeness = computeCompleteness({
						brand: {
							name: brand.name,
							website: brand.website,
							aliases: brand.aliases,
							competitorCount: competitorRows.length,
						},
						productLines: plRows,
						credentials: credRows,
					});

					return {
						overall: completeness.overall,
						brand: completeness.brand,
						product_line: completeness.product_line,
						credential: completeness.credential,
						missing: completeness.missing,
						tier: completenessTier(completeness.overall),
						warning: isCompletenessWarning(completeness.overall),
					};
				},
			}),
		},
	},
});
