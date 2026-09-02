/**
 * 安全的 UUID 生成器（兼容非 HTTPS/HTTP IP 环境与旧版浏览器/Node）
 */
export function safeUUID(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		try {
			return crypto.randomUUID();
		} catch {
			// fallback
		}
	}
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}
