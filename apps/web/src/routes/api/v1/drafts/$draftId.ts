/**
 * Epic A-2 (V1.0) M2×M3: GET /drafts/{id} + PATCH payload 回写 + POST confirm/rollback
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ApiError, createApiHandler } from "@/lib/api/handler";
import {
	confirmDraft,
	DraftConflictError,
	DraftNotFoundError,
	getDraftById,
	rollbackDraft,
	updateDraftPayload,
} from "@/server/research";

/** DraftNotFoundError → 404（GET/POST 统一映射，避免裸 Error 落 500） */
function notFoundMapper(err: unknown): ApiError | undefined {
	if (err instanceof DraftNotFoundError) {
		return new ApiError(404, "Not Found", err.message);
	}
	return undefined;
}

/** PATCH 映射：404（不存在）+ 409（非 pending_review） */
function patchErrorMapper(err: unknown): ApiError | undefined {
	if (err instanceof DraftNotFoundError) return new ApiError(404, "Not Found", err.message);
	if (err instanceof DraftConflictError) {
		return new ApiError(409, "Conflict", `Draft is in state "${err.state}" — only pending_review is editable.`);
	}
	return undefined;
}

const skuSchema = z.object({
	name: z.string().trim().min(1, "sku name is required"),
	model: z.string().optional(),
	oneLiner: z.string().trim().min(1, "sku oneLiner is required"),
	evidenceUrl: z.string().trim().min(1, "sku evidenceUrl is required"),
});

const productLineSchema = z.object({
	name: z.string().trim().min(1, "product line name is required"),
	skus: z.array(skuSchema).min(1, "each product line needs at least one SKU"),
});

/** PATCH body — 与 OnboardingSuggestion 部分字段对齐（全部可选 = 部分回写） */
const patchBody = z
	.object({
		summary: z.string().optional(),
		description: z.string().optional(),
		aliases: z.array(z.string()).optional(),
		additionalDomains: z.array(z.string()).optional(),
		competitors: z
			.array(
				z.object({
					name: z.string().trim().min(1, "competitor name is required"),
					domains: z.array(z.string()).optional(),
					aliases: z.array(z.string()).optional(),
				}),
			)
			.optional(),
		prompts: z
			.array(
				z.object({
					prompt: z.string().trim().min(1, "prompt text is required"),
					tags: z.array(z.string()).optional(),
				}),
			)
			.optional(),
		productLines: z
			.array(
				z.object({
					line: productLineSchema,
					evidence: z.number().int().min(0).optional(),
				}),
			)
			.optional(),
	})
	.refine((body) => Object.keys(body).length > 0, { message: "At least one editable field is required" });

export const Route = createFileRoute("/api/v1/drafts/$draftId")({
	server: {
		handlers: {
			GET: createApiHandler({
				mapError: notFoundMapper,
				handle: async ({ params }) => {
					const draft = await getDraftById(params.draftId);
					if (!draft) throw new DraftNotFoundError(params.draftId);
					return draft;
				},
			}),

			// PATCH = 草稿 payload 编辑回写（M3 review 编辑 → confirm 前存 payload 单一真源）
			PATCH: createApiHandler({
				mapError: patchErrorMapper,
				body: patchBody,
				handle: async ({ params, body }) => updateDraftPayload(params.draftId, body),
			}),

			// POST 用作子资源动作（confirm / rollback 通过 _action 参数区分）
			POST: createApiHandler({
				mapError: notFoundMapper,
				body: z.object({
					_action: z.enum(["confirm", "rollback"]),
				}),
				handle: async ({ params, body }) => {
					if (body._action === "confirm") {
						try {
							return await confirmDraft(params.draftId);
						} catch (err) {
							if (err instanceof DraftConflictError) {
								throw new ApiError(
									409,
									"Conflict",
									`Draft is in state "${err.state}" — must be pending_review or confirmed.`,
								);
							}
							throw err;
						}
					} else {
						try {
							await rollbackDraft(params.draftId);
							return { rolledBack: true };
						} catch (err) {
							if (err instanceof DraftConflictError) {
								throw new ApiError(
									409,
									"Conflict",
									`Draft is in state "${err.state}" — only pending_review can rollback.`,
								);
							}
							throw err;
						}
					}
				},
			}),
		},
	},
});
