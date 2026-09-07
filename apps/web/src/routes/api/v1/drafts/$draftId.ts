/**
 * Epic A-2 (V1.0) M2: GET /drafts/{id} + POST /drafts/{id}/confirm + POST /drafts/{id}/rollback
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createApiHandler, ApiError } from "@/lib/api/handler";
import {
	getDraftById,
	confirmDraft,
	rollbackDraft,
	DraftNotFoundError,
	DraftConflictError,
} from "@/server/research";

export const Route = createFileRoute("/api/v1/drafts/$draftId/")({
	server: {
		handlers: {
			GET: createApiHandler({
				handle: async ({ params }) => {
					const draft = await getDraftById(params.draftId);
					if (!draft) throw new DraftNotFoundError(params.draftId);
					return draft;
				},
			}),

			// POST 用作子资源动作（confirm / rollback 通过 _action 参数区分）
			POST: createApiHandler({
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
