import { describe, expect, it } from "vitest";
import {
	formatBeijingTime,
	formatDiagnosticTaskName,
	getShortRunId,
} from "./baseline-task-name";

describe("baseline-task-name formatting", () => {
	it("derives short batch id correctly", () => {
		expect(getShortRunId("run_608dd03e-e79d-42b9-a197-8bc702c428de")).toBe("608dd03e");
		expect(getShortRunId("608dd03e-e79d-42b9-a197-8bc702c428de")).toBe("608dd03e");
		expect(getShortRunId("run_1234")).toBe("1234");
		expect(getShortRunId("")).toBe("");
		expect(getShortRunId(null)).toBe("");
		expect(getShortRunId(undefined)).toBe("");
	});

	it("converts UTC timestamps to Beijing time (Asia/Shanghai UTC+8)", () => {
		// 2026-11-01 08:00:00 UTC is 2026-11-01 16:00 in Beijing time
		expect(formatBeijingTime("2026-11-01T08:00:00.000Z")).toBe("2026-11-01 16:00");
		// 2026-10-31 23:30:00 UTC is 2026-11-01 07:30 in Beijing time
		expect(formatBeijingTime("2026-10-31T23:30:00.000Z")).toBe("2026-11-01 07:30");
	});

	it("handles missing or invalid dates gracefully", () => {
		expect(formatBeijingTime(null)).toBe("时间未知");
		expect(formatBeijingTime(undefined)).toBe("时间未知");
		expect(formatBeijingTime("invalid-date-string")).toBe("时间未知");
		expect(formatBeijingTime(null, false)).toBe("Time unknown");
		expect(formatBeijingTime("invalid", false)).toBe("Time unknown");
	});

	it("formats full diagnostic task name in standard format (Chinese)", () => {
		const formatted = formatDiagnosticTaskName({
			brandName: "美的",
			runId: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(formatted).toBe("美的｜2026-11-01 16:00（北京时间）｜批次608dd03e");
	});

	it("formats full diagnostic task name with missing date", () => {
		const formatted = formatDiagnosticTaskName({
			brandName: "美的",
			runId: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			createdAt: null,
			isZh: true,
		});
		expect(formatted).toBe("美的｜时间未知｜批次608dd03e");
	});

	it("formats diagnostic task name in English mode", () => {
		const formatted = formatDiagnosticTaskName({
			brandName: "Midea",
			runId: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: false,
		});
		expect(formatted).toBe("Midea | 2026-11-01 16:00 (UTC+8) | Batch 608dd03e");
	});

	it("handles missing brand name gracefully", () => {
		const zh = formatDiagnosticTaskName({
			runId: "run_abcdef12",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(zh).toBe("未命名品牌｜2026-11-01 16:00（北京时间）｜批次abcdef12");

		const en = formatDiagnosticTaskName({
			runId: "run_abcdef12",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: false,
		});
		expect(en).toBe("Brand | 2026-11-01 16:00 (UTC+8) | Batch abcdef12");
	});
});
