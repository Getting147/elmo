/**
 * Epic A-2 (V1.0) M2: GET /drafts/{id} + POST /drafts/{id}/confirm + POST /drafts/{id}/rollback
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ApiError, createApiHandler } from "@/lib/api/handler";
import { confirmDraft, DraftConflictError, DraftNotFoundError, getDraftById, rollbackDraft } from "@/server/research";

/** DraftNotFoundError → 404（GET/POST 统一映射，避免裸 Error 落 500） */
function notFoundMapper(err: unknown): ApiError | undefined {
	if (err instanceof DraftNotFoundError) {
		return new ApiError(404, "Not Found", err.message);
	}
	return undefined;
}

export const Route = createFileRoute("/api/v1/drafts/$draftId/")({
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
