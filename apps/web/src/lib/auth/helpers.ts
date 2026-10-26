/**
 * Server-side auth helpers backed by better-auth.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";
import { db } from "@workspace/lib/db/db";
import { member, organization, brands } from "@workspace/lib/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { getDeployment } from "@/lib/config/server";
import { auth } from "./server";

type SessionLike = { user: { id: string; [key: string]: unknown }; session?: unknown };

export async function getAuthSession() {
	const headers = getRequestHeaders();
	return auth.api.getSession({ headers });
}

export async function requireAuthSession() {
	const session = await getAuthSession();
	if (!session) throw new Error("Unauthorized: Authentication required");
	return session;
}

export function isAdmin(session: SessionLike): boolean {
	return session.user.role === "admin";
}

export function hasReportAccess(session: SessionLike): boolean {
	// Report generation is disabled entirely in deployments that don't support
	// it (cloud), so the per-user flag is ignored there.
	if (!getDeployment().features.reportGeneration) return false;
	return session.user.hasReportGeneratorAccess === true;
}

export async function checkOrgAccess(userId: string, organizationId: string): Promise<boolean> {
	// 严格核验组织成员身份：明确分开组织鉴权与品牌解析，严禁在组织校验失败时进行猜测式 fallback (E2-R01)
	const [directRow] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
		.limit(1);
	return !!directRow;
}

export async function checkBrandAccess(userId: string, brandId: string): Promise<boolean> {
	// 明确的品牌访问权限核验 helper (E2-R01)
	const [brandRow] = await db
		.select({ organizationId: brands.organizationId })
		.from(brands)
		.where(eq(brands.id, brandId))
		.limit(1);
	if (brandRow?.organizationId) {
		return checkOrgAccess(userId, brandRow.organizationId);
	}
	// 若尚未创建品牌记录（例如 onboarding 阶段），回退检查用户是否属于以该 ID 为组织 ID 的成员
	return checkOrgAccess(userId, brandId);
}

export async function requireOrgAccess(userId: string, orgId: string): Promise<void> {
	if (!(await checkOrgAccess(userId, orgId))) {
		throw new Error("Forbidden: No access to this organization");
	}
}

export async function requireBrandAccess(userId: string, brandId: string): Promise<string> {
	const [brandRow] = await db
		.select({ organizationId: brands.organizationId })
		.from(brands)
		.where(eq(brands.id, brandId))
		.limit(1);
	const targetOrgId = brandRow?.organizationId || brandId;
	if (!(await checkOrgAccess(userId, targetOrgId))) {
		throw new Error("Forbidden: No access to this brand");
	}
	return targetOrgId;
}

export async function listUserOrganizations(userId: string): Promise<{ id: string; name: string }[]> {
	// Hide orgs whose brand was soft-deleted (V1 软删除: 隐藏 + 停扫 + 数据保留)。
	// Left join: orgs without a brand row (rare) stay visible so users can still
	// complete onboarding; orgs whose brand has deleted_at set disappear.
	return db
		.select({ id: organization.id, name: organization.name })
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.leftJoin(brands, eq(brands.organizationId, organization.id))
		.where(
			and(eq(member.userId, userId), or(isNull(brands.id), isNull(brands.deletedAt))),
		);
}
