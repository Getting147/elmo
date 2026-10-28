import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstBrandMock, updateMock, selectMock, getSessionMock } = vi.hoisted(() => {
	const findFirstBrandMock = vi.fn();
	const updateMock = vi.fn();
	const selectMock = vi.fn();
	const getSessionMock = vi.fn();
	return { findFirstBrandMock, updateMock, selectMock, getSessionMock };
});

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: findFirstBrandMock } },
		update: updateMock,
		select: selectMock,
		insert: vi.fn(),
	},
}));

vi.mock("@/lib/auth/server", () => ({
	auth: {
		api: {
			getSession: getSessionMock,
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

import { deleteBrandFn } from "./brands";

describe("BUG-001 B01: deleteBrandFn 软删除与陈旧会话幂等验证", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSessionMock.mockResolvedValue({
			user: { id: "usr_alice", role: "member" },
		});
	});

	it("正常活跃品牌：有权限且处于活跃状态，成功标记软删除并返回 deleted: true, alreadyDeleted: false", async () => {
		// Mock requireBrandAccess:
		// 1) select brands -> organizationId = org_1
		// 2) checkOrgAccess -> select member where userId = usr_alice, org = org_1 -> found
		let selectCall = 0;
		selectMock.mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					limit: vi.fn().mockImplementation(async () => {
						selectCall++;
						if (selectCall === 1) {
							return [{ organizationId: "org_1" }];
						}
						if (selectCall === 2) {
							return [{ id: "mem_1" }];
						}
						return [];
					}),
				})),
			})),
		}));

		// Mock update: returning id = brand_active
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: "brand_active" }]),
				}),
			}),
		});

		const result = await (deleteBrandFn as any)({ data: { brandId: "brand_active" } });
		expect(result).toEqual({
			deleted: true,
			brandId: "brand_active",
			alreadyDeleted: false,
		});
	});

	it("陈旧会话/已删除品牌：有权限但已处于软删除状态，幂等返回 deleted: true, alreadyDeleted: true", async () => {
		let selectCall = 0;
		selectMock.mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					limit: vi.fn().mockImplementation(async () => {
						selectCall++;
						if (selectCall === 1) {
							// requireBrandAccess -> brand belongs to org_1
							return [{ organizationId: "org_1" }];
						}
						if (selectCall === 2) {
							// checkOrgAccess -> user is in org_1
							return [{ id: "mem_1" }];
						}
						if (selectCall === 3) {
							// existingBrand check -> already soft deleted!
							return [{ id: "brand_stale", deletedAt: new Date("2026-10-28T00:00:00Z") }];
						}
						return [];
					}),
				})),
			})),
		}));

		// update returns empty (0 rows affected because deletedAt is not null)
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([]),
				}),
			}),
		});

		const result = await (deleteBrandFn as any)({ data: { brandId: "brand_stale" } });
		expect(result).toEqual({
			deleted: true,
			brandId: "brand_stale",
			alreadyDeleted: true,
		});
	});

	it("越权防护：尝试删除他组织品牌时，抛出 Forbidden: No access to this brand", async () => {
		let selectCall = 0;
		selectMock.mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					limit: vi.fn().mockImplementation(async () => {
						selectCall++;
						if (selectCall === 1) {
							// brand belongs to org_other
							return [{ organizationId: "org_other" }];
						}
						// checkOrgAccess -> empty (usr_alice is NOT in org_other)
						return [];
					}),
				})),
			})),
		}));

		await expect((deleteBrandFn as any)({ data: { brandId: "brand_cross_tenant" } })).rejects.toThrow(
			"Forbidden: No access to this brand",
		);
	});

	it("不存在的品牌：抛出 Forbidden: No access to this brand，不伪装删除成功", async () => {
		selectMock.mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					limit: vi.fn().mockResolvedValue([]), // 品牌不存在
				})),
			})),
		}));

		await expect((deleteBrandFn as any)({ data: { brandId: "brand_non_existent" } })).rejects.toThrow(
			"Forbidden: No access to this brand",
		);
	});
});
