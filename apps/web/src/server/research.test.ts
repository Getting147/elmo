/**
 * Epic A-2 (V1.0) M2 c3-job-fix4 & BUG-001 B02 (S02/S04): triggerResearch 契约与恢复逻辑测试
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	sendMock,
	findFirstBrandMock,
	findFirstDraftMock,
	insertValuesMock,
	updateSetMock,
	updateReturningMock,
	dbExecuteMock,
} = vi.hoisted(() => {
	const sendMock = vi.fn();
	const findFirstBrandMock = vi.fn();
	const findFirstDraftMock = vi.fn();
	const insertValuesMock = vi.fn();
	const updateReturningMock = vi.fn().mockResolvedValue([{ id: "d_updated" }]);
	const updateWhereMock = vi.fn(() =>
		Object.assign(Promise.resolve([{ id: "d_updated" }]), {
			returning: updateReturningMock,
		}),
	);
	const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
	const dbExecuteMock = vi.fn();
	return {
		sendMock,
		findFirstBrandMock,
		findFirstDraftMock,
		insertValuesMock,
		updateSetMock,
		updateReturningMock,
		dbExecuteMock,
	};
});

vi.mock("@/lib/boss-client", () => ({
	getBoss: () => ({ send: sendMock }),
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: {
			brands: { findFirst: findFirstBrandMock },
			draftResearch: { findFirst: findFirstDraftMock },
		},
		insert: () => ({ values: insertValuesMock }),
		update: () => ({ set: updateSetMock }),
		execute: dbExecuteMock,
	},
}));

vi.mock("@workspace/lib/onboarding", () => ({
	hashUrlForDraft: (url: string) => `hash_${url}`,
	computeExpiresAt: () => new Date("2026-11-28T00:00:00Z"),
	emptySuggestionPayload: (args: { website: string; additionalDomains?: string[] }) => ({
		brandName: "",
		summary: "",
		description: "",
		website: args.website,
		aliases: [],
		additionalDomains: args.additionalDomains ?? [],
		productLines: [],
		competitors: [],
		suggestedPrompts: [],
	}),
	getDraftById: vi.fn(),
	listDraftsByBrand: vi.fn(),
	confirmDraftResearch: vi.fn(),
	rollbackDraftResearch: vi.fn(),
}));

import { triggerResearch } from "@/server/research";

describe("triggerResearch 契约与恢复逻辑 (B02 S02/S04)", () => {
	beforeEach(() => {
		sendMock.mockReset();
		findFirstBrandMock.mockReset();
		findFirstDraftMock.mockReset();
		insertValuesMock.mockReset();
		updateSetMock.mockClear();
		updateReturningMock.mockReset();
		updateReturningMock.mockResolvedValue([{ id: "d_updated" }]);
		dbExecuteMock.mockReset();
	});

	it("① brand 不存在 → 抛 BrandNotFoundError", async () => {
		findFirstBrandMock.mockResolvedValue(undefined);
		await expect(triggerResearch({ brandId: "ghost", website: "https://x.com" })).rejects.toThrow(/not found/i);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("② 新建 draft + enqueue → 返回 {draftId, alreadyExisted:false, jobSkipped:false}", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue(undefined);
		insertValuesMock.mockResolvedValue(undefined);
		sendMock.mockResolvedValue(undefined);

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.draftId).toMatch(/^dres_/);
		expect(result.alreadyExisted).toBe(false);
		expect(result.jobSkipped).toBe(false);
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				brandId: "b1",
				urlHash: "hash_https://x.com",
				researchStatus: "queued",
			}),
		);
		expect(sendMock).toHaveBeenCalledWith(
			"analyze-brand-research",
			expect.objectContaining({ draftId: result.draftId, brandId: "b1" }),
		);
	});

	it("③ existed + researchStatus=queued 且 retry=false → 跳过 enqueue（防重复 job）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue({
			id: "d_existing",
			researchStatus: "queued",
			state: "pending_review",
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: false });

		expect(result.draftId).toBe("d_existing");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("④ [S02 定向核验] existed + researchStatus=running 且后台任务未终止 → 严禁重复入队（即使 retry=true）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue({
			id: "d_running",
			researchStatus: "running",
			state: "pending_review",
			updatedAt: new Date(Date.now() - 360000), // 已运行 6 分钟
		});
		// pg-boss 任务状态为 active（后台正在处理中）
		dbExecuteMock.mockResolvedValue({ rows: [{ state: "active" }] });

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toBe("d_running");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled(); // 零重复入队
		expect(updateSetMock).not.toHaveBeenCalled(); // 零写回
	});

	it("⑤ existed + researchStatus=done → 返回已存在结果并跳过入队（done 是最终结果不重跑）", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue({
			id: "d_done",
			researchStatus: "done",
			state: "pending_review",
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.draftId).toBe("d_done");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑥ [S04 定向核验] existed + researchStatus=failed 且 retry=true → 物理保全旧草稿及原错误，新建独立草稿，仅投递 1 个新 job", async () => {
		const originalCreatedAt = new Date("2026-10-28T10:00:00Z");
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue({
			id: "d_failed_old",
			researchStatus: "failed",
			state: "pending_review",
			error: "Network timeout",
			createdAt: originalCreatedAt,
		});
		updateReturningMock.mockResolvedValue([{ id: "d_failed_old" }]);
		insertValuesMock.mockResolvedValue(undefined);
		sendMock.mockResolvedValue(undefined);

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toMatch(/^dres_/);
		expect(result.draftId).not.toBe("d_failed_old");
		expect(result.alreadyExisted).toBe(false);
		expect(result.jobSkipped).toBe(false);

		// 检查旧草稿是否被安全归档且保留原错误
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				state: "rolled_back",
				researchStatus: "failed",
				error: expect.stringContaining("Network timeout"),
			}),
		);
		// update 绝对没有改写 createdAt
		expect(updateSetMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				createdAt: expect.anything(),
			}),
		);

		// 检查新草稿是否包含对旧草稿的关联
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: result.draftId,
				brandId: "b1",
				researchStatus: "queued",
				payload: expect.objectContaining({
					metadata: expect.objectContaining({
						supersedesDraftId: "d_failed_old",
					}),
				}),
			}),
		);

		// 队列只投递 1 次且携带新 draftId
		expect(sendMock).toHaveBeenCalledTimes(1);
		expect(sendMock).toHaveBeenCalledWith(
			"analyze-brand-research",
			expect.objectContaining({ draftId: result.draftId }),
		);
	});

	it("⑦ [P1 / T06 CAS 原子防护] worker 在读取与更新之间抢占草稿（queued -> running）→ CAS 匹配 0 行，不二次投递新 job", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		// 第一次读到 queued 状态（快照）
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_racing",
			researchStatus: "queued",
			state: "pending_review",
			createdAt: new Date("2026-10-28T10:00:00Z"),
		});
		// CAS 更新匹配 0 行（因为 worker 已经把 status 改为 running）
		updateReturningMock.mockResolvedValue([]);
		// 重新读取最新状态返回 running
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_racing",
			researchStatus: "running",
			state: "pending_review",
			createdAt: new Date("2026-10-28T10:00:00Z"),
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toBe("d_racing");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
		expect(insertValuesMock).not.toHaveBeenCalled();
	});

	it("⑧ [P2 / T05 历史失败恢复] active 草稿为空但历史存在 failed 草稿 → retry 成功建立后继草稿关联，不改写历史", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		// 1. active 查询返回 undefined（因原草稿已是 state='failed'）
		findFirstDraftMock.mockResolvedValueOnce(undefined);
		// 2. 历史查询返回最近的 failed 草稿
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_history_failed",
			researchStatus: "failed",
			state: "failed",
			error: "Synthetic 401",
			createdAt: new Date("2026-10-28T10:00:00Z"),
		});
		insertValuesMock.mockResolvedValue(undefined);
		sendMock.mockResolvedValue(undefined);

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toMatch(/^dres_/);
		expect(result.alreadyExisted).toBe(false);
		expect(result.jobSkipped).toBe(false);

		// 新草稿 payload.metadata 必须保留对历史失败草稿的关联
		expect(insertValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: result.draftId,
				payload: expect.objectContaining({
					metadata: expect.objectContaining({
						supersedesDraftId: "d_history_failed",
					}),
				}),
			}),
		);
		expect(sendMock).toHaveBeenCalledTimes(1);
	});

	it("⑨ [防连续点击 / 60s 在途防护] queued 草稿创建未满 60 秒 → 即使 retry=true 也跳过入队", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue({
			id: "d_recent",
			researchStatus: "queued",
			state: "pending_review",
			createdAt: new Date(Date.now() - 5000), // 5 秒前刚刚排队
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toBe("d_recent");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
		expect(insertValuesMock).not.toHaveBeenCalled();
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it("⑩ [并发唯一约束捕获] 多标签页同时触发导致 23505 冲突 → 自动查询并返回胜者草稿，不重复入队", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValueOnce(undefined); // 初始未发现 active
		const conflictErr = Object.assign(new Error("synthetic partial unique violation"), { code: "23505" });
		insertValuesMock.mockRejectedValueOnce(conflictErr);
		// 捕获冲突后查得并发插入的胜者草稿
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_winner",
			researchStatus: "queued",
			state: "pending_review",
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com" });

		expect(result.draftId).toBe("d_winner");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});
});
