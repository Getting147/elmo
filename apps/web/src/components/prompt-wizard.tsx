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
	type ResearchDraftPayload,
	triggerResearch,
} from "@/lib/brand-research-client";
import { trackEvent } from "@/lib/posthog";
import { safeUUID } from "@/lib/uuid";

interface PromptWizardProps {
	onComplete: () => void;
}

/** Brand analysis runs in the worker (LLM + web search, ~1 min); the client polls for the result. */
const POLL_INTERVAL_MS = 2000;
const ANALYZE_TIMEOUT_MS = 6 * 60 * 1000; // give up after ~6 minutes

interface WizardData {
	brandName: string;
	website: string;
	additionalDomains: string[];
	aliases: string[];
	competitors: CompetitorEntry[];
	prompts: EditablePrompt[];
	// Epic A-2 (V1.0): 公司档案（一句话定位 + 简介）+ 产品线/SKU
	summary: string;
	description: string;
	productLines: EditableProductLine[];
	unverifiedLines: UnverifiedProductLine[];
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
	}) => (
		<div className="space-y-2">
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
				{items.length >= maxItems ? "items added. Remove an item to add a new one." : "items entered."}
			</p>
		</div>
	),
);
EditableTagsInput.displayName = "EditableTagsInput";

export default function PromptWizard({ onComplete }: PromptWizardProps) {
	const { brand } = useBrand();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [phase, setPhase] = useState<"idle" | "analyzing" | "review">("idle");
	const [error, setError] = useState<string | null>(null);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const [data, setData] = useState<WizardData>({
		brandName: "",
		website: "",
		additionalDomains: [],
		aliases: [],
		competitors: [],
		prompts: [],
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

	const stopAnalyzing = useCallback((errorMessage: string | null) => {
		setPhase("idle");
		setError(errorMessage);
		setDraftId(null);
		payloadRef.current = null;
	}, []);

	// Mount: 恢复活动草稿（刷新/离开后重进续接管道；done+pending_review 直接进 review）
	useEffect(() => {
		if (!brandId) return;
		let cancelled = false;
		(async () => {
			try {
				const { drafts } = await fetchBrandDrafts(brandId);
				const active = drafts.find(
					(d) =>
						d.researchStatus === "queued" ||
						d.researchStatus === "running" ||
						(d.researchStatus === "done" && d.state === "pending_review"),
				);
				if (cancelled || !active) return;
				payloadRef.current = active.payload;
				setDraftId(active.id);
				if (active.researchStatus === "done") {
					setData(suggestionToWizardData(active.payload, brand?.name || "", brand?.website || ""));
					setPhase("review");
				} else {
					setPhase("analyzing");
				}
			} catch {
				// drafts 不可达（未登录/无权限等）——保持 idle，用户仍可手动触发
			}
		})();
		return () => {
			cancelled = true;
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
		if (!brand?.website || !brand?.id) return;
		setError(null);
		setPhase("analyzing");
		payloadRef.current = null;
		try {
			const res = await triggerResearch(brand.id, brand.website);
			setDraftId(res.draftId);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Research request failed");
			setPhase("idle");
		}
	}, [brand?.website, brand?.id]);

	// 轮询 draft.researchStatus（queued/running 持续，done/failed 停）
	const draftQuery = useQuery({
		queryKey: ["research-draft", draftId ?? "none"],
		queryFn: () => {
			if (!draftId) throw new Error("No research draft in flight");
			return fetchDraft(draftId);
		},
		enabled: phase === "analyzing" && !!draftId,
		staleTime: 0,
		gcTime: 0,
		refetchInterval: (query) => {
			const s = query.state.data?.researchStatus;
			return s === "queued" || s === "running" ? POLL_INTERVAL_MS : false;
		},
		refetchIntervalInBackground: true,
	});

	// 轮询结果驱动 phase 转移
	const draftData = draftQuery.data;
	useEffect(() => {
		if (phase !== "analyzing" || !draftData) return;
		if (draftData.researchStatus === "failed" || draftData.state === "failed") {
			setError(draftData.error || "Brand research failed. Please try again.");
			setPhase("idle");
			return;
		}
		if (draftData.researchStatus === "done") {
			payloadRef.current = draftData.payload;
			setData(suggestionToWizardData(draftData.payload, brand?.name || "", brand?.website || ""));
			setPhase("review");
			trackEvent("onboarding_analyzed", {
				competitor_count: draftData.payload.competitors?.length || 0,
				prompt_count: draftData.payload.suggestedPrompts?.length || 0,
				product_line_count: draftData.payload.productLines?.confirmed?.length || 0,
			});
		}
	}, [phase, draftData, brand?.name, brand?.website]);

	// Give up on a stuck research instead of polling forever.
	useEffect(() => {
		if (phase !== "analyzing") return;
		const timer = window.setTimeout(
			() => stopAnalyzing("Brand research timed out. Please try again."),
			ANALYZE_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [phase, stopAnalyzing]);

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
						skus: line.skus
							.filter((s) => s.name.trim() && s.evidenceUrl.trim())
							.map((s) => ({
								name: s.name.trim(),
								model: s.model?.trim() || undefined,
								oneLiner: s.oneLiner.trim(),
								evidenceUrl: s.evidenceUrl.trim(),
							})),
					},
				}))
				.filter((entry) => entry.line.name && entry.line.skus.length > 0);

			const base = payloadRef.current;
			// PATCH 回写用户编辑（payload 单一真源）——unverified 保留原行（忽略的行已被 ignore 从 payloadRef 移除）
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
					? {
							confirmed: confirmedLines,
							unverified: base.productLines.unverified,
						}
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
			setSubmitError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setIsSaving(false);
		}
	}, [brand, data, draftId, queryClient, router, onComplete]);

	if (phase === "idle" || phase === "analyzing") {
		return (
			<div className="max-w-2xl mx-auto space-y-3">
				<p className="text-sm text-muted-foreground">
					We'll analyze <strong>{brand?.website}</strong> using web search to suggest competitors, additional
					domains/aliases, and a starter set of AI prompts to track.
				</p>
				{error && (
					<div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
						<AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
						<span>{error}</span>
					</div>
				)}
				<div className="flex items-center gap-2">
					<Button
						onClick={handleAnalyze}
						disabled={phase === "analyzing"}
						className="flex items-center gap-2 cursor-pointer"
					>
						{phase === "analyzing" ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" /> Analyzing brand…
							</>
						) : (
							<>
								<Play className="h-4 w-4" /> Analyze brand
							</>
						)}
					</Button>
					{phase === "analyzing" && (
						<Button variant="outline" onClick={() => stopAnalyzing(null)} className="cursor-pointer">
							Cancel
						</Button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-2xl mx-auto space-y-6">
			<div className="space-y-2">
				<h2 className="text-2xl font-bold">Brand details</h2>
				<p className="text-muted-foreground">
					Confirm the brand identity, additional domains, and aliases used for tracking.
				</p>
				<div className="space-y-3">
					<div>
						<p className="text-xs text-muted-foreground">Brand name</p>
						<Input value={data.brandName} onChange={(e) => updateBrandName(e.target.value)} placeholder="Brand name" />
					</div>
					<div>
						<p className="text-xs text-muted-foreground">One-line positioning</p>
						<Input
							value={data.summary}
							onChange={(e) => updateSummary(e.target.value)}
							placeholder="What the brand is, in one sentence"
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Description</p>
						<Textarea
							value={data.description}
							onChange={(e) => updateDescription(e.target.value)}
							placeholder="Short company / product introduction"
							rows={3}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Website URL</p>
						<Input
							type="url"
							value={data.website}
							onChange={(e) => updateWebsite(e.target.value)}
							placeholder="https://example.com"
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Additional domains</p>
						<EditableTagsInput
							items={data.additionalDomains}
							onValueChange={updateAdditionalDomains}
							placeholder="Add domain..."
							maxItems={10}
						/>
					</div>
					<div>
						<p className="text-xs text-muted-foreground">Aliases</p>
						<EditableTagsInput
							items={data.aliases}
							onValueChange={updateAliases}
							placeholder="Add alias..."
							maxItems={10}
						/>
					</div>
				</div>
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<h2 className="text-2xl font-bold">Product lines</h2>
					<p className="text-muted-foreground">
						Product lines and SKUs your content covers. Every SKU keeps an evidence URL from the website scan.
					</p>
				</div>
				<ProductLinesEditor
					lines={data.productLines}
					onChange={updateProductLines}
					unverified={data.unverifiedLines}
					onIgnoreUnverified={ignoreUnverified}
					disabled={isSaving}
				/>
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<h2 className="text-2xl font-bold">Competitors</h2>
					<p className="text-muted-foreground">Companies you want tracked alongside your brand.</p>
				</div>
				<CompetitorsEditor competitors={data.competitors} onChange={updateCompetitors} disabled={isSaving} />
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<h2 className="text-2xl font-bold">Prompts</h2>
					<p className="text-muted-foreground">
						Pick which AI tracking prompts to start with. Untick any you don't want, edit tags, or add your own at the
						bottom.
					</p>
				</div>
				<PromptsListEditor prompts={data.prompts} onChange={updatePrompts} showSystemTags={false} />
			</div>

			{submitError && (
				<div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
					<AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
					<div className="text-sm">{submitError}</div>
				</div>
			)}

			<Button
				onClick={handleSubmit}
				disabled={isSaving || previewCounts.totalNew === 0}
				className="flex items-center gap-2 cursor-pointer"
			>
				{isSaving ? (
					<>
						<Loader2 className="h-4 w-4 animate-spin" /> Saving…
					</>
				) : (
					<>
						<Rocket className="h-4 w-4" /> Start tracking ({previewCounts.totalNew} new prompts)
					</>
				)}
			</Button>
		</div>
	);
}

/** suggestion/payload → WizardData（review 编辑区初始值）。模块级纯函数便于测试。 */
function suggestionToWizardData(
	suggestion: ResearchDraftPayload,
	brandNameFallback: string,
	websiteFallback: string,
): WizardData {
	const productLines = suggestion.productLines?.confirmed ?? [];
	return {
		brandName: suggestion.brandName || brandNameFallback,
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
		summary: suggestion.summary ?? "",
		description: suggestion.description ?? "",
		productLines: productLines.map((entry) =>
			newEditableProductLine({
				name: entry.line.name,
				skus: entry.line.skus.map((s) =>
					newEditableSku({
						name: s.name,
						model: s.model ?? "",
						oneLiner: s.oneLiner,
						evidenceUrl: s.evidenceUrl,
					}),
				),
			}),
		),
		unverifiedLines: (suggestion.productLines?.unverified ?? []).map((entry) => ({
			_key: safeUUID(),
			name: entry.line.name,
			skuNames: entry.line.skus.map((s) => s.name),
			reason: entry.reason,
		})),
	};
}
