/**
 * Single-step onboarding wizard.
 *
 * One LLM call returns brand info + competitors + prompts; the user reviews
 * and edits before saving. Replaces the prior 4-step wizard that required
 * DataForSEO + Anthropic in tandem.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Separator } from "@workspace/ui/components/separator";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Textarea } from "@workspace/ui/components/textarea";
import { AlertCircle, Loader2, Play, Rocket } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CompetitorEntry, CompetitorsEditor, newCompetitorEntry } from "@/components/competitors-editor";
import {
	type EditableProductLine,
	newEditableProductLine,
	newEditableSku,
	ProductLinesEditor,
	type UnverifiedProductLine,
} from "@/components/product-lines-editor";
import { type EditablePrompt, newPromptEntry, PromptsListEditor } from "@/components/prompts-list-editor";
import { brandKeys, useBrand } from "@/hooks/use-brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { promptsSummaryKeys } from "@/hooks/use-prompts-summary";
import {
	confirmDraft,
	fetchBrandDrafts,
	fetchDraft,
	patchDraft,
	rollbackDraft,
	type ResearchDraft,
	type ResearchDraftPayload,
	type SuggestedPromptsMeta,
	triggerResearch,
} from "@/lib/brand-research-client";
import { useLanguage } from "@/lib/language-context";
import { trackEvent } from "@/lib/posthog";
import { safeUUID } from "@/lib/uuid";

interface PromptWizardProps {
	onComplete: () => void;
}

/** Brand analysis runs in the worker (LLM + web search, ~1 min); the client polls for the result. */
const POLL_INTERVAL_MS = 2000;
const ANALYZE_TIMEOUT_MS = 6 * 60 * 1000; // give up after ~6 minutes

export function researchDraftPhase(draft: ResearchDraft) {
	if (draft.state === "rolled_back") return "cancelled";
	if (draft.state === "done") return "settled";
	if (draft.state === "failed" || draft.researchStatus === "failed") return "failed";
	if (draft.state !== "pending_review") return "unknown";
	if (draft.researchStatus === "queued" || draft.researchStatus === "running") return "active";
	if (draft.researchStatus === "done") return "review";
	return "unknown";
}

interface WizardData {
	brandName: string;
	website: string;
	additionalDomains: string[];
	aliases: string[];
	competitors: CompetitorEntry[];
	prompts: EditablePrompt[];
	suggestedCategories: string[];
	suggestedCategoryChecks?: ResearchDraftPayload["suggestedCategoryChecks"];
	suggestedPromptsMeta?: SuggestedPromptsMeta;
	// Epic A-2 (V1.0): 公司档案（一句话定位 + 简介）+ 产品线/SKU
	summary: string;
	description: string;
	productLines: EditableProductLine[];
	unverifiedLines: UnverifiedProductLine[];
}

interface CategoryOptionSource {
	productLines: Array<{ name: string }>;
	unverifiedLines: Array<{ name: string }>;
	suggestedCategories?: string[];
	prompts?: Array<{ tags: string[] }>;
}

/** Category choices come from real business lines and the model's own prompt
 *  classifications — not only from product lines whose SKUs passed evidence. */
export function collectCategoryOptions(source: CategoryOptionSource): string[] {
	const options = new Set<string>();
	const add = (value: string | undefined) => {
		const trimmed = value?.trim();
		if (trimmed) options.add(trimmed);
	};
	for (const line of source.productLines) add(line.name);
	for (const line of source.unverifiedLines) add(line.name);
	for (const category of source.suggestedCategories ?? []) add(category);
	for (const prompt of source.prompts ?? []) {
		for (const tag of prompt.tags) {
			if (!tag.startsWith("dim:") && !tag.startsWith("cat:")) continue;
			add(tag.replace(/^(?:(?:dim|cat):\s*)+/i, ""));
		}
	}
	return [...options];
}

