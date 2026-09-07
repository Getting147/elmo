/**
 * Epic A-2 (V1.0) M2 c3-job-fix5: processResearchJob handler 契约测试
 *
 * 覆盖 research_status 4 态转移 + CAS 防重入：
 * ① queued → running → analyzeBrand 成功 → payload + research_status='done'
 * ② analyzeBrand 抛错 → research_status='failed' + markFailed({id, error})
 * ③ claim 0 行（已被其他 worker 抢走）→ 静默退出（不 analyzeBrand、不 markFailed）
 * ④ 空 batch → 抛错
 * ⑤ input.crawledPageTexts 序列化数组 → handler 还原 Map 传给 analyzeBrand
 *
 * 策略：db.update chain mock（set/where 记录 + returning 可编程），
 * analyzeBrand / markFailed vi.mock 注入。
 */

import type { Job } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { analyzeBrandMock, markFailedMock, setMock, whereMock, returningMock } = vi.hoisted(() => {
	const analyzeBrandMock = vi.fn();
	const markFailedMock = vi.fn();
	const setMock = vi.fn();
	const whereMock = vi.fn();
	const returningMock = vi.fn();
	return { analyzeBrandMock, markFailedMock, setMock, whereMock, returningMock };
});

vi.mock("@workspace/lib/onboarding", () => ({
	analyzeBrand: analyzeBrandMock,
	validateEvidence: vi.fn(),
	markFailed: markFailedMock,
}));

vi.mock("@workspace/lib/db/schema", () => ({
	draftResearch: { id: "draftResearch.id", researchStatus: "researchStatus" },
}));

vi.mock("@workspace/lib/db/db", () => ({
	db: {
		// update().set(data).where(cond).returning(select) 链 — 每次调用独立 builder
		update: () => ({
			set: (data: unknown) => {
				setMock(data);
				return {
					where: (cond: unknown) => {
						whereMock(cond);
						return { returning: returningMock };
					},
				};
			},
		}),
	},
}));

import { type ProcessResearchJobData, processResearchJob } from "./process-research";

type FakeJob = Job<ProcessResearchJobData>;

function makeJob(overrides?: Partial<ProcessResearchJobData>): FakeJob {
	return {
		data: {
			draftId: "d1",
			brandId: "b1",
			website: "https://x.com",
			additionalDomains: [],
			input: undefined,
			...overrides,
		},
	} as unknown as FakeJob;
}

describe("c3-job-fix5 processResearchJob — 4 态转移", () => {
	beforeEach(() => {
		analyzeBrandMock.mockReset();
		markFailedMock.mockReset();
		setMock.mockClear();
		whereMock.mockClear();
		returningMock.mockReset();
		returningMock.mockResolvedValue([{ id: "d1" }]);
	});

	it("① happy path: queued→running→analyze 成功→payload+done", async () => {
		analyzeBrandMock.mockResolvedValue({ aliases: [], competitors: [] } as never);

		await processResearchJob([makeJob()]);

		// set 调用 1 = claim（running）；set 调用 2 = done
		expect(setMock).toHaveBeenCalledTimes(2);
		expect(setMock.mock.calls[0][0]).toMatchObject({ researchStatus: "running" });
		expect(setMock.mock.calls[1][0]).toMatchObject({ researchStatus: "done" });
		// payload 落库
		expect(setMock.mock.calls[1][0].payload).toMatchObject({ aliases: [] });
		expect(analyzeBrandMock).toHaveBeenCalledWith(
			expect.objectContaining({
				website: "https://x.com",
				maxCompetitors: 10,
				maxPrompts: 30,
				maxProducts: 10,
			}),
		);
		expect(markFailedMock).not.toHaveBeenCalled();
	});

	it("② analyzeBrand 抛错 → running→failed + markFailed({id, error})", async () => {
		analyzeBrandMock.mockRejectedValue(new Error("boom: site unreachable"));

		await processResearchJob([makeJob()]);

		expect(setMock).toHaveBeenCalledTimes(2);
		expect(setMock.mock.calls[1][0]).toMatchObject({ researchStatus: "failed" });
		expect(markFailedMock).toHaveBeenCalledWith({
			id: "d1",
			error: "boom: site unreachable",
		});
	});

	it("③ claim 0 行（已被抢）→ 静默退出：不 analyze、不再 UPDATE", async () => {
		returningMock.mockResolvedValue([]);

		await processResearchJob([makeJob()]);

		expect(analyzeBrandMock).not.toHaveBeenCalled();
		expect(setMock).toHaveBeenCalledTimes(1); // 仅 claim 尝试
		expect(markFailedMock).not.toHaveBeenCalled();
	});

	it("④ 空 batch → 抛错（不进 db 路径）", async () => {
		await expect(processResearchJob([])).rejects.toThrow(/empty batch/);
		expect(analyzeBrandMock).not.toHaveBeenCalled();
	});

	it("⑤ crawledPageTexts 序列化数组 → 还原 Map 传给 analyzeBrand", async () => {
		analyzeBrandMock.mockResolvedValue({ aliases: [] } as never);
		await processResearchJob([
			makeJob({
				input: {
					crawledPageTexts: [
						["home", "text one"],
						["about", "text two"],
					],
				},
			}),
		]);

		const passed = analyzeBrandMock.mock.calls[0][0] as { crawledPageTexts: unknown };
		expect(passed.crawledPageTexts).toBeInstanceOf(Map);
		const map = passed.crawledPageTexts as Map<string, string>;
		expect(map.get("home")).toBe("text one");
		expect(map.get("about")).toBe("text two");
	});
});
