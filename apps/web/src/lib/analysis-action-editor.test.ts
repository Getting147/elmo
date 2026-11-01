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
});
