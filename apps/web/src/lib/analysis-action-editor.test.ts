import { describe, expect, it } from "vitest";
import { formatActionPlan, parseActionPlan } from "./analysis-action-editor";

const action = {
	finding: "原始发现 | 含竖线\n第二行",
	evidence_refs: ["Q01", "Q02"],
	action: "复核 C:\\content | 原始来源",
	priority: "P0",
	priority_rationale: "来源覆盖",
	deliverable: "核对结果",
	verification_method: "人工复核",
	brand_id: "B09",
	snapshot_id: "snap_b09",
	run_id: "run_b09",
};

describe("action editor evidence preservation", () => {
	it("preserves untouched structured actions, bindings, quotes and whitespace", () => {
		const original = { ...action, finding: ` ${action.finding} ` };
		expect(parseActionPlan(formatActionPlan([original]), [original])).toEqual([original]);
	});
	it("preserves an untouched row after reordering without positional association", () => {
		const second = { ...action, action: "第二条", evidence_refs: ["Q03"] };
		expect(parseActionPlan(formatActionPlan([second, action]), [action, second])).toEqual([second, action]);
	});
	it("retains explicit refs and finding when manually editing another field", () => {
		const edited = formatActionPlan([action]).replace("核对结果", "新交付物");
		const saved = parseActionPlan(edited, [action])[0];
		expect(saved.evidence_refs).toEqual(["Q01", "Q02"]);
		expect(saved.finding).toBe(action.finding);
		expect(saved.action).toBe(action.action);
		expect(saved.deliverable).toBe("新交付物");
	});
	it("never substitutes a placeholder action for an empty one", () => {
		const saved = parseActionPlan("Q01 | | P1 | 依据 | 交付物 | 复核 | 发现")[0];
		expect(saved.action).toBe("");
		expect(saved.evidence_refs).toEqual(["Q01"]);
	});
	it("does not copy refs or findings from the old row into a new six-field row", () => {
		const saved = parseActionPlan("Q03 | 新行动 | P1 | 依据 | 交付物 | 复核", [action])[0];
		expect(saved.evidence_refs).toEqual(["Q03"]);
		expect(saved.finding).toBe("");
	});
	it("reports malformed fields instead of silently shifting evidence", () => {
		expect(() => parseActionPlan("Q01 | a | P1 | b | c | d | e | f")).toThrow("第 1 项");
	});

	it("supports B18-UI card-based item additions, edits, and removals", () => {
		// 1. Initial state with 1 action
		let currentItems: (typeof action | { action: string; priority: string; priority_rationale: string; deliverable: string; verification_method: string; finding: string; evidence_refs: string[] })[] = [action];
		let formatted = formatActionPlan(currentItems);

		// 2. Add an action card
		const newItem = {
			action: "新增建议行动",
			priority: "P1",
			priority_rationale: "理由",
			deliverable: "交付物",
			verification_method: "验证",
			finding: "发现",
			evidence_refs: [],
		};
		currentItems = [...currentItems, newItem];
		formatted = formatActionPlan(currentItems);
		let parsed = parseActionPlan(formatted, [action]);
		expect(parsed.length).toBe(2);
		expect(parsed[1].action).toBe("新增建议行动");
		expect(parsed[1].priority).toBe("P1");

		// 3. Edit fields individually
		currentItems = currentItems.map((item, idx) => idx === 1 ? { ...item, action: "修改后的行动 | 含竖线\n换行", priority: "P0" } : item);
		formatted = formatActionPlan(currentItems);
		parsed = parseActionPlan(formatted, [action]);
		expect(parsed[1].action).toBe("修改后的行动 | 含竖线\n换行");
		expect(parsed[1].priority).toBe("P0");

		// 4. Update evidence refs (toggle checkbox)
		currentItems = currentItems.map((item, idx) => idx === 1 ? { ...item, evidence_refs: ["Q01", "Q05"] } : item);
		formatted = formatActionPlan(currentItems);
		parsed = parseActionPlan(formatted, [action]);
		expect(parsed[1].evidence_refs).toEqual(["Q01", "Q05"]);

		// 5. Remove first action
		currentItems = currentItems.filter((_, idx) => idx !== 0);
		formatted = formatActionPlan(currentItems);
		parsed = parseActionPlan(formatted, [action]);
		expect(parsed.length).toBe(1);
		expect(parsed[0].action).toBe("修改后的行动 | 含竖线\n换行");
	});
});