export function buildPromptNotice(args: {
	language: "zh" | "en";
	promptCount: number;
	meta?: SuggestedPromptsMeta;
}): string | null {
	const { language, promptCount, meta } = args;
	const isZh = language === "zh";
	if (!meta) {
		return promptCount === 0
			? isZh
				? "暂无建议问题，可手动添加。"
				: "No suggested prompts yet — add one manually."
			: null;
	}
	if (meta.fieldStatus === "invalid") return isZh
		? "模型的问题清单字段结构不合法，本轮问题产出失败；其他已产资料保留，不补写默认问题。"
		: "The model returned an invalid prompt-list structure. Question generation failed; other material is retained, without default questions.";
	const brand = meta.filteredForBrandOrSku;
	const proprietary = meta.filteredForProprietary;
	const unconfirmed = meta.unconfirmed;
	const skipped = meta.skippedDuplicateOrEmpty;
	const truncated = meta.truncatedByCap;
	const filteredTotal = brand + proprietary;
	const reasonParts = (zh: boolean): string[] => {
		const parts: string[] = [];
		if ((meta.missingPrompt ?? 0) > 0) parts.push(zh ? `${meta.missingPrompt} 条缺少题文 prompt 字段` : `${meta.missingPrompt} missing prompt fields`);
		if ((meta.emptyPrompt ?? 0) > 0) parts.push(zh ? `${meta.emptyPrompt} 条题文为空` : `${meta.emptyPrompt} empty prompt texts`);
		if ((meta.invalidPrompt ?? 0) > 0) parts.push(zh ? `${meta.invalidPrompt} 条题文类型或结构不合法` : `${meta.invalidPrompt} invalid prompt rows`);
		if ((meta.duplicate ?? 0) > 0) parts.push(zh ? `${meta.duplicate} 条重复` : `${meta.duplicate} duplicates`);
		if (brand > 0)
			parts.push(zh ? `${brand} 条因包含品牌名或别名被防引导规则过滤` : `${brand} were filtered for naming the brand or an alias`);
		if (proprietary > 0)
			parts.push(zh ? `${proprietary} 条因指向专有产品、系列或型号被过滤` : `${proprietary} were filtered for pointing at a proprietary product, series or model`);
		if (unconfirmed > 0)
			parts.push(zh ? `${unconfirmed} 条指向未确认，未自动纳入、待人工确认` : `${unconfirmed} have an unconfirmed target reference and were not auto-included`);
		if (skipped > 0 && meta.emptyPrompt === undefined) parts.push(zh ? `${skipped} 条为空或重复（历史统计未拆分）` : `${skipped} were empty or duplicates (legacy combined count)`);
		if (truncated > 0) parts.push(zh ? `${truncated} 条因数量上限未处理` : `${truncated} were not processed due to the prompt cap`);
		return parts;
	};
	if (promptCount === 0) {
		if (meta.generated === 0) {
			return isZh
				? "模型本次未返回建议问题，可手动添加或稍后重新调研。"
				: "The model returned no suggested prompts. Add one manually or run research again later.";
		}
		if (meta.kept === 0) {
			if (brand > 0 && proprietary === 0 && unconfirmed === 0 && skipped === 0 && truncated === 0) {
				return isZh
					? `模型生成了 ${meta.generated} 条建议，均因包含品牌名、别名或专有型号被现有防引导规则过滤；可手动添加不带品牌名的问题。`
					: `The model returned ${meta.generated} suggestions, but all were filtered because they named the brand, an alias, or a proprietary model. Add an unbranded question manually.`;
			}
			const parts = reasonParts(isZh).join(isZh ? "，" : "; ");
			return isZh
				? `模型生成了 ${meta.generated} 条建议，${parts}，未得到可用问题；可手动添加。`
				: `The model returned ${meta.generated} suggestions: ${parts}; no usable question remained. Add one manually.`;
		}
	}
	if ((meta.missingPrompt ?? 0) + (meta.emptyPrompt ?? 0) + (meta.invalidPrompt ?? 0) + (meta.duplicate ?? 0) > 0) {
		return isZh ? `本轮自动生成部分成功：保留 ${meta.kept} 条有效题文；${reasonParts(true).join("，")}。当前清单 ${promptCount} 条，编辑不触发新调研。`
			: `Research partially succeeded: ${meta.kept} usable prompts retained; ${reasonParts(false).join("; ")}. Current list: ${promptCount}; editing does not run research again.`;
	}
	if (filteredTotal > 0 || unconfirmed > 0) {
		const extra = unconfirmed > 0 ? (isZh ? `，另有 ${unconfirmed} 条指向未确认未自动纳入` : `, and ${unconfirmed} more with an unconfirmed target reference were not auto-included`) : "";
		return isZh
			? `已按防引导规则过滤 ${filteredTotal} 条含品牌名、别名或专有型号的建议${extra}。`
			: `${filteredTotal} suggestions were filtered because they named the brand, an alias, or a proprietary model${extra}.`;
	}
	return null;
}

