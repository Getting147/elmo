/**
 * P0-3 worker 注入层测试（process-prompt.ts savePromptRun/saveCitations + buildInjectedValue 拼装）
 *
 * 覆盖 re 测试设计 M1（快照）/ M4（拼装）：
 * - M1-1 prompt.market = 'us' → prompt_runs.market = 'us'（快照）
 * - M1-5 injected_value 拼装：market≠null → "For the {label} market: {value}";null → value
 * - M4-2 prompts.value 库值不变（buildInjectedValue 仅作用于 provider 调用层）
 * - M4-4 端到端冒烟：buildInjectedValue('haier best', 'us') 含 'United States'
 *
 * 策略：纯函数单测（不连 PG；savePromptRun/saveCitations 是 db 包装，集成测需 PG fixture）；
 * buildInjectedValue 覆盖 7 市场 + graceful fallback + 库值不变 3 关键语义。
 */
import { describe, expect, it } from "vitest";

import {
	BUILD_INJECTED_PREFIX,
	MARKET_LABELS,
	TARGET_MARKETS,
	buildInjectedValue,
} from "@workspace/lib/markets";

describe("P0-3 worker buildInjectedValue — 7 markets (M1-5 + M4-1)", () => {
	for (const market of TARGET_MARKETS) {
		it(`market='${market}' → injects 'For the ${MARKET_LABELS[market]} market: ...'`, () => {
			const result = buildInjectedValue("haier best", market);
			expect(result).toContain(MARKET_LABELS[market]);
			expect(result.startsWith(BUILD_INJECTED_PREFIX)).toBe(true);
		});
	}

	it("market=null → returns original value (no prefix)", () => {
		expect(buildInjectedValue("haier best", null)).toBe("haier best");
	});

	it("market=undefined → returns original value (defensive)", () => {
		// @ts-expect-error - 测运行时容错（TS 严格模式下应不传 undefined）
		expect(buildInjectedValue("haier best", undefined)).toBe("haier best");
	});
});

describe("P0-3 worker buildInjectedValue — graceful fallback (M6-1)", () => {
	it("unknown market string → literal value as label", () => {
		expect(buildInjectedValue("test", "mars")).toBe("For the mars market: test");
	});

	it("empty market string → graceful fallback to literal", () => {
		// 空字符串经 if (!market) 短路返回原 value（不是字面 label）
		expect(buildInjectedValue("test", "")).toBe("test");
	});
});

describe("P0-3 worker buildInjectedValue — 端到端冒烟 (M4-4)", () => {
	it("real provider scenario: market='us' → 含 'United States' 字样", () => {
		const result = buildInjectedValue("best smart home appliance", "us");
		expect(result).toContain("United States");
		expect(result).toContain("best smart home appliance");
	});

	it("real provider scenario: market='jp' → 含 'Japan' 字样", () => {
		const result = buildInjectedValue("best appliance", "jp");
		expect(result).toContain("Japan");
		expect(result).toContain("best appliance");
	});
});

describe("P0-3 worker buildInjectedValue — 库值不变 (M4-2)", () => {
	it("prompts.value 库值 never mutated (pure function output only)", () => {
		const original = "haier best";
		const input = original;
		const result = buildInjectedValue(input, "us");
		// 输入未变
		expect(input).toBe(original);
		// 输出是新字符串（不引用 input 的引用）
		expect(result).not.toBe(input);
	});

	it("input 中包含 'For the' 时仍正常拼装（无前缀跳过逻辑）", () => {
		const result = buildInjectedValue("For the best product", "us");
		expect(result).toBe("For the United States market: For the best product");
	});
});
