import { describe, expect, it } from "vitest";
import {
	formatBeijingTime,
	formatDiagnosticTaskName,
	getShortRunId,
} from "./baseline-task-name";

describe("baseline diagnostic task name formatting", () => {
	it("extracts stable short id from run_id regardless of list changes", () => {
		expect(getShortRunId("run_608dd03e-e79d-42b9-a197-8bc702c428de")).toBe("608dd03e");
		expect(getShortRunId("608dd03e-e79d-42b9-a197-8bc702c428de")).toBe("608dd03e");
		expect(getShortRunId("run_1234")).toBe("1234");
		expect(getShortRunId("")).toBe("");
		expect(getShortRunId(null)).toBe("");
	});

	it("formats date into Asia/Shanghai Beijing time", () => {
		// UTC 08:00 is Beijing 16:00
		const beijingTime = formatBeijingTime("2026-11-01T08:00:00.000Z");
		expect(beijingTime).toBe("2026-11-01 16:00");

		// Unknown/missing time
		expect(formatBeijingTime(null)).toBe("时间未知");
		expect(formatBeijingTime(undefined, false)).toBe("Time unknown");
		expect(formatBeijingTime("invalid-date")).toBe("时间未知");
	});

	it("formats task name in Chinese according to specification", () => {
		const name = formatDiagnosticTaskName({
			brandName: "美的",
			runId: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(name).toBe("美的｜2026-11-01 16:00（北京时间）｜批次608dd03e");
	});

	it("formats task name in English with UTC+8 tag", () => {
		const name = formatDiagnosticTaskName({
			brandName: "Midea",
			runId: "run_608dd03e-e79d-42b9-a197-8bc702c428de",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: false,
		});
		expect(name).toBe("Midea | 2026-11-01 16:00 (UTC+8) | Batch 608dd03e");
	});

	it("handles missing brand name with default placeholder", () => {
		const nameZh = formatDiagnosticTaskName({
			runId: "run_608dd03e",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(nameZh).toBe("未命名品牌｜2026-11-01 16:00（北京时间）｜批次608dd03e");

		const nameEn = formatDiagnosticTaskName({
			runId: "run_608dd03e",
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: false,
		});
		expect(nameEn).toBe("Brand | 2026-11-01 16:00 (UTC+8) | Batch 608dd03e");
	});

	it("handles missing time with unknown time placeholder", () => {
		const nameZh = formatDiagnosticTaskName({
			brandName: "美的",
			runId: "run_608dd03e",
			createdAt: null,
			isZh: true,
		});
		expect(nameZh).toBe("美的｜时间未知｜批次608dd03e");

		const nameEn = formatDiagnosticTaskName({
			brandName: "Midea",
			runId: "run_608dd03e",
			createdAt: null,
			isZh: false,
		});
		expect(nameEn).toBe("Midea | Time unknown | Batch 608dd03e");
	});

	it("falls back to completedAt when createdAt is missing", () => {
		const name = formatDiagnosticTaskName({
			brandName: "美的",
			runId: "run_608dd03e",
			completedAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(name).toBe("美的｜2026-11-01 16:00（北京时间）｜批次608dd03e");
	});

	it("ensures task name is completely deterministic and stable across calls", () => {
		const runA = "run_608dd03e-aaaa-42b9-a197-8bc702c428de";
		const runB = "run_11223344-bbbb-42b9-a197-8bc702c428de";

		// Single call without list
		const nameA1 = formatDiagnosticTaskName({
			brandName: "美的",
			runId: runA,
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		// Second call simulating overview vs banner vs reports
		const nameA2 = formatDiagnosticTaskName({
			brandName: "美的",
			runId: runA,
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(nameA1).toBe(nameA2);
		expect(nameA1).toBe("美的｜2026-11-01 16:00（北京时间）｜批次608dd03e");

		const nameB = formatDiagnosticTaskName({
			brandName: "美的",
			runId: runB,
			createdAt: "2026-11-01T08:00:00.000Z",
			isZh: true,
		});
		expect(nameB).toBe("美的｜2026-11-01 16:00（北京时间）｜批次11223344");
		expect(nameA1).not.toBe(nameB);
	});
});
