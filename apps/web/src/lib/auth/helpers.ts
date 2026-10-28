/**
 * Server-side auth helpers backed by better-auth.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";
import { db } from "@workspace/lib/db/db";
import { brands, member, organization } from "@workspace/lib/db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
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
	// 明确的品牌访问权限核验 helper (E2-R01 / E3-R01)
	const [brandRow] = await db
		.select({ organizationId: brands.organizationId })
		.from(brands)
		.where(eq(brands.id, brandId))
		.limit(1);
	if (!brandRow?.organizationId) {
		// 严禁对不存在或无组织的 brand 进行猜测式 fallback，无所属者直接拒绝 (E3-R01)
		return false;
	}
	return checkOrgAccess(userId, brandRow.organizationId);
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
	if (!brandRow?.organizationId) {
		throw new Error("Forbidden: No access to this brand");
	}
	if (!(await checkOrgAccess(userId, brandRow.organizationId))) {
		throw new Error("Forbidden: No access to this brand");
	}
	return brandRow.organizationId;
}

export interface UserOrgEntry {
	id: string; // 保持组织 ID（即 organization.id），确保原有的 orgIds.map(o => o.id) 契约不被破坏
	name: string;
	orgId: string;
	brandId: string; // 真实 brand.id (若未建 brand 则为 orgId)
	brandName: string;
	hasBrand?: boolean; // false 表示真正未建档的组织 (brands 表中无对应记录)
}

export async function listUserOrganizations(userId: string): Promise<UserOrgEntry[]> {
	// 软删除过滤 (B01): 区分“未建档”与“已删除”状态。
	// LEFT JOIN brands 关联全部品牌记录。
	// WHERE 过滤：仅允许真实未建档组织 (brands.id IS NULL) 或活跃品牌 (brands.deletedAt IS NULL)。
	// 当组织下品牌均已软删除时，该行 deletedAt 非空，被 WHERE 过滤掉，不再错误 fallback 冒充未建档组织。
	const rows = await db
		.select({
			orgId: organization.id,
			orgName: organization.name,
			brandId: brands.id,
			brandName: brands.name,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.leftJoin(brands, eq(brands.organizationId, organization.id))
		.where(and(eq(member.userId, userId), or(isNull(brands.id), isNull(brands.deletedAt))));

	return rows.map((r) => ({
		id: r.orgId,
		name: r.orgName,
		orgId: r.orgId,
		brandId: r.brandId || r.orgId,
		brandName: r.brandName || r.orgName,
		hasBrand: !!r.brandId,
	}));
}
