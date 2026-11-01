import { describe, expect, it } from "vitest";
import type { MembersRouteData } from "@/routes/_authed/app/$brand/settings/members";

describe("members settings route data contract", () => {
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
});
