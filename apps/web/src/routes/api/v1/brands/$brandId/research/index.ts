/**
 * Epic A-2 (V1.0) M2: POST /brands/{id}/research + GET /brands/{id}/research/drafts
 * 草稿状态机入口（创建 + 列表）
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createApiHandler, ApiError } from "@/lib/api/handler";
import {
	researchBrand,
	listDraftsByBrand,
	DraftNotFoundError,
} from "@/server/research";

const postBody = z.object({
	website: z.string().url("website must be a valid URL"),
	maxCompetitors: z.number().int().min(0).max(10).optional(),
	maxPrompts: z.number().int().min(0).max(50).optional(),
	maxProducts: z.number().int().min(0).max(20).optional(),
});

export const Route = createFileRoute("/api/v1/brands/$brandId/research/")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: postBody,
				handle: async ({ params, body }) => {
					const { brandId } = params;
					try {
						const result = await researchBrand({ brandId, website: body.website });
						return result;
					} catch (err) {
						if (err instanceof Error && err.message.includes("Cannot parse website")) {
							throw new ApiError(400, "Validation Error", err.message);
						}
						throw err;
					}
				},
			}),

			GET: createApiHandler({
				handle: async ({ request, params }) => {
					const url = new URL(request.url);
					const includeAll = url.searchParams.get("include_all") === "true";
					const rows = await listDraftsByBrand(params.brandId, includeAll);
					return { drafts: rows };
				},
			}),
		},
	},
});

// re-export for testability
export { DraftNotFoundError };
