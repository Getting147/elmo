import { z } from "zod";

export const INVALID_REPORT_TASK_LINK = "任务链接参数无效";
const searchSchema = z.object({
	runId: z
		.string()
		.regex(/^[a-zA-Z0-9_-]+$/)
		.optional(),
});

export function validateReportSearch(search: unknown) {
	const result = searchSchema.safeParse(search);
	if (!result.success) throw new Error(INVALID_REPORT_TASK_LINK);
	return result.data;
}
