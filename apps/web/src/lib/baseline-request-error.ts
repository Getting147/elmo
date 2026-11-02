export class BaselineHttpError extends Error {
	readonly statusCode: number;
	constructor(
		message: string,
		readonly status: number,
		readonly correlationId?: string,
	) {
		super(message);
		this.statusCode = status;
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function baselineResponseError(response: Response): Promise<BaselineHttpError> {
	const text = await response.text();
	let message: string | undefined;
	let body: unknown;
	if (response.headers.get("content-type")?.includes("json")) {
		try {
			body = JSON.parse(text);
		} catch (error) {
			if (!(error instanceof SyntaxError)) throw error;
		}
	}
	if (record(body)) {
		const detail = record(body.detail) ? body.detail : body;
		const value = detail.message ?? body.message ?? (typeof body.detail === "string" ? body.detail : undefined);
		if (typeof value === "string" && !value.trimStart().startsWith("<")) message = value.slice(0, 800);
	}
	const correlationId = response.headers.get("x-correlation-id") ?? response.headers.get("x-request-id") ?? undefined;
	const safeId = correlationId && /^[a-zA-Z0-9_-]{1,100}$/.test(correlationId) ? correlationId : undefined;
	return new BaselineHttpError(
		`${message || (response.status === 504 ? "本次请求等待超时，正在核对任务状态" : "服务响应异常，暂无法确认请求结果")}（HTTP ${response.status}${safeId ? `，关联ID：${safeId}` : ""}）`,
		response.status,
		safeId,
	);
}

export function analysisRequestErrorMessage(error: unknown): string {
	// Server functions serialize Error.message, but a proxy can fail before that boundary.
	if (error instanceof Error && error.message.includes("（HTTP ") && !error.message.includes("<"))
		return error.message;
	return "本次请求响应未确认（可能等待超时或连接中断），正在只读核对任务状态；不会自动重发。";
}

export const baselineBrowserFetch: typeof fetch = async (input, init) => {
	const response = await fetch(input, init);
	if (!response.ok) throw await baselineResponseError(response);
	return response;
};
