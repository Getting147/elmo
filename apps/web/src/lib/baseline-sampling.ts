export const DEFAULT_SAMPLING_OUTPUT_TOKENS = 16384;

export function samplingUsageCount(value: unknown): number | "未知" | "格式异常" {
	if (value === undefined || value === null) return "未知";
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : "格式异常";
}

export function samplingOutputTokens(explicit: number | undefined, authorization?: number | null): number {
	if (authorization === null) throw new Error("本轮授权未明确输出 Token 上限，请重新核对费用并确认授权。");
	const value = explicit ?? authorization ?? DEFAULT_SAMPLING_OUTPUT_TOKENS;
	if (!Number.isInteger(value) || value <= 0) throw new Error("输出 Token 上限必须是正整数。");
	if (authorization !== undefined && value > authorization)
		throw new Error(`本轮输出 Token ${value} 超过授权上限 ${authorization}，请重新核对费用并确认。`);
	return value;
}
