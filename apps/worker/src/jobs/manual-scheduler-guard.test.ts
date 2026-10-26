/**
 * REPORT-001E: Worker 遗留周期任务消费防护测试
 */
import { describe, expect, it, vi } from "vitest";
import { processPromptJob, type ProcessPromptData } from "./process-prompt";
import type { Job } from "pg-boss";

describe("REPORT-001E Worker 遗留周期任务防护", () => {
	it("默认情况下旧 provider 路径完全禁发，D->C 保持唯一采集责任", async () => {
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const mockJobs: Job<ProcessPromptData>[] = [
			{
				id: "job_legacy_001",
				name: "process-prompt",
				data: {
					promptId: "prompt_legacy_test",
					cadenceHours: 24,
					manualTriggered: true, // Even if true, default is blocked
				},
			} as Job<ProcessPromptData>,
		];

		await processPromptJob(mockJobs);

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("[Safety Guard] 拦截旧 worker provider 路径采样任务"),
		);
		consoleSpy.mockRestore();
	});

	it("在启用 legacy provider 时，遗留未标记 manualTriggered 的任务在执行边界直接被拦截", async () => {
		const originalEnv = process.env.ENABLE_LEGACY_WORKER_PROVIDER;
		process.env.ENABLE_LEGACY_WORKER_PROVIDER = "true";
		const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const mockJobs: Job<ProcessPromptData>[] = [
			{
				id: "job_legacy_002",
				name: "process-prompt",
				data: {
					promptId: "prompt_legacy_test",
					cadenceHours: 24,
					// manualTriggered is undefined
				},
			} as Job<ProcessPromptData>,
		];

		await processPromptJob(mockJobs);

		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining("[Safety Guard] 拦截未经人工显式确认的遗留采样任务"),
		);
		consoleSpy.mockRestore();
		process.env.ENABLE_LEGACY_WORKER_PROVIDER = originalEnv;
	});
});
