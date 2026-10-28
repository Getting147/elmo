import { describe, expect, it, vi, beforeEach } from "vitest";
import { listUserOrganizations } from "../helpers";

// Mock the db
vi.mock("@workspace/lib/db/db", () => {
	return {
		db: {
			select: vi.fn(),
		},
	};
});

// Mock server auth
vi.mock("../server", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

describe("BUG-001 B01: listUserOrganizations 软删除品牌与未建档组织隔离", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("正常活跃项目：返回 brandId 与 brandName，且 hasBrand 为 true", async () => {
		const { db } = await import("@workspace/lib/db/db");

		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					leftJoin: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([
							{
								orgId: "org_active",
								orgName: "活跃组织",
								brandId: "brand_active",
								brandName: "活跃品牌",
							},
						]),
					}),
				}),
			}),
		});

		const result = await listUserOrganizations("usr_1");
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: "org_active",
			name: "活跃组织",
			orgId: "org_active",
			brandId: "brand_active",
			brandName: "活跃品牌",
			hasBrand: true,
		});
	});

	it("真正未建档的组织：brandId 为 null 时 fallback 为 orgId，且 hasBrand 为 false", async () => {
		const { db } = await import("@workspace/lib/db/db");

		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					leftJoin: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([
							{
								orgId: "org_empty",
								orgName: "未建档组织",
								brandId: null,
								brandName: null,
							},
						]),
					}),
				}),
			}),
		});

		const result = await listUserOrganizations("usr_1");
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual({
			id: "org_empty",
			name: "未建档组织",
			orgId: "org_empty",
			brandId: "org_empty",
			brandName: "未建档组织",
			hasBrand: false,
		});
	});

	it("只有软删除品牌的组织：被服务端过滤排除后返回空数组", async () => {
		const { db } = await import("@workspace/lib/db/db");

		// 当 SQL WHERE (brands.id IS NULL OR brands.deleted_at IS NULL) 过滤后，
		// 只有软删除品牌的组织在数据库端返回 0 行
		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					leftJoin: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([]),
					}),
				}),
			}),
		});

		const result = await listUserOrganizations("usr_1");
		expect(result).toHaveLength(0);
	});

	it("同组织活跃与已删除项目并存：仅返回活跃品牌行", async () => {
		const { db } = await import("@workspace/lib/db/db");

		// 数据库端 WHERE 过滤掉已删除的 brand_old，仅返回 brand_new
		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnValue({
					leftJoin: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([
							{
								orgId: "org_mixed",
								orgName: "混合组织",
								brandId: "brand_new",
								brandName: "新版品牌",
							},
						]),
					}),
				}),
			}),
		});

		const result = await listUserOrganizations("usr_1");
		expect(result).toHaveLength(1);
		expect(result[0].brandId).toBe("brand_new");
		expect(result[0].hasBrand).toBe(true);
	});
});
