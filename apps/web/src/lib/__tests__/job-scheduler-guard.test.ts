/**
 * REPORT-001E: Web 侧手动调度与机会分析安全守卫单元测试
 *
 * 验证：
 * 1. createPromptJobScheduler 在未显式声明 allowManualTrigger 时返回 false，跳过创建任务；
 * 2. scheduleNextPromptRun 返回 false，禁止自续排；
 */
import { describe, expect, it, vi } from "vitest";
import { createPromptJobScheduler, scheduleNextPromptRun } from "@/lib/job-scheduler";

describe("REPORT-001E Web 调度防护测试", () => {
	it("createPromptJobScheduler 默认手动模式下拒绝入队并返回 false", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const res = await createPromptJobScheduler("prompt_test_123");
		expect(res).toBe(false);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("[Manual Mode] 默认手动模式：跳过为 prompt"),
		);
		consoleLogSpy.mockRestore();
	});

	it("scheduleNextPromptRun 默认手动模式下拒绝续排并返回 false", async () => {
		const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const res = await scheduleNextPromptRun("prompt_test_123", 24);
		expect(res).toBe(false);
		expect(consoleLogSpy).toHaveBeenCalledWith(
			expect.stringContaining("[Manual Mode] 自动周期调度已封禁"),
		);
		consoleLogSpy.mockRestore();
	});
});
