import { describe, expect, it } from "vitest";
import type { ResearchDraft } from "@/lib/brand-research-client";
import { researchDraftPhase } from "./prompt-wizard";
import { getPromptCategory, setPromptCategory } from "./prompts-list-editor";

function draft(state: ResearchDraft["state"], researchStatus: ResearchDraft["researchStatus"]): ResearchDraft {
	return {
		id: "synthetic-draft",
		brandId: "synthetic-brand",
		website: "https://example.invalid",
		state,
		researchStatus,
		payload: { brandName: "Synthetic", website: "https://example.invalid", aliases: [], additionalDomains: [], competitors: [], suggestedPrompts: [] },
		createdAt: "2026-11-06T00:00:00Z",
		updatedAt: "2026-11-06T00:00:00Z",
	};
}

describe("research history terminal-state precedence", () => {
	it.each(["queued", "running", "done", "failed", null] as const)("never resumes a rolled-back draft with execution status %s", (status) => {
		expect(researchDraftPhase(draft("rolled_back", status))).toBe("cancelled");
	});
	it.each(["queued", "running"] as const)("retains pending-review %s recovery", (status) => {
		expect(researchDraftPhase(draft("pending_review", status))).toBe("active");
	});
	it("retains successful review and failure while not reviving committed drafts", () => {
		expect(researchDraftPhase(draft("pending_review", "done"))).toBe("review");
		expect(researchDraftPhase(draft("pending_review", "failed"))).toBe("failed");
		expect(researchDraftPhase(draft("failed", "queued"))).toBe("failed");
		expect(researchDraftPhase(draft("done", "queued"))).toBe("settled");
	});
	it("keeps unknown execution distinct from completion", () => {
		expect(researchDraftPhase(draft("pending_review", null))).toBe("unknown");
	});
});

describe("category storage compatibility", () => {
	it("replaces a single business category without altering ordinary tags", () => {
		const tags = setPromptCategory(["cat:旧分类", "dim:重复旧分类", "普通标签"], "新 分类");
		expect(tags).toEqual(["普通标签", "dim:新 分类"]);
		expect(getPromptCategory(JSON.parse(JSON.stringify(tags)))).toBe("新 分类");
	});
	it("same-value selection preserves storage and supports keyboard category prefixes", () => {
		expect(setPromptCategory(["dim:分类", "标签"], "分类")).toEqual(["标签", "dim:分类"]);
		expect(setPromptCategory(["标签"], "cat: 手动 分类 ")).toEqual(["标签", "dim:手动 分类"]);
	});
});
