/**
 * Epic A-2 (V1.0) M2 c3-job-fix4: triggerResearch 契约测试
 *
 * 策略：纯函数 + 内存 mock。triggerResearch 依赖面：
 * - db.query.brands.findFirst（404 守卫）
 * - createDraft / getDraftById（@workspace/lib/onboarding — partial unique 幂等）
 * - getBoss().send（pg-boss enqueue）
 * 全部 mock，不连 drizzle/pg-boss。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	sendMock,
	findFirstBrandMock,
	createDraftMock,
	getDraftByIdMock,
} = vi.hoisted(() => {
	const sendMock = vi.fn();
	const findFirstBrandMock = vi.fn();
	const createDraftMock = vi.fn();
	const getDraftByIdMock = vi.fn();
	return { sendMock, findFirstBrandMock, createDraftMock, getDraftByIdMock };
});

vi.mock("@/lib/boss-client", () => ({
	getBoss: () => ({ send: sendMock }),
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: findFirstBrandMock } },
	},
}));

vi.mock("@workspace/lib/onboarding", () => ({
	analyzeBrand: vi.fn(),
	validateEvidence: vi.fn(),
	createDraft: createDraftMock,
	getDraftById: getDraftByIdMock,
	listDraftsByBrand: vi.fn(),
	markFailed: vi.fn(),
	markRolledBack: vi.fn(),
}));

import { triggerResearch } from "@/server/research";

describe("c3-job-fix4 triggerResearch 契约", () => {
	beforeEach(() => {
		sendMock.mockReset();
		findFirstBrandMock.mockReset();
		createDraftMock.mockReset();
		getDraftByIdMock.mockReset();
	});

	it("① brand 不存在 → 抛 BrandNotFoundError", async () => {
		findFirstBrandMock.mockReturnValue(undefined);
		await expect(
			triggerResearch({ brandId: "ghost", website: "https://x.com" }),
		).rejects.toThrow(/not found/i);
		expect(createDraftMock).not.toHaveBeenCalled();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("② 新建 draft + enqueue → <100ms 返回 {draftId, alreadyExisted:false, jobSkipped:false}", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		createDraftMock.mockResolvedValue({ id: "d_new", alreadyExisted: false });
		sendMock.mockResolvedValue(undefined);

		const start = Date.now();
		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });
		const elapsed = Date.now() - start;

		expect(result.draftId).toBe("d_new");
		expect(result.alreadyExisted).toBe(false);
		expect(result.jobSkipped).toBe(false);
		expect(elapsed).toBeLessThan(100); // 端点同步 <100ms
		expect(sendMock).toHaveBeenCalledWith(
			"analyze-brand-research",
			expect.objectContaining({ draftId: "d_new", brandId: "b1" }),
		);
	});

	it("③ existed + researchStatus=queued → 跳过 enqueue（防重 job）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		createDraftMock.mockResolvedValue({ id: "d_new", alreadyExisted: true });
		getDraftByIdMock.mockResolvedValue({ researchStatus: "queued" });

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("④ existed + researchStatus=running → 跳过 enqueue（运行中保护）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		createDraftMock.mockResolvedValue({ id: "d_new", alreadyExisted: true });
		getDraftByIdMock.mockResolvedValue({ researchStatus: "running" });

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑤ existed + researchStatus=done → 返 alreadyExisted（done 是历史归档不重跑）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		createDraftMock.mockResolvedValue({ id: "d_new", alreadyExisted: true });
		getDraftByIdMock.mockResolvedValue({ researchStatus: "done" });

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(false);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑥ existed + researchStatus=failed → 返 alreadyExisted（failed 覆盖策略由调用方定）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		createDraftMock.mockResolvedValue({ id: "d_new", alreadyExisted: true });
		getDraftByIdMock.mockResolvedValue({ researchStatus: "failed" });

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(false);
		expect(sendMock).not.toHaveBeenCalled();
	});
});
