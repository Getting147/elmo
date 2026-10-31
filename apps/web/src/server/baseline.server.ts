/**
 * /server/baseline.server.ts — 仅限服务端运行的基线通信与权限底层
 *
 * 严格限制：
 * 1. 本文件包含敏感配置与直接数据库访问，严禁被任何客户端组件直接引用；
 * 2. 内部通信 Token 必须由服务端环境变量提供，严禁使用公开默认假 Token；
 * 3. 严格核验组织归属与审核角色门禁；
 * 4. 审核主体使用可信 session.user.id。
 */

import { baselineIdentityHeaders } from "./baseline-identity";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, prompts, brandProductLines, brandCredentials, member } from "@workspace/lib/db/schema";
import { eq, and, isNull, asc } from "drizzle-orm";
import { requireAuthSession, checkOrgAccess, isAdmin, hasReportAccess } from "@/lib/auth/helpers";

/**
 * 获取并核验服务端与 Python 后端通信配置
 */
export function getBaselineConfig(): { apiUrl: string; serviceToken: string; adminToken?: string } {
	const apiUrl = (
		process.env.BASELINE_API_URL ||
		process.env.BASELINE_BACKEND_URL ||
		""
	).replace(/\/$/, "");

	if (!apiUrl) {
		throw new Error(
			"Server configuration error: BASELINE_API_URL (or BASELINE_BACKEND_URL) is not configured in environment.",
		);
	}

	const serviceToken = process.env.BASELINE_SERVICE_TOKEN;
	if (!serviceToken) {
		throw new Error(
			"Server configuration error: BASELINE_SERVICE_TOKEN is not set in server environment. Refusing to use unauthenticated fallback token.",
		);
	}

	const adminToken = process.env.BASELINE_ADMIN_TOKEN;

	return { apiUrl, serviceToken, adminToken };
}

/**
 * 根据 brandId 安全解析其所属 organizationId 与品牌记录
 */
export async function getBrandAndOrg(brandId: string) {
	const [brand] = await db
		.select()
		.from(brands)
		.where(and(eq(brands.id, brandId), isNull(brands.deletedAt)))
		.limit(1);

	if (!brand) {
		throw new Error(`未找到品牌档案或该品牌已被删除: ${brandId}`);
	}

	return {
		brand,
		organizationId: brand.organizationId,
	};
}

/**
 * 校验普通操作员权限（允许发起诊断、保存分析草稿、查看报告）
 */
export async function requireBaselineOperatorAccess(
	session: { user: { id: string; role?: string; hasReportGeneratorAccess?: boolean } },
	organizationId: string,
) {
	const hasAccess = await checkOrgAccess(session.user.id, organizationId);
	if (!hasAccess) {
		throw new Error("Forbidden: No access to this organization");
	}
	return true;
}

/**
 * 校验审核员/管理员权限（仅允许 owner/admin 角色审核并签署报告）(E-R07)
 */
export async function requireBaselineReviewerAccess(
	session: { user: { id: string; role?: string; hasReportGeneratorAccess?: boolean } },
	organizationId: string,
) {
	// 1. 系统级超级管理员直接放行
	if (isAdmin(session as any)) {
		return true;
	}

	// 2. 检查组织内成员角色
	const [m] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.userId, session.user.id), eq(member.organizationId, organizationId)))
		.limit(1);

	if (!m) {
		throw new Error("Forbidden: Not a member of this organization");
	}

	const isOrgAdminOrOwner = m.role === "admin" || m.role === "owner";
	if (!isOrgAdminOrOwner) {
		throw new Error(
			`Forbidden: Current role (${m.role}) is not authorized to review or approve reports. Requires admin or owner role.`,
		);
	}

	return true;
}

/**
 * 服务端统一发起向 Python 后端的鉴权 HTTP 调用
 */
export async function callBaselineBackend<T = any>(args: {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	organizationId: string;
	brandId: string;
	callerId?: string;
	body?: any;
	adminToken?: string;
}): Promise<T> {
	const { apiUrl, serviceToken, adminToken: defaultAdminToken } = getBaselineConfig();
	const url = `${apiUrl}${args.path}`;

	const headers: Record<string, string> = {
		"X-Service-Token": serviceToken,
		...baselineIdentityHeaders(args.organizationId, args.brandId, args.callerId || "elmo-server"),
		"Content-Type": "application/json",
	};

	const effectiveAdminToken = args.adminToken || defaultAdminToken;
	if (effectiveAdminToken) {
		headers["X-Admin-Token"] = effectiveAdminToken;
	}

	const resp = await fetch(url, {
		method: args.method,
		headers,
		body: args.body ? JSON.stringify(args.body) : undefined,
	});

	if (!resp.ok) {
		let errMsg = `Baseline backend error (${resp.status})`;
		try {
			const errBody = await resp.json();
			errMsg =
				errBody.message ||
				errBody.detail?.message ||
				(typeof errBody.detail === "string" ? errBody.detail : JSON.stringify(errBody));
		} catch {
			const text = await resp.text();
			if (text) errMsg = text;
		}
		const err: any = new Error(errMsg);
		err.status = resp.status;
		err.statusCode = resp.status;
		throw err;
	}

	return resp.json();
}
