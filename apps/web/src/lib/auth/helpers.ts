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

export async function checkOrgAccess(userId: string, orgId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
		.limit(1);
	return !!row;
}

export async function requireOrgAccess(userId: string, orgId: string): Promise<void> {
	if (!(await checkOrgAccess(userId, orgId))) {
		throw new Error("Forbidden: No access to this organization");
	}
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