const EditableTagsInput = memo(
	({
		items,
		onValueChange,
		placeholder = "Add item...",
		maxItems = 10,
	}: {
		items: string[];
		onValueChange: (value: string[]) => void;
		placeholder?: string;
		maxItems?: number;
	}) => {
		const { t } = useLanguage();
		return (
			<div className="space-y-2" data-no-i18n>
				<TagsInput
					value={items}
					onValueChange={onValueChange}
					placeholder={placeholder}
					searchPlaceholder={placeholder}
					maxItems={maxItems}
				/>
				<p className="text-xs text-muted-foreground">
					<strong>
						{items.length}/{maxItems}
					</strong>{" "}
					{items.length >= maxItems ? t.itemsAddedMax : t.itemsEntered}
				</p>
			</div>
		);
	},
);
EditableTagsInput.displayName = "EditableTagsInput";

export default function PromptWizard({ onComplete }: PromptWizardProps) {
	const { language, t } = useLanguage();
	const { brand } = useBrand();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [phase, setPhase] = useState<"idle" | "analyzing" | "review">("idle");
	const [error, setError] = useState<string | null>(null);
	const [historyReady, setHistoryReady] = useState(false);
	const [isCancelling, setIsCancelling] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [data, setData] = useState<WizardData>({
		brandName: "",
		website: "",
		additionalDomains: [],
		aliases: [],
		competitors: [],
		prompts: [],
		suggestedCategories: [],
		summary: "",
		description: "",
		productLines: [],
		unverifiedLines: [],
	});

	const brandId = brand?.id;

	// ---- M2xM3: research draft flow (draft_research 持久化 + confirm 灌库) ----
	const [draftId, setDraftId] = useState<string | null>(null);
	// 完整 payload 快照 —— PATCH 时与用户编辑 merge（unverified 行保留原 evidence，仅被忽略的行移除）
	const payloadRef = useRef<ResearchDraftPayload | null>(null);
	const generationRef = useRef(0);
	const cancellingRef = useRef(false);
	const cancelledDraftsRef = useRef(new Set<string>());
	const cancelledMessage = language === "zh"
		? "本轮调研已取消，可明确点击重新调研；不会继续发起后续请求，已发出的请求无法追回。"
		: "Research cancelled. You can explicitly start again; no further requests will be started. Already issued requests cannot be recalled.";

	const restoreHistory = useCallback((drafts: ResearchDraft[]) => {
		const ownDrafts = drafts.filter((draft) => draft.brandId === brandId);
		const active = ownDrafts.find((draft) =>
			!cancelledDraftsRef.current.has(draft.id) &&
			["active", "review", "unknown"].includes(researchDraftPhase(draft)));
		const latest = active ?? ownDrafts.find((draft) =>
			cancelledDraftsRef.current.has(draft.id) ||
			["cancelled", "failed"].includes(researchDraftPhase(draft)));
		setHistoryReady(!active || researchDraftPhase(active) !== "unknown");
		setPhase("idle");
		setDraftId(latest?.id ?? null);
		payloadRef.current = latest?.payload ?? null;
		setError(null);
		if (!latest) return;
		const status = cancelledDraftsRef.current.has(latest.id) ? "cancelled" : researchDraftPhase(latest);
		if (status === "active") setPhase("analyzing");
		else if (status === "review") {
			setData(suggestionToWizardData(latest.payload, brand?.name || "", brand?.website || "", { isDraftRestore: true }));
			setPhase("review");
		} else if (status === "cancelled") {
			payloadRef.current = null;
			setError(cancelledMessage);
		} else if (status === "failed") {
			setError(latest.error || (language === "zh" ? "品牌调研失败" : "Research failed"));
		} else {
			setError(language === "zh" ? "历史任务执行状态未知，未发起新调研。" : "Historical execution status is unknown; no new research was started.");
		}
	}, [brandId, brand?.name, brand?.website, cancelledMessage, language]);
	const restoreHistoryRef = useRef(restoreHistory);
	restoreHistoryRef.current = restoreHistory;

	const stopAnalyzing = useCallback((errorMessage: string | null) => {
		setPhase("idle");
		setError(errorMessage);
		setHistoryReady(false);
		payloadRef.current = null;
	}, []);

	// Mount: 恢复活动草稿（刷新/离开后重进续接管道；done+pending_review 直接进 review）
	useEffect(() => {
		if (!brandId) return;
		const generation = ++generationRef.current;
		cancellingRef.current = false;
		setIsCancelling(false);
		setPhase("idle");
		setDraftId(null);
		setError(null);
		payloadRef.current = null;
		setHistoryReady(false);
		let cancelled = false;
		(async () => {
			try {
				const { drafts } = await fetchBrandDrafts(brandId, true);
				if (cancelled || generation !== generationRef.current) return;
				restoreHistoryRef.current(drafts);
			} catch (error) {
				if (!cancelled) setError(language === "zh"
					? `无法核对历史任务状态，请刷新后再操作：${error instanceof Error ? error.message : String(error)}`
					: `Cannot check historical task status. Refresh before starting research: ${error instanceof Error ? error.message : String(error)}`);
			}
		})();
		return () => {
			cancelled = true;
			generationRef.current++;
		};
	}, [brandId, brand?.name, brand?.website]);

	const updateBrandName = useCallback((brandName: string) => setData((p) => ({ ...p, brandName })), []);
	const updateWebsite = useCallback((website: string) => setData((p) => ({ ...p, website })), []);
	const updateAliases = useCallback((aliases: string[]) => setData((p) => ({ ...p, aliases })), []);
	const updateAdditionalDomains = useCallback(
		(additionalDomains: string[]) => setData((p) => ({ ...p, additionalDomains })),
		[],
	);
	const updateCompetitors = useCallback(
		(competitors: CompetitorEntry[]) => setData((p) => ({ ...p, competitors })),
		[],
	);
	const updatePrompts = useCallback((prompts: EditablePrompt[]) => setData((p) => ({ ...p, prompts })), []);
	const updateSummary = useCallback((summary: string) => setData((p) => ({ ...p, summary })), []);
	const updateDescription = useCallback((description: string) => setData((p) => ({ ...p, description })), []);
	const updateProductLines = useCallback(
		(productLines: EditableProductLine[]) => setData((p) => ({ ...p, productLines })),
		[],
	);
	const ignoreUnverified = useCallback((key: string) => {
		setData((p) => {
			const line = p.unverifiedLines.find((u) => u._key === key);
			// 同步从 payload 快照移除（PATCH 时 unverified 不再含该行；其余原始行原样保留）
			const cur = payloadRef.current;
			const pl = cur?.productLines;
			if (line && cur && pl) {
				payloadRef.current = {
					...cur,
					productLines: {
						...pl,
						unverified: pl.unverified.filter((u) => u.line.name !== line.name),
					},
				};
			}
			return { ...p, unverifiedLines: p.unverifiedLines.filter((u) => u._key !== key) };
		});
	}, []);

	const handleAnalyze = useCallback(async () => {
		if (!historyReady) {
			setError(language === "zh" ? "历史任务状态尚未核对，未发起新调研。请刷新恢复。" : "Historical task status is unknown; no new research was started. Refresh first.");
			return;
		}
		if (!brand?.website || !brand?.id) return;
		const generation = ++generationRef.current;
		const isRetry = Boolean(error);
		const oldDraftId = draftId;
		setError(null);
		setPhase("analyzing");
		payloadRef.current = null;
		if (oldDraftId) {
			queryClient.removeQueries({ queryKey: ["research-draft", oldDraftId] });
			setDraftId(null);
		}
		try {
			const res = await triggerResearch(brand.id, brand.website, isRetry, oldDraftId || undefined, language);
			if (generation !== generationRef.current) return;
			setDraftId(res.draftId);
			await queryClient.refetchQueries({ queryKey: ["research-draft", res.draftId] });
		} catch (err) {
			if (generation !== generationRef.current) return;
			setError(err instanceof Error ? err.message : (language === "zh" ? "调研请求失败" : "Research request failed"));
			setPhase("idle");
			setHistoryReady(false);
		}
	}, [brand?.website, brand?.id, error, draftId, language, queryClient, historyReady]);

	const handleCancelResearch = useCallback(async () => {
		if (!draftId || !brandId || cancellingRef.current) return;
		const generation = ++generationRef.current;
		cancellingRef.current = true;
		setIsCancelling(true);
		setHistoryReady(false);
		let cancellationError: string | null = null;
		try {
			await queryClient.cancelQueries({ queryKey: ["research-draft", draftId] });
			const result = await rollbackDraft(draftId);
			if (generation !== generationRef.current) return;
			if (result.rolledBack === true) cancelledDraftsRef.current.add(draftId);
			else cancellationError = language === "zh" ? "取消结果未确认。" : "Cancellation was not confirmed.";
		} catch (error) {
			cancellationError = error instanceof Error ? error.message : String(error);
		}
		if (generation !== generationRef.current) return;
		try {
			const { drafts } = await fetchBrandDrafts(brandId, true);
			if (generation !== generationRef.current) return;
			const target = drafts.find((draft) => draft.id === draftId && draft.brandId === brandId);
			if (target && researchDraftPhase(target) === "cancelled") cancelledDraftsRef.current.add(draftId);
			queryClient.removeQueries({ queryKey: ["research-draft", draftId] });
			restoreHistoryRef.current(drafts);
			if (!target && cancelledDraftsRef.current.has(draftId) &&
				!drafts.some((draft) => draft.brandId === brandId &&
					["active", "review", "unknown"].includes(researchDraftPhase(draft)))) {
				setDraftId(draftId);
				setError(cancelledMessage);
			}
			if (!cancelledDraftsRef.current.has(draftId)) {
				setError(cancellationError || (language === "zh" ? "未能确认取消，请核对当前任务状态。" : "Cancellation could not be confirmed. Check the current task status."));
				if (!target) setHistoryReady(false);
			}
		} catch (error) {
			if (generation !== generationRef.current) return;
			setPhase("idle");
			payloadRef.current = null;
			setError(`${cancelledDraftsRef.current.has(draftId) ? cancelledMessage : cancellationError || ""} ${
				language === "zh" ? "无法核对其它活动任务，未允许新调研。请刷新核对：" : "Other active tasks could not be checked; new research is disabled. Refresh to verify:"
			} ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			if (generation === generationRef.current) {
				cancellingRef.current = false;
				setIsCancelling(false);
			}
		}
	}, [draftId, brandId, language, queryClient, cancelledMessage]);

	// 轮询 draft.researchStatus（queued/running 持续，done/failed 停）
	const draftQuery = useQuery({
		queryKey: ["research-draft", draftId ?? "none"],
		queryFn: () => {
			if (!draftId) throw new Error("No research draft in flight");
			return fetchDraft(draftId);
		},
		enabled: phase === "analyzing" && !!draftId && !isCancelling,
		staleTime: 0,
		gcTime: 0,
		refetchInterval: (query) => {
			const draft = query.state.data;
			return draft && researchDraftPhase(draft) === "active" ? POLL_INTERVAL_MS : false;
		},
		refetchIntervalInBackground: true,
	});

	// 轮询结果驱动 phase 转移
	const draftData = draftQuery.data;
	useEffect(() => {
		if (phase !== "analyzing" || !draftData || cancellingRef.current ||
			draftData.id !== draftId || draftData.brandId !== brandId ||
			cancelledDraftsRef.current.has(draftData.id)) return;
		const status = researchDraftPhase(draftData);
		if (status === "cancelled") {
			cancelledDraftsRef.current.add(draftData.id);
			stopAnalyzing(cancelledMessage);
			const generation = generationRef.current;
			fetchBrandDrafts(draftData.brandId, true).then(({ drafts }) => {
				if (generation === generationRef.current) restoreHistoryRef.current(drafts);
			}).catch((error: unknown) => {
				if (generation === generationRef.current) setError(`${cancelledMessage} ${error instanceof Error ? error.message : String(error)}`);
			});
			return;
		}
		if (status === "unknown" || status === "settled") {
			stopAnalyzing(language === "zh" ? "任务不再处于可恢复执行状态，请刷新核对历史。" : "Task is not in a resumable execution state. Refresh to check history.");
			return;
		}
		if (status === "failed") {
			setError(draftData.error || t.researchFailed);
			setPhase("idle");
			return;
		}
		if (status === "review") {
			payloadRef.current = draftData.payload;
			setData(suggestionToWizardData(draftData.payload, brand?.name || "", brand?.website || ""));
			setPhase("review");
			trackEvent("onboarding_analyzed", {
				competitor_count: draftData.payload.competitors?.length || 0,
				prompt_count: draftData.payload.suggestedPrompts?.length || 0,
				product_line_count: draftData.payload.productLines?.confirmed?.length || 0,
			});
		}
	}, [phase, draftData, draftId, brandId, brand?.name, brand?.website, t.researchFailed, stopAnalyzing, cancelledMessage, language]);

	// Give up on a stuck research instead of polling forever.
	useEffect(() => {
		if (phase !== "analyzing") return;
		const timer = window.setTimeout(
			() => stopAnalyzing(t.researchTimedOut),
			ANALYZE_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [phase, stopAnalyzing, t.researchTimedOut]);

	const categoryOptions = useMemo(
		() =>
			collectCategoryOptions({
				productLines: data.productLines,
				unverifiedLines: data.unverifiedLines,
				suggestedCategories: data.suggestedCategories,
				prompts: data.prompts,
			}),
		[data.productLines, data.unverifiedLines, data.suggestedCategories, data.prompts],
	);

	const promptNotice = useMemo(
		() =>
			buildPromptNotice({
				language,
				promptCount: data.prompts.filter((prompt) => prompt.value.trim().length > 0).length,
				meta: data.suggestedPromptsMeta,
			}),
		[language, data.prompts, data.suggestedPromptsMeta],
	);

	const categoryHint =
		language === "zh"
			? categoryOptions.length === 0
				? "暂无建议分类，可手动输入。"
				: "可从建议分类中选择，也可直接输入。"
			: categoryOptions.length === 0
				? "No suggested categories — type one manually."
				: "Choose a suggested category or type your own.";

	const previewCounts = useMemo(() => {
		const enabled = data.prompts.filter((p) => p.enabled && p.value.trim().length > 0).length;
		return { totalNew: enabled };
	}, [data.prompts]);

	const handleSubmit = useCallback(async () => {
		if (!brand?.id || !draftId) return;
		setSubmitError(null);
		setIsSaving(true);
		try {
			const competitorsPayload = data.competitors
				.filter((c) => c.name.trim() && c.domains.some((d) => d.trim()))
				.map((c) => ({
					name: c.name.trim(),
					domains: c.domains.filter((d) => d.trim()),
					aliases: c.aliases,
				}));

			const promptsPayload = data.prompts
				.filter((p) => p.enabled && p.value.trim())
				.map((p) => ({ prompt: p.value.trim(), tags: p.tags }));

			// 只提交完整可用的 SKU（name + evidenceUrl 必填），unverified 永不提交
			const confirmedLines = data.productLines
				.map((line) => ({
					line: {
						name: line.name.trim(),
						category: line.category,
						researchEvidence: line.researchEvidence,
						skus: line.skus
							.filter((s) => s.name.trim() && s.evidenceUrl.trim())
							.map((s) => ({
								name: s.name.trim(),
								model: s.model?.trim() || undefined,
								oneLiner: s.oneLiner.trim(),
								evidenceUrl: s.evidenceUrl.trim(),
								evidenceQuote: s.evidenceQuote,
							})),
					},
				}))
				.filter((entry) => entry.line.name);

			const base = payloadRef.current;
			// PATCH 回写用户编辑（payload 单一真源）——契约 = confirmed 数组 {line, evidence}；unverified 由后端保留（不灌库，仅展示）
			await patchDraft(draftId, {
				brandName: data.brandName.trim() || brand.name,
				website: data.website.trim() || brand.website,
				aliases: data.aliases,
				additionalDomains: data.additionalDomains,
				competitors: competitorsPayload,
				prompts: promptsPayload,
				summary: data.summary.trim() || undefined,
				description: data.description.trim() || undefined,
				productLines: base?.productLines
					? confirmedLines.map((entry) => ({ line: entry.line, evidence: 0 }))
					: undefined,
			});
			// confirm 灌库（事务：brand → product lines → competitors → prompts）
			await confirmDraft(draftId);

			trackEvent("wizard_completed", {
				prompts_created: promptsPayload.length,
				competitors_created: competitorsPayload.length,
				skipped: false,
			});

			// Deployments without an onboardingRedirectUrlTemplate (e.g. local mode) skip the full reload, so caches fetched while !onboarded must be busted explicitly.
			queryClient.invalidateQueries({ queryKey: brandKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: promptsSummaryKeys.all });
			// The $brand route loader feeds `brand` into AppSidebar; invalidate it so the sidebar picks up onboarded=true.
			await router.invalidate();

			onComplete();
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : (language === "zh" ? "保存失败" : "Failed to save"));
		} finally {
			setIsSaving(false);
		}
	}, [brand, data, draftId, queryClient, router, onComplete]);

	if (phase === "idle" || phase === "analyzing") {
		const failedSources = (draftData?.payload ?? payloadRef.current)?.researchDiagnostics?.sources;
		return (
			<div className="max-w-2xl mx-auto space-y-3" data-no-i18n>
				<p className="text-sm text-muted-foreground">
					{language === "zh" ? (
						<>
							程序对 <strong>{brand?.website}</strong> 有限取材（最多 6 页、每页最多 3 次请求），由 Negency-Agent 分析已提供材料，生成类别、竞品与无品牌引导问题。模型不会自行联网全站搜索，也不会自动重试。
						</>
					) : (
						<>
							The program fetches limited material from <strong>{brand?.website}</strong> (up to 6 pages, 3 requests per page). Negency-Agent analyzes those sources for categories, competitors and unbranded questions, without built-in full-site search or automatic model retries.
						</>
					)}
				</p>
				{(error || draftQuery.error) && (
					<div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
						<AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
						<span>{error || `${language === "zh" ? "无法核对执行状态，不会自动重发：" : "Cannot check execution status; no automatic resubmission:"} ${draftQuery.error?.message}`}</span>
					</div>
				)}
				{failedSources?.status === "failed" && <p className="text-sm text-amber-700">
					{language === "zh" ? `取材阶段未取得可用正文，实际抓取 HTTP 请求 ${failedSources.requestCount} 次。` : `No usable source text; ${failedSources.requestCount} fetch HTTP requests.`}
					{failedSources.pages.some((page) => page.attempts.some((attempt) => attempt.outcome === "blocked"))
						? language === "zh" ? " 地址/域名安全校验阻断，不等于官网停机；模型阶段未开始。" : " Address/domain safety checks blocked access; this does not establish site downtime. Model stage did not start."
						: language === "zh" ? " 已保留失败来源，本轮未继续调用模型。" : " Failed sources retained; no model call followed."}
				</p>}
				<div className="flex items-center gap-2">
					<Button
						onClick={handleAnalyze}
						disabled={phase === "analyzing" || !historyReady}
						className="flex items-center gap-2 cursor-pointer"
					>
						{phase === "analyzing" ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								{draftData?.researchStatus === "queued"
									? t.queuedForResearch
									: draftData?.researchStatus === "running"
										? t.analyzingBrandWebsite
										: t.analyzingBrand}
							</>
						) : (
							<>
								<Play className="h-4 w-4" />
								{error ? t.retryResearch : t.analyzeBrandBtn}
							</>
						)}
					</Button>
					{phase === "analyzing" && (
						<Button variant="outline" onClick={handleCancelResearch} disabled={!draftId || isCancelling} className="cursor-pointer">
							{t.cancelBtn}
						</Button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-2xl mx-auto space-y-6" data-no-i18n>
			{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
			<div className="space-y-2">
				<h2 className="text-2xl font-bold">{t.brandDetailsTitle}</h2>
				<p className="text-muted-foreground">
					{t.brandDetailsSubtitle}
				</p>
				<div className="space-y-3">
					<div>
						<p className="text-xs text-muted-foreground">{t.brandNameLabel}</p>
						<Input value={data.brandName} onChange={(e) => updateBrandName(e.target.value)} placeholder={t.brandNamePlaceholder} />
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t.oneLinePositioningLabel}</p>
						<Input
							value={data.summary}
							onChange={(e) => updateSummary(e.target.value)}
							placeholder={t.oneLinePositioningPlaceholder}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t.descriptionLabel}</p>
						<Textarea
							value={data.description}
							onChange={(e) => updateDescription(e.target.value)}
							placeholder={t.descriptionPlaceholder}
							rows={3}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t.websiteUrlLabel}</p>
						<Input
							type="url"
							value={data.website}
							onChange={(e) => updateWebsite(e.target.value)}
							placeholder={t.websiteUrlPlaceholder}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t.additionalDomainsLabel}</p>
						<EditableTagsInput
							items={data.additionalDomains}
							onValueChange={updateAdditionalDomains}
							placeholder={t.additionalDomainsPlaceholder}
							maxItems={10}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">{t.aliasesLabel}</p>
						<EditableTagsInput
							items={data.aliases}
							onValueChange={updateAliases}
							placeholder={t.aliasesPlaceholder}
							maxItems={10}
						/>
					</div>
				</div>
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<h2 className="text-2xl font-bold">{t.productLinesTitle}</h2>
					<p className="text-muted-foreground">
						{t.productLinesSubtitle}
					</p>
				</div>
				<ProductLinesEditor
					lines={data.productLines}
					onChange={updateProductLines}
					unverified={data.unverifiedLines}
					onIgnoreUnverified={ignoreUnverified}
					disabled={isSaving}
				/>
				{payloadRef.current?.researchDiagnostics?.sources && (
				<div className="space-y-1 text-xs text-muted-foreground">
					<p>{payloadRef.current.researchDiagnostics.mode === "synthetic"
						? language === "zh" ? "合成测试来源素材（未抓取真实官网）" : "Synthetic source fixture, not a real website fetch"
						: language === "zh" ? "本轮有限官网取材（非全站扫描）" : "Limited official-site material, not a full-site scan"}：
						{payloadRef.current.researchDiagnostics.sources.pages.filter((page) => page.status === "success").length}
						/{payloadRef.current.researchDiagnostics.sources.pages.length} {language === "zh" ? "页成功" : "pages succeeded"}，
						{payloadRef.current.researchDiagnostics.sources.requestCount} {language === "zh" ? "次抓取请求" : "fetch requests"}
					</p>
					{payloadRef.current.researchDiagnostics.sources.pages.map((page) => <p key={page.url} className="break-all">{page.status === "success" ? "✓" : "!"} {page.finalUrl} · {page.attempts.length} {language === "zh" ? "次尝试" : "attempts"}</p>)}
				</div>
				)}
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<h2 className="text-2xl font-bold">{t.competitorsSectionTitle}</h2>
					<p className="text-muted-foreground">{t.competitorsSectionSubtitle}</p>
				</div>
				<CompetitorsEditor competitors={data.competitors} onChange={updateCompetitors} disabled={isSaving} />
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<h2 className="text-2xl font-bold">{t.promptsSectionTitle}</h2>
					<p className="text-muted-foreground">
						{t.promptsSectionSubtitle}
					</p>
				</div>
				<PromptsListEditor
					prompts={data.prompts}
					onChange={updatePrompts}
					showSystemTags={false}
					categoryOptions={categoryOptions}
					notice={promptNotice ?? undefined}
					categoryHint={categoryHint ?? undefined}
				/>
				{data.suggestedCategoryChecks?.some((check) => check.status === "unconfirmed") && <p className="text-xs text-muted-foreground">
					{language === "zh" ? "以下建议分类尚无已核对类别来源，不影响有效题文保留：" : "Categories without checked sources do not remove valid question text: "}
					{data.suggestedCategoryChecks.filter((check) => check.status === "unconfirmed").map((check) => check.category).join(" · ")}
				</p>}
				{payloadRef.current?.researchDiagnostics?.prompts.status === "failed" && <p className="text-sm text-amber-700">{payloadRef.current.researchDiagnostics.prompts.message}</p>}
			</div>

			{submitError && (
				<div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					<AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
					<div className="text-sm">{submitError}</div>
				</div>
			)}

			<Button
				onClick={handleSubmit}
				disabled={isSaving}
				className="flex items-center gap-2 cursor-pointer"
			>
				{isSaving ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> {t.savingBtn}
					</>
				) : (
					<>
						<Rocket className="h-4 w-4" /> {language === "zh" ? previewCounts.totalNew === 0
							? "仅保存建档资料（未选可用采样问题）" : `保存建档（${previewCounts.totalNew} 条选定问题）`
							: previewCounts.totalNew === 0 ? "Save profile only (no selected questions)" : `Save profile (${previewCounts.totalNew} selected questions)`}
					</>
				)}
			</Button>
		</div>
	);
}

/** suggestion/payload → WizardData（review 编辑区初始值）。模块级纯函数便于测试。 */
export function suggestionToWizardData(
	suggestion: ResearchDraftPayload,
	brandNameFallback: string,
	websiteFallback: string,
	options?: { isDraftRestore?: boolean },
): WizardData {
	const productLines = suggestion.productLines?.confirmed ?? [];
	const brandName = options?.isDraftRestore
		? (suggestion.brandName || brandNameFallback || "")
		: (brandNameFallback || suggestion.brandName || "");
	return {
		brandName,
		website: websiteFallback || suggestion.website || "",
		additionalDomains: suggestion.additionalDomains || [],
		aliases: suggestion.aliases || [],
		competitors: (suggestion.competitors || []).map((c) =>
			newCompetitorEntry({
				name: c.name,
				domains: c.domains || [],
				aliases: c.aliases || [],
				expanded: false,
			}),
		),
		prompts: (suggestion.suggestedPrompts || []).map((p) =>
			newPromptEntry({ value: p.prompt, tags: p.tags || [], enabled: true }),
		),
		suggestedCategories: suggestion.suggestedCategories ?? [],
		suggestedCategoryChecks: suggestion.suggestedCategoryChecks,
		suggestedPromptsMeta: suggestion.suggestedPromptsMeta,
		summary: suggestion.summary ?? "",
		description: suggestion.description ?? "",
		productLines: productLines.map((entry) =>
			newEditableProductLine({
				name: entry.line.name,
				category: entry.line.category,
				researchEvidence: entry.line.researchEvidence,
				skus: entry.line.skus.map((s) =>
					newEditableSku({
						name: s.name,
						model: s.model ?? "",
						oneLiner: s.oneLiner,
						evidenceUrl: s.evidenceUrl,
						evidenceQuote: s.evidenceQuote,
					}),
				),
			}),
		),
		unverifiedLines: (suggestion.productLines?.unverified ?? []).map((entry) => ({
			_key: safeUUID(),
			name: entry.line.name,
			skuNames: entry.line.skus.map((s) => s.name),
			reason: entry.reason,
			researchEvidence: entry.line.researchEvidence,
		})),
	};
}
