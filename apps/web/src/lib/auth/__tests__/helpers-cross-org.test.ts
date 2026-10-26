import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkOrgAccess, checkBrandAccess, requireBrandAccess, requireOrgAccess } from "../helpers";

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

describe("REPORT-001E E2-R01: 组织鉴权与品牌解析严格分离防越权", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("当用户仅属于 org_b 时，checkOrgAccess('usr_b', 'org_a') 必须返回 false，严禁 fallback 猜测", async () => {
		const { db } = await import("@workspace/lib/db/db");

		// Simulate member query returning empty (usr_b is not in org_a)
		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([]),
				}),
			}),
		});

		const hasAccess = await checkOrgAccess("usr_b", "org_a");
		expect(hasAccess).toBe(false);
	});

	it("当用户仅属于 org_b 时，requireOrgAccess 必须抛出 403 异常", async () => {
		const { db } = await import("@workspace/lib/db/db");

		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([]),
				}),
			}),
		});

		await expect(requireOrgAccess("usr_b", "org_a")).rejects.toThrow(
			"Forbidden: No access to this organization",
		);
	});

	it("当品牌 ALPHA 属于 org_a，而用户仅属于 org_b 时，checkBrandAccess('usr_b', 'ALPHA') 必须拒绝", async () => {
		const { db } = await import("@workspace/lib/db/db");

		let callCount = 0;
		(db.select as any).mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					limit: vi.fn().mockImplementation(async () => {
						callCount++;
						if (callCount === 1) {
							// First call: brand lookup -> returns organizationId = 'org_a'
							return [{ organizationId: "org_a" }];
						}
						// Second call: member check for usr_b in org_a -> returns empty
						return [];
					}),
				})),
			})),
		}));

		const hasBrandAccess = await checkBrandAccess("usr_b", "ALPHA");
		expect(hasBrandAccess).toBe(false);
	});

	it("当用户属于 org_a 时，checkBrandAccess 和 requireBrandAccess 正确通过并返回所属组织", async () => {
		const { db } = await import("@workspace/lib/db/db");

		let callCount = 0;
		(db.select as any).mockImplementation(() => ({
			from: vi.fn().mockImplementation(() => ({
				where: vi.fn().mockImplementation(() => ({
					limit: vi.fn().mockImplementation(async () => {
						callCount++;
						if (callCount === 1) {
							// First call: brand lookup -> returns organizationId = 'org_a'
							return [{ organizationId: "org_a" }];
						}
						// Second call: member check for usr_a in org_a -> returns member row
						return [{ id: "mem_a" }];
					}),
				})),
			})),
		}));

		const targetOrg = await requireBrandAccess("usr_a", "ALPHA");
		expect(targetOrg).toBe("org_a");
	});

	it("E3-R01: 当品牌不存在或无组织归属时，直接拒绝且严禁猜测 fallback", async () => {
		const { db } = await import("@workspace/lib/db/db");

		(db.select as any).mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([]), // 品牌不存在
				}),
			}),
		});

		const hasAccess = await checkBrandAccess("usr_a", "NON_EXISTENT_BRAND");
		expect(hasAccess).toBe(false);

		await expect(requireBrandAccess("usr_a", "NON_EXISTENT_BRAND")).rejects.toThrow(
			"Forbidden: No access to this brand",
		);
	});
});
