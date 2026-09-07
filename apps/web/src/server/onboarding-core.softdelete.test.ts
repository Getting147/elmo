import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstBrandMock, updateMock } = vi.hoisted(() => {
	const findFirstBrandMock = vi.fn();
	const updateMock = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));
	return { findFirstBrandMock, updateMock };
});

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: findFirstBrandMock } },
		update: updateMock,
		insert: vi.fn(),
	},
}));

vi.mock("@workspace/lib/db/provisioning", () => ({ ensureOrganization: vi.fn() }));
vi.mock("@/lib/job-scheduler", () => ({ createMultiplePromptJobSchedulers: vi.fn() }));

import { BrandNotFoundError, saveWizardOnboarding } from "@/server/onboarding-core";

// re CR minor（软删除联动）：已删品牌不可被 onboarding/draft confirm 复活
describe("saveWizardOnboarding 软删除守卫", () => {
	beforeEach(() => {
		findFirstBrandMock.mockReset();
		updateMock.mockClear();
	});

	it("brand.deleted_at 非空 → 拒绝（BrandNotFoundError），不触发任何写", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "brand_del", name: "Gone", deletedAt: new Date("2026-09-07T00:00:00Z") });
		await expect(saveWizardOnboarding({ brandId: "brand_del" })).rejects.toThrow(BrandNotFoundError);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("brand 不存在 → 拒绝（BrandNotFoundError）", async () => {
		findFirstBrandMock.mockResolvedValue(undefined);
		await expect(saveWizardOnboarding({ brandId: "brand_missing" })).rejects.toThrow(BrandNotFoundError);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("brand 正常（deleted_at 为空）→ 守卫通过，进入 updateBrand", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "brand_ok", name: "Alive", deletedAt: null });
		const promise = saveWizardOnboarding({ brandId: "brand_ok" });
		// updateBrand 内部再次 findFirst 拿 website —— 守卫查询后 update 链应被调用
		await promise.catch(() => {});
		expect(updateMock).toHaveBeenCalled();
	});
});
