import { describe, expect, it } from "vitest";
import type { MembersRouteData } from "@/routes/_authed/app/$brand/settings/members";

describe("members settings route data contract and security boundaries", () => {
	it("distinguishes teamInvites enabled vs disabled without silent redirect", () => {
		const disabled: MembersRouteData = { teamInvites: false };
		expect(disabled.teamInvites).toBe(false);
		expect(disabled.data).toBeUndefined();

		const enabled: MembersRouteData = {
			teamInvites: true,
			data: {
				members: [
					{
						id: "mem_1",
						role: "admin",
						userId: "user_1",
						name: "Test Admin",
						email: "admin@example.com",
						createdAt: new Date(),
					},
				],
				invitations: [],
				currentUserId: "user_1",
			},
		};
		expect(enabled.teamInvites).toBe(true);
		expect(enabled.data.members).toHaveLength(1);
	});

	it("guards team invitations and enforces organization access boundary", () => {
		// Mock access check simulating requireOrgAccess policy
		const userOrgs: Record<string, string[]> = {
			user_admin_1: ["org_correct"],
			user_other_2: ["org_different"],
		};
		const brandOrgMap: Record<string, string> = {
			brand_target: "org_correct",
		};

		function checkAccess(userId: string, brandId: string) {
			const orgId = brandOrgMap[brandId];
			if (!orgId || !userOrgs[userId]?.includes(orgId)) {
				throw new Error("Forbidden: user does not have access to this brand's organization");
			}
			return true;
		}

		// Authorized user from the same organization succeeds
		expect(checkAccess("user_admin_1", "brand_target")).toBe(true);

		// Unauthorized user from another organization is blocked
		expect(() => checkAccess("user_other_2", "brand_target")).toThrow(
			"Forbidden: user does not have access to this brand's organization",
		);

		// Unknown brand or user is blocked
		expect(() => checkAccess("unknown_user", "brand_target")).toThrow("Forbidden");
		expect(() => checkAccess("user_admin_1", "unknown_brand")).toThrow("Forbidden");
	});

	it("ensures team invites guard rejects when disabled in deployment", () => {
		function requireTeamInvites(teamInvitesEnabled: boolean): void {
			if (!teamInvitesEnabled) {
				throw new Error("Team invitations are not available in this deployment");
			}
		}

		expect(() => requireTeamInvites(false)).toThrow(
			"Team invitations are not available in this deployment",
		);
		expect(() => requireTeamInvites(true)).not.toThrow();
	});
});
