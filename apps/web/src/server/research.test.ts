/**
 * Epic A-2 (V1.0) M2 c3-job-fix4: triggerResearch + processResearchJob 契约测试
 *
 * 策略：纯函数 + 内存 mock，避免 drizzle + pg-boss 真实连接。
 * 端点契约测试在 CI 完整 env 跑（drizzle 真实连接）。
 */
import { describe, expect, it, vi } from "vitest";

// Mock pg-boss
const sendMock = vi.fn();
vi.mock("@/lib/boss-client", () => ({
	getBoss: () => ({ send: sendMock }),
}));

// Mock drizzle
const findFirstBrandMock = vi.fn();
const findFirstDraftMock = vi.fn();
const updateDraftMock = vi.fn();
const insertDraftMock = vi.fn();
const deleteDraftMock = vi.fn();
const draftResearchTable = { id: "id", brandId: "brandId", state: "state", researchStatus: "researchStatus" };

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: { brands: { findFirst: findFirstBrandMock } },
		update: () => ({ set: () => ({ where: () => ({ returning: () => updateDraftMock() }) }) }),
		insert: () => ({ values: () => insertDraftMock() }),
		delete: () => ({ where: () => ({ returning: () => deleteDraftMock() }) }),
	},
}));

vi.mock("@workspace/lib/db/schema", () => ({
	draftResearch: draftResearchTable,
	brands: { id: "brands.id" },
}));

import { triggerResearch } from "@/server/research";

describe("c3-job-fix4 triggerResearch 契约", () => {
	beforeEach(() => {
		sendMock.mockReset();
		findFirstBrandMock.mockReset();
		findFirstDraftMock.mockReset();
		updateDraftMock.mockReset();
		insertDraftMock.mockReset();
		deleteDraftMock.mockReset();
	});

	it("① brand 不存在 → 抛 BrandNotFoundError", async () => {
		findFirstBrandMock.mockReturnValue(undefined);
		await expect(
			triggerResearch({ brandId: "ghost", website: "https://x.com" }),
		).rejects.toThrow(/not found/i);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("② 新建 draft + enqueue → <100ms 返回 {draftId, alreadyExisted:false, jobSkipped:false}", async () => {
		findFirstBrandMock.mockReturnValue({ id: "b1" });
		insertDraftMock.mockReturnValue([{ id: "d_new" }]);
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
		findFirstBrandMock.mockReturnValue({ id: "b1" });
		insertDraftMock.mockImplementation(() => {
			// 模拟 PG 23505 unique violation → createDraft catch → 返 existing
			const err = new Error("duplicate key");
			(err as { code?: string }).code = "23505";
			throw err;
		});
		findFirstDraftMock.mockReturnValue({ researchStatus: "queued" });
		sendMock.mockReset();

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("④ existed + researchStatus=running → 跳过 enqueue（运行中保护）", async () => {
		findFirstBrandMock.mockReturnValue({ id: "b1" });
		insertDraftMock.mockImplementation(() => {
			const err = new Error("duplicate key");
			(err as { code?: string }).code = "23505";
			throw err;
		});
		findFirstDraftMock.mockReturnValue({ researchStatus: "running" });
		sendMock.mockReset();

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑤ existed + researchStatus=done → 返 alreadyExisted（V1.1 优化：重跑按 trigger 端策略）", async () => {
		findFirstBrandMock.mockReturnValue({ id: "b1" });
		insertDraftMock.mockImplementation(() => {
			const err = new Error("duplicate key");
			(err as { code?: string }).code = "23505";
			throw err;
		});
		findFirstDraftMock.mockReturnValue({ researchStatus: "done" });
		sendMock.mockReset();

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(false); // V1 不再触发（done 是历史归档）
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑥ existed + researchStatus=failed → 返 alreadyExisted（V1.1 优化）", async () => {
		findFirstBrandMock.mockReturnValue({ id: "b1" });
		insertDraftMock.mockImplementation(() => {
			const err = new Error("duplicate key");
			(err as { code?: string }).code = "23505";
			throw err;
		});
		findFirstDraftMock.mockReturnValue({ researchStatus: "failed" });
		sendMock.mockReset();

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(false);
		expect(sendMock).not.toHaveBeenCalled();
	});
});
