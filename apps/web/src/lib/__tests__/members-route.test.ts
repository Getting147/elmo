import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDeploymentMock, getSessionMock, selectMock, createInvitationMock } = vi.hoisted(() => {
	const getDeploymentMock = vi.fn();
	const getSessionMock = vi.fn();
	const selectMock = vi.fn();
	const createInvitationMock = vi.fn();
	return { getDeploymentMock, getSessionMock, selectMock, createInvitationMock };
});

vi.mock("@/lib/config/server", () => ({
	getDeployment: getDeploymentMock,
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		select: selectMock,
	},
}));

vi.mock("@/lib/auth/server", () => ({
	auth: {
		api: {
			getSession: getSessionMock,
			createInvitation: createInvitationMock,
		},
	},
}));

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => ({}),
}));

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: () => ({
			handler: (fn: any) => fn,
		}),
		handler: (fn: any) => fn,
	}),
}));

// Import actual application implementation
import { listTeamFn, inviteTeamMemberFn } from "@/server/team";
import { requireOrgAccess, checkOrgAccess } from "@/lib/auth/helpers";
import { Route, type MembersRouteData } from "@/routes/_authed/app/$brand/settings/members";

describe("BUG-001 B10 / G01: 团队成员服务与路由实际实现及权限边界测试", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("用例 1 (关闭态): teamInvites=false 时执行实际 loader 返回关闭态，实际服务坚决拦截且 0 业务数据查询", async () => {
		getDeploymentMock.mockReturnValue({
			features: {
				teamInvites: false,
			},
		});

		// 1.1 执行实际 Route loader
		const loaderFn = (Route.options as any).loader;
		expect(typeof loaderFn).toBe("function");

		const loaderResult: MembersRouteData = await loaderFn({
			params: { brand: "brand_test" },
		});
		expect(loaderResult.teamInvites).toBe(false);
		expect(loaderResult.data).toBeUndefined();

		// 验证在关闭态 loader 期间，未执行任何底层数据库查询 (0 成员数据泄露)
		expect(selectMock).not.toHaveBeenCalled();

		// 1.2 若绕过 loader 直接调用实际服务端 listTeamFn，验证其实际守卫抛出明确拦截异常
		await expect(
			(listTeamFn as any)({ data: { brandId: "brand_test" } }),
		).rejects.toThrow("Team invitations are not available in this deployment");

		// 1.3 验证实际 inviteTeamMemberFn 同样被关闭态守卫直接拦截，不发出任何邀请
		await expect(
			(inviteTeamMemberFn as any)({
				data: { brandId: "brand_test", email: "test@example.com", role: "member" },
			}),
		).rejects.toThrow("Team invitations are not available in this deployment");
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("用例 2 (开启态): teamInvites=true 时同组织合法用户调用实际服务与 loader，正确返回成员与邀请契约", async () => {
		getDeploymentMock.mockReturnValue({
			features: {
				teamInvites: true,
			},
		});

		// 模拟已登录授权用户
		getSessionMock.mockResolvedValue({
			user: { id: "usr_alice", role: "admin" },
		});

		const now = new Date("2026-11-01T08:00:00.000Z");
		const future = new Date("2026-11-08T08:00:00.000Z");

		let queryIndex = 0;
		selectMock.mockImplementation(() => {
			queryIndex++;
			let resultData: any[] = [];
			const step = ((queryIndex - 1) % 3) + 1;
			if (step === 1) {
				// checkOrgAccess 查询: 返回用户在该组织有效记录
				resultData = [{ id: "mem_alice_org" }];
			} else if (step === 2) {
				// members 联合 user 查询: 返回当前成员
				resultData = [
					{
						id: "mem_1",
						role: "admin",
						userId: "usr_alice",
						name: "Alice",
						email: "alice@example.com",
						createdAt: now,
					},
				];
			} else {
				// invitations 查询: 返回未过期邀请
				resultData = [
					{
						id: "inv_1",
						email: "teammate@example.com",
						role: "member",
						expiresAt: future,
					},
				];
			}

			const builder: any = {
				from: vi.fn(() => builder),
				innerJoin: vi.fn(() => builder),
				where: vi.fn(() => builder),
				limit: vi.fn(async () => resultData),
				then: (onfulfilled: any, onrejected: any) =>
					Promise.resolve(resultData).then(onfulfilled, onrejected),
			};
			return builder;
		});

		// 2.1 执行实际服务端 listTeamFn
		const teamData = await (listTeamFn as any)({ data: { brandId: "org_target" } });
		expect(teamData.currentUserId).toBe("usr_alice");
		expect(teamData.members).toHaveLength(1);
		expect(teamData.members[0].email).toBe("alice@example.com");
		expect(teamData.invitations).toHaveLength(1);
		expect(teamData.invitations[0].email).toBe("teammate@example.com");

		// 2.2 执行实际 Route loader
		const loaderFn = (Route.options as any).loader;
		const loaderResult: MembersRouteData = await loaderFn({
			params: { brand: "org_target" },
		});
		expect(loaderResult.teamInvites).toBe(true);
		expect(loaderResult.data?.members).toHaveLength(1);
		expect(loaderResult.data?.currentUserId).toBe("usr_alice");
	});

	it("用例 3 (未授权/跨组织保护): teamInvites=true 时跨组织用户被实际 requireOrgAccess 坚决拦截，抛出 403", async () => {
		getDeploymentMock.mockReturnValue({
			features: {
				teamInvites: true,
			},
		});

		// 属于 org_other 的用户尝试越权访问 org_target
		getSessionMock.mockResolvedValue({
			user: { id: "usr_attacker", role: "member" },
		});

		// 数据库核验: usr_attacker 在 org_target 下无记录
		selectMock.mockImplementation(() => {
			const builder: any = {
				from: vi.fn(() => builder),
				innerJoin: vi.fn(() => builder),
				where: vi.fn(() => builder),
				limit: vi.fn(async () => []),
				then: (onfulfilled: any, onrejected: any) =>
					Promise.resolve([]).then(onfulfilled, onrejected),
			};
			return builder;
		});

		// 3.1 验证实际 checkOrgAccess 与 requireOrgAccess 真实边界
		const hasAccess = await checkOrgAccess("usr_attacker", "org_target");
		expect(hasAccess).toBe(false);

		await expect(requireOrgAccess("usr_attacker", "org_target")).rejects.toThrow(
			"Forbidden: No access to this organization",
		);

		// 3.2 验证实际 listTeamFn 在权限拦截下抛出异常，绝不向下执行数据查询
		await expect(
			(listTeamFn as any)({ data: { brandId: "org_target" } }),
		).rejects.toThrow("Forbidden: No access to this organization");
	});

	it("用例 4 (未登录拦截): 未登录会话直接被实际 requireAuthSession 拦截", async () => {
		getDeploymentMock.mockReturnValue({
			features: {
				teamInvites: true,
			},
		});

		// 未登录
		getSessionMock.mockResolvedValue(null);

		await expect(
			(listTeamFn as any)({ data: { brandId: "org_target" } }),
		).rejects.toThrow("Unauthorized: Authentication required");
	});
});
