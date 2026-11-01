import { resolveQuestionExecutionStatus } from "./baseline-status";

type QuestionObservation = {
	question_code: string;
	dimension_name?: string;
	is_probe?: boolean;
	effective_status?: string;
	attempts_count?: number;
	error_message?: string | null;
	search_queries?: string[];
};

export function effectiveQueryQuestions<T extends QuestionObservation>(
	questions: T[],
	zeroEffectiveCodes?: string[],
	tags: string[] = [],
): T[] {
	return questions.filter(
		(q) =>
			!q.is_probe &&
			(tags.length === 0 || (q.dimension_name !== undefined && tags.includes(q.dimension_name))) &&
			resolveQuestionExecutionStatus({ ...q, code: q.question_code }, zeroEffectiveCodes) === "effective",
	);
}
