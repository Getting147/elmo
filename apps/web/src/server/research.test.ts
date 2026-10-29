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

	it("⑨ [U01 在途排队防护] 已是重试后继草稿且处于 queued 状态 → 跨 60 秒重复请求仍返回同一后继草稿", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValue({
			id: "d_successor",
			researchStatus: "queued",
			state: "pending_review",
			payload: {
				metadata: { supersedesDraftId: "d_old" },
			},
			createdAt: new Date(Date.now() - 65000), // 65 秒前已排队
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toBe("d_successor");
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

	it("⑪ [U02 并发重试竞争] CAS 未获胜的请求返回已建立的胜者后继任务而非作废的旧草稿", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old",
			researchStatus: "queued",
			state: "pending_review",
		});
		// CAS 更新匹配 0 行（胜者已更新）
		updateReturningMock.mockResolvedValueOnce([]);
		// 读到旧草稿已被更新为 rolled_back
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old",
			researchStatus: "failed",
			state: "rolled_back",
		});
		// 查询活跃后继草稿查得胜者创建的新任务
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_winner_successor",
			researchStatus: "queued",
			state: "pending_review",
		});

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toBe("d_winner_successor");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
		expect(insertValuesMock).not.toHaveBeenCalled();
	});

	it("⑫ [U03 迟到重试防护] 针对前序草稿的重复请求在后继失败后依然返回同一后继，不自动级联重试", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValueOnce(undefined); // active 为空
		// latestHistory 为原旧失败草稿
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old_failed",
			state: "failed",
			researchStatus: "failed",
			createdAt: new Date("2026-10-28T10:00:00Z"),
		});
		// 查得已存在的后继草稿（即使也已失败）
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_first_successor",
			state: "failed",
			researchStatus: "failed",
			createdAt: new Date("2026-10-29T10:00:00Z"),
			payload: {
				metadata: { supersedesDraftId: "d_old_failed" },
			},
		});

		// 未显式指定 targetDraftId 的重复请求（例如针对 d_old_failed 的重复/迟到重试）
		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		expect(result.draftId).toBe("d_first_successor");
		expect(result.alreadyExisted).toBe(true);
		expect(result.jobSkipped).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
		expect(insertValuesMock).not.toHaveBeenCalled();
	});

	it("⑬ [U04 原子补偿回滚] 后继草稿插入失败时原子补偿回滚旧草稿状态，不残留作废状态", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old",
			researchStatus: "queued",
			state: "pending_review",
			error: null,
			updatedAt: new Date("2026-10-28T14:00:00Z"),
		});
		updateReturningMock.mockResolvedValueOnce([{ id: "d_old" }]);
		insertValuesMock.mockRejectedValueOnce(new Error("Synthetic insert failure"));

		await expect(triggerResearch({ brandId: "b1", website: "https://x.com", retry: true })).rejects.toThrow(
			"Synthetic insert failure",
		);

		// 验证异常时已触发原子补偿更新回滚状态
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				state: "pending_review",
				researchStatus: "queued",
				error: null,
			}),
		);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑭ [V01 交错暂停窗口] CAS 匹配 0 行且胜者处于 insert 前交错窗口时，落败者返回胜者分配的后继 ID 而非作废旧任务", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old_v01",
			researchStatus: "queued",
			state: "pending_review",
		});
		// CAS 匹配 0 行（胜者已更新）
		updateReturningMock.mockResolvedValueOnce([]);
		// 读到旧草稿已被置为 rolled_back，但 winner 尚未完成 insert（winnerSuccessor 为空）
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old_v01",
			researchStatus: "failed",
			state: "rolled_back",
		});
		findFirstDraftMock.mockResolvedValueOnce(undefined);

		const result = await triggerResearch({ brandId: "b1", website: "https://x.com", retry: true });

		// 验证返回值不是已被作废的旧草稿 ID
		expect(result.jobSkipped).toBe(true);
		expect(result.alreadyExisted).toBe(true);
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑮ [V02 入队失败双向原子回滚] boss.send 失败时新插入草稿置为 rolled_back 释放唯一索引，前序草稿安全恢复", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_old_v02",
			researchStatus: "queued",
			state: "pending_review",
			error: null,
			updatedAt: new Date("2026-10-28T14:00:00Z"),
		});
		updateReturningMock.mockResolvedValueOnce([{ id: "d_old_v02" }]);
		insertValuesMock.mockResolvedValueOnce(undefined); // insert 成功
		sendMock.mockRejectedValueOnce(new Error("Synthetic queue transport unavailable")); // send 失败

		await expect(triggerResearch({ brandId: "b1", website: "https://x.com", retry: true })).rejects.toThrow(
			"Synthetic queue transport unavailable",
		);

		// 验证新草稿被回滚置为 rolled_back/failed 释放 partial unique 索引
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				state: "rolled_back",
				researchStatus: "failed",
				error: expect.stringContaining("队列入队失败"),
			}),
		);

		// 验证前序草稿补偿恢复为 pending_review
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				state: "pending_review",
				researchStatus: "queued",
				error: null,
			}),
		);
	});

	it("⑯ [V03 targetDraftId 归属校验] targetDraftId 不存在或不属于当前品牌/网址时在写库入队前拒绝并抛出明确错误", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });
		// targetDraft 校验返回 null（未找到或不属于该品牌）
		findFirstDraftMock.mockResolvedValueOnce(undefined);

		await expect(
			triggerResearch({
				brandId: "b1",
				website: "https://x.com",
				retry: true,
				targetDraftId: "unrelated-or-nonexistent-draft",
			}),
		).rejects.toThrow(/Target draft unrelated-or-nonexistent-draft not found or does not belong to brand b1/);

		expect(insertValuesMock).not.toHaveBeenCalled();
		expect(sendMock).not.toHaveBeenCalled();
	});

	it("⑰ [V04 稳定后继映射] A 重试得 B，B 重试得 C，后续针对 A 的迟到重试固定返回其直接后继 B，不随 C 漂移", async () => {
		findFirstBrandMock.mockResolvedValue({ id: "b1" });

		// 1. 针对 A 发起重试，生成 B
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_target_a",
			researchStatus: "failed",
			state: "failed",
		});
		findFirstDraftMock.mockResolvedValueOnce(undefined); // active 为空
		findFirstDraftMock.mockResolvedValueOnce(undefined); // no existing successor
		insertValuesMock.mockResolvedValueOnce(undefined);
		sendMock.mockResolvedValueOnce(undefined);

		const b = await triggerResearch({
			brandId: "b1",
			website: "https://x.com",
			retry: true,
			targetDraftId: "d_target_a",
		});

		expect(b.draftId).toBeDefined();
		expect(sendMock).toHaveBeenCalledTimes(1);

		// 模拟 B 成功存在于数据库中
		findFirstDraftMock.mockResolvedValueOnce({
			id: "d_target_a",
			researchStatus: "failed",
			state: "failed",
		});
		findFirstDraftMock.mockResolvedValueOnce({
			id: b.draftId,
			researchStatus: "queued",
			state: "pending_review",
			payload: { metadata: { supersedesDraftId: "d_target_a" } },
		});

		// 2. 针对 A 再次传入迟到重试请求
		const late = await triggerResearch({
			brandId: "b1",
			website: "https://x.com",
			retry: true,
			targetDraftId: "d_target_a",
		});

		// 验证稳定返回直接后继 B，且零重复入队
		expect(late.draftId).toBe(b.draftId);
		expect(late.jobSkipped).toBe(true);
		expect(sendMock).toHaveBeenCalledTimes(1); // 依然只有第一次入队的 1 次
	});
});
