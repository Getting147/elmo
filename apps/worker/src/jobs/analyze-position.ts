/**
 * analyzePosition：5 种 provider 输出结构 → answerRank + answerType。
 *
 * 覆盖：
 * - Claude:  { content: [{text:"..."}] } 或 { content: "..." }
 * - OpenAI Chat Completions: { choices: [{message:{content:"..."}}] }
 * - Gemini:  { candidates: [{content:{parts:[{text:"..."}]}}] }
 * - OpenAI Responses API: { output: [{content:[{text:"..."}]}] }
 * - 裸文本: { text: "..." }
 *
 * 通过递归提取嵌套对象中的所有文本叶子。两种叶子形式都接受：
 * (a) 字面键名 "text"（Claude/Gemini/Responses API/Bare/通用）
 * (b) 字面键名 "content" 且值为 string（OpenAI Chat Completions 简化形式）
 * 排除：metadata 字符串如 {type:"text"}、{role:"assistant"}（通过父键过滤）。
 */
const TEXT_KEYS = new Set(['text', 'content']);

export function extractAllTexts(node: unknown, out: string[], viaLeafKey: boolean): void {
	if (viaLeafKey && typeof node === 'string') {
		if (node.length > 0) out.push(node);
		return;
	}
	if (node == null || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const item of node) extractAllTexts(item, out, false);
		return;
	}
	const obj = node as Record<string, unknown>;
	for (const key of Object.keys(obj)) {
		extractAllTexts(obj[key], out, TEXT_KEYS.has(key));
	}
}

export type AnswerType = 'list' | 'comparison' | 'recommendation';

export function analyzePosition(
	rawOutput: unknown,
	brandName: string,
	brandAliases: string[],
): { answerRank: number | null; answerType: AnswerType | null } {
	if (!rawOutput || typeof rawOutput !== 'object' || rawOutput === null)
		return { answerRank: null, answerType: null };
	const texts: string[] = [];
	try {
		extractAllTexts(rawOutput, texts, false);
	} catch {
		/* ignore malformed output */
	}
	if (texts.length === 0) return { answerRank: null, answerType: null };
	const joined = texts.join('\n\n');
	const aliases = [brandName, ...brandAliases].map((a) => a.toLowerCase());
	let answerType: AnswerType | null = null;
	if (/(^\s*\d+[.)、\]])|<ol[\s>]/im.test(joined)) answerType = 'list';
	else if (
		/\bvs\.?\b|\bcompared to\b|相比|对比| versus /i.test(joined) ||
		/<table[\s>]/i.test(joined)
	)
		answerType = 'comparison';
	else if (/\brecommend\b|\bi recommend\b|\btop \d+\b|建议|推荐/i.test(joined))
		answerType = 'recommendation';
	if (!answerType) return { answerRank: null, answerType: null };
	// Split by numbered list prefixes while keeping the digit prefix with the next segment
	// (e.g. "intro\n1. A\n2. B" → ["intro", "1. A", "2. B"]).
	// Fallback to single segment when no numbered list found (comparison/recommendation).
	const listItemPattern = /\d+[.)、\]]/g;
	const positions: number[] = [];
	let m: RegExpExecArray | null;
	while ((m = listItemPattern.exec(joined)) !== null) positions.push(m.index);
	const segments: string[] =
		positions.length > 0
			? positions.map((p, i) =>
					i + 1 < positions.length ? joined.slice(p, positions[i + 1]) : joined.slice(p),
				)
			: [joined];
	let answerRank: number | null = null;
	for (let i = 0; i < segments.length; i++) {
		if (aliases.some((a) => segments[i].toLowerCase().includes(a))) {
			answerRank = i + 1;
			break;
		}
	}
	return { answerRank, answerType };
}
