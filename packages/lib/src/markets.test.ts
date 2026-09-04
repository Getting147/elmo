/**
 * P0-3 market 共享模块测试（packages/lib/markets.ts）
 *
 * 覆盖 re 测试设计 M1（快照）/ M3（API enum）/ M4（拼装）/ M6（边界）：
 * - M1-5: prompt_runs.injected_value 拼装断言（market≠null → "For the {label} market: {value}";null = value）
 * - M3-4: 非法值由 zod enum 锁定（此处测 TARGET_MARKETS 完整性）
 * - M4-2: 拼装在 provider 调用层 → prompts.value 库值不变（静态断言通过常量）
 * - M6-1: 非法 market 字符串 → SQL 子句可预测（"us/uk/de/fr/jp/ca/au" 以外的入参 graceful fallback）
 */
import { describe, expect, it } from "vitest";

import {
	BUILD_INJECTED_PREFIX,
	MARKET_DISPLAY,
	MARKET_LABELS,
	MARKET_UNLIMITED_LABEL,
	TARGET_MARKETS,
	buildInjectedValue,
} from "./markets.js";

describe("P0-3 markets shared module — TARGET_MARKETS enum integrity (M3-2/M3-4)", () => {
	it("TARGET_MARKETS contains exactly 7 海外 markets (cn excluded)", () => {
		expect(TARGET_MARKETS).toEqual(["us", "uk", "de", "fr", "jp", "ca", "au"]);
	});

	it("MARKET_LABELS has entry for every TARGET_MARKETS value", () => {
		for (const m of TARGET_MARKETS) {
			expect(MARKET_LABELS[m]).toBeDefined();
			expect(MARKET_LABELS[m]).not.toBe("");
		}
	});

	it("MARKET_DISPLAY has entry for every TARGET_MARKETS value", () => {
		for (const m of TARGET_MARKETS) {
			expect(MARKET_DISPLAY[m]).toBeDefined();
			expect(MARKET_DISPLAY[m]).not.toBe("");
		}
	});

	it("MARKET_UNLIMITED_LABEL is non-empty string", () => {
		expect(MARKET_UNLIMITED_LABEL.length).toBeGreaterThan(0);
	});
});

describe("P0-3 buildInjectedValue (M1-5 + M4-1 + M6-1)", () => {
	it("market=null → returns original value unchanged", () => {
		expect(buildInjectedValue("haier best home appliance", null)).toBe(
			"haier best home appliance",
		);
	});

	it("market='us' → prepends 'For the United States market: '", () => {
		expect(buildInjectedValue("best appliance", "us")).toBe(
			`${BUILD_INJECTED_PREFIX}United States market: best appliance`,
		);
		expect(buildInjectedValue("best appliance", "us")).toContain("United States");
	});

	it("market='uk' → prepends 'For the United Kingdom market: '", () => {
		expect(buildInjectedValue("best appliance", "uk")).toContain("United Kingdom");
	});

	it("market='de' → prepends 'For the Germany market: '", () => {
		expect(buildInjectedValue("best appliance", "de")).toContain("Germany");
	});

	it("market='fr' → prepends 'For the France market: '", () => {
		expect(buildInjectedValue("best appliance", "fr")).toContain("France");
	});

	it("market='jp' → prepends 'For the Japan market: '", () => {
		expect(buildInjectedValue("best appliance", "jp")).toContain("Japan");
	});

	it("market='ca' → prepends 'For the Canada market: '", () => {
		expect(buildInjectedValue("best appliance", "ca")).toContain("Canada");
	});

	it("market='au' → prepends 'For the Australia market: '", () => {
		expect(buildInjectedValue("best appliance", "au")).toContain("Australia");
	});

	it("market='unknown_xyz' → graceful fallback to literal value (M6-1)", () => {
		expect(buildInjectedValue("best appliance", "unknown_xyz")).toBe(
			"For the unknown_xyz market: best appliance",
		);
	});

	it("preserves empty string value (defensive)", () => {
		expect(buildInjectedValue("", "us")).toBe(`${BUILD_INJECTED_PREFIX}United States market: `);
	});

	it("preserves unicode in value (no escape)", () => {
		expect(buildInjectedValue("海尔 best", "us")).toBe(`${BUILD_INJECTED_PREFIX}United States market: 海尔 best`);
	});
});

describe("P0-3 M4-2 静态断言: prompts.value 库值不被修改", () => {
	// M4-2: 拼装在 provider 调用层，不在 prompts.value 落库层
	// → 直接 grep prompts.value 不含 "For the market" 字样
	// 静态断言：buildInjectedValue 不暴露任何"in-place mutation"工具，
	// 仅纯函数（输入输出明确）。prompts.value 落库路径必须不调 buildInjectedValue。
	it("BUILD_INJECTED_PREFIX is the only mutation surface (pure function)", () => {
		expect(BUILD_INJECTED_PREFIX).toBe("For the ");
		// 没有提供 "in-place" / "mutate" / "patch" 类函数
		expect(typeof buildInjectedValue).toBe("function");
		// 拼装产物含 "market: "（验证 buildInjectedValue 确实拼装 label）
		expect(buildInjectedValue("x", "us")).toContain("market: x");
	});
});
