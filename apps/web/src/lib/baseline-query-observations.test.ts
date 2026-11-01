import { expect, it } from "vitest";
import { effectiveQueryQuestions } from "./baseline-query-observations";

it("only counts current effective formal samples before collecting queries", () => {
	const questions = [
		{ question_code: "Q01", dimension_name: "冰箱", effective_status: "effective", search_queries: ["a;b"] },
		{ question_code: "Q02", dimension_name: "空调", effective_status: "effective", search_queries: ["c", "d", "e"] },
		{ question_code: "Q03", effective_status: "ineffective", search_queries: ["failed query"] },
		{ question_code: "Q04", attempts_count: 0 },
		{ question_code: "PR01", is_probe: true, effective_status: "effective", search_queries: ["probe"] },
	];
	const selected = effectiveQueryQuestions(questions, ["Q03", "Q04"]);
	expect(selected.map((q) => q.question_code)).toEqual(["Q01", "Q02"]);
	expect(selected.flatMap((q) => q.search_queries ?? [])).toEqual(["a;b", "c", "d", "e"]);
	expect(effectiveQueryQuestions(questions, ["Q03", "Q04"], ["空调"]).map((q) => q.question_code)).toEqual(["Q02"]);
});
