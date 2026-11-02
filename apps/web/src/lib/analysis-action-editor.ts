export type AnalysisAction = {
	finding?: string;
	evidence_refs?: string[];
	action?: string;
	priority?: string;
	priority_rationale?: string;
	deliverable?: string;
	verification_method?: string;
	brand_id?: string;
	snapshot_id?: string;
	run_id?: string;
};

function escapeField(value: string | undefined): string {
	return (value ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
}

function formatAction(item: AnalysisAction): string {
	return [
		Array.isArray(item.evidence_refs) ? item.evidence_refs.join(", ") : "",
		item.action,
		item.priority,
		item.priority_rationale,
		item.deliverable,
		item.verification_method,
		item.finding,
	]
		.map(escapeField)
		.join(" | ");
}

export function formatActionPlan(items: AnalysisAction[]): string {
	return items.map(formatAction).join("\n");
}

function splitFields(line: string): string[] {
	const fields: string[] = [];
	let field = "";
	let escaped = false;
	for (const char of line) {
		if (escaped) {
			field += char === "n" ? "\n" : char === "r" ? "\r" : char;
			escaped = false;
		} else if (char === "\\") {
			escaped = true;
		} else if (char === "|") {
			fields.push(field.trim());
			field = "";
		} else {
			field += char;
		}
	}
	if (escaped) throw new Error("行动建议末尾的反斜线未转义，请使用 \\\\。");
	fields.push(field.trim());
	return fields;
}

export function parseActionPlan(text: string, originals: AnalysisAction[] = []) {
	return text
		.split("\n")
		.filter((line) => line.trim())
		.map((line, index) => {
			const original = originals.find((item) => formatAction(item) === line);
			const parts = splitFields(line);
			const matches = parts.length === 7 ? originals.filter((item) => {
				const old = splitFields(formatAction(item));
				return old.filter((value, i) => value === parts[i]).length >= 6;
			}) : [];
			const origin = original ?? (matches.length === 1 ? matches[0] : undefined);
			if (parts.length > 7) throw new Error(`行动建议第 ${index + 1} 项字段过多；正文竖线请写成 \\|。`);
			const rawPriority = (original?.priority ?? parts[2] ?? "").toUpperCase();
			if (!["P0", "P1", "P2", "P3"].includes(rawPriority)) {
				throw new Error(`行动建议第 ${index + 1} 项优先级无效，请填写 P0/P1/P2/P3。`);
			}
			const priority = rawPriority as "P0" | "P1" | "P2" | "P3";
			return {
				...origin,
				evidence_refs:
					original?.evidence_refs ??
					(parts[0] ?? "")
						.split(/[,，]/)
						.map((s) => s.trim())
						.filter(Boolean),
				action: original?.action ?? parts[1] ?? "",
				priority,
				priority_rationale: original?.priority_rationale ?? parts[3] ?? "",
				deliverable: original?.deliverable ?? parts[4] ?? "",
				verification_method: original?.verification_method ?? parts[5] ?? "",
				finding: original?.finding ?? parts[6] ?? "",
			};
		});
}

export function inspectActionPlan(text: string, originals: AnalysisAction[] = []) {
	try {
		return { items: parseActionPlan(text, originals), error: null };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return { items: [], error: error.message };
	}
}
