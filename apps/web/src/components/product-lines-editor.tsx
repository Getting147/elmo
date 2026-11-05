/**
 * Product lines / SKUs editor — used by the prompt wizard's Review step to
 * confirm AI-suggested product lines before they are stored.
 *
 * Controlled component: the caller owns the `lines` array (and the read-only
 * `unverified` list) and the change callbacks. Confirmed lines are fully
 * editable; unverified lines are displayed with their reason (evidence check
 * failed) and can be ignored one by one — they are never submitted as-is.
 */
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { AlertCircle, Package, Plus, Trash2 } from "lucide-react";

import { safeUUID } from "@/lib/uuid";
import { useLanguage } from "@/lib/language-context";
import type { ProductResearchEvidence } from "@workspace/lib/onboarding";

export interface EditableSku {
	_key: string;
	name: string;
	model: string;
	oneLiner: string;
	evidenceUrl: string;
	evidenceQuote?: string;
}

export interface EditableProductLine {
	_key: string;
	name: string;
	skus: EditableSku[];
	category?: string;
	researchEvidence?: ProductResearchEvidence;
}

export function newEditableSku(partial?: Partial<EditableSku>): EditableSku {
	return {
		_key: safeUUID(),
		name: partial?.name ?? "",
		model: partial?.model ?? "",
		oneLiner: partial?.oneLiner ?? "",
		evidenceUrl: partial?.evidenceUrl ?? "",
		evidenceQuote: partial?.evidenceQuote,
	};
}

export function newEditableProductLine(partial?: Partial<EditableProductLine>): EditableProductLine {
	return {
		_key: safeUUID(),
		name: partial?.name ?? "",
		skus: partial?.skus ?? [newEditableSku()],
		category: partial?.category,
		researchEvidence: partial?.researchEvidence,
	};
}

export interface UnverifiedProductLine {
	_key: string;
	name: string;
	skuNames: string[];
	reason: string;
	researchEvidence?: ProductResearchEvidence;
}

export const EVIDENCE_REASON_LABELS_ZH: Record<string, string> = {
	URL_NOT_IN_CRAWL: "引用页面不在抓取范围内，无法核对",
	NAME_NOT_FOUND: "产品名称未能在引用页面中找到",
	MISSING_URL: "缺少证据链接，无法核对",
	NO_SKU_DETAIL: "仅泛称或分类，未包含具体型号与证据",
	CATEGORY_SOURCE: "类别来源待核",
	SKU_NEEDS_PRODUCT_LINE: "具体型号尚无可核对的所属产品线",
	INVALID_SKU_STRUCTURE: "具体型号名称或说明缺失",
	ROLE_UNCONFIRMED: "层级语义待人工核对",
	missingSource: "缺少来源 URL 或逐字引文",
	urlNotInCrawl: "引用页面不在本轮取材范围",
	quoteNotFound: "逐字引文未出现在来源正文",
	nameNotInQuote: "名称或型号未出现在逐字引文",
	uncertain: "层级判断待核",
};

export const EVIDENCE_REASON_LABELS_EN: Record<string, string> = {
	URL_NOT_IN_CRAWL: "Cited page not in crawl scope",
	NAME_NOT_FOUND: "Product name not found on cited page",
	MISSING_URL: "Missing evidence URL",
	NO_SKU_DETAIL: "Generic category only, no specific model or evidence",
	CATEGORY_SOURCE: "Category source pending",
	SKU_NEEDS_PRODUCT_LINE: "Concrete model needs an evidenced product line",
	INVALID_SKU_STRUCTURE: "Missing concrete model name or description",
	ROLE_UNCONFIRMED: "Hierarchy semantics pending human review",
	missingSource: "Missing URL or verbatim quote",
	urlNotInCrawl: "Source was not fetched in this research",
	quoteNotFound: "Quote not found in source",
	nameNotInQuote: "Name/model not present in quote",
	uncertain: "Hierarchy pending",
};

export const EVIDENCE_REASON_LABELS = EVIDENCE_REASON_LABELS_ZH;

/**
 * Reasons arrive as `"<sku>: <CODE>"` entries joined with "; " — map each
 * embedded code to its human label and keep the rest of the text as-is.
 */
export function formatEvidenceReason(reason: string, lang: "zh" | "en" = "zh"): string {
	const labels = lang === "en" ? EVIDENCE_REASON_LABELS_EN : EVIDENCE_REASON_LABELS_ZH;
	return reason.replace(
		/\b(URL_NOT_IN_CRAWL|NAME_NOT_FOUND|MISSING_URL|NO_SKU_DETAIL|CATEGORY_SOURCE|SKU_NEEDS_PRODUCT_LINE|INVALID_SKU_STRUCTURE|ROLE_UNCONFIRMED|missingSource|urlNotInCrawl|quoteNotFound|nameNotInQuote|uncertain)\b/g,
		(code) => labels[code] ?? code,
	);
}

/** An evidence URL is required to keep a SKU — the storage schema enforces it. */
export function areSkusValid(skus: EditableSku[]): boolean {
	return skus.every((s) => {
		if (!s.name.trim() || !s.evidenceUrl.trim()) return false;
		try {
			new URL(s.evidenceUrl);
			return true;
		} catch {
			return false;
		}
	});
}

interface ProductLinesEditorProps {
	lines: EditableProductLine[];
	onChange: (next: EditableProductLine[]) => void;
	/** Read-only lines that failed evidence validation (never submitted). */
	unverified?: UnverifiedProductLine[];
	onIgnoreUnverified?: (key: string) => void;
	disabled?: boolean;
}

export function ProductLinesEditor({
	lines,
	onChange,
	unverified,
	onIgnoreUnverified,
	disabled,
}: ProductLinesEditorProps) {
	const { language, t } = useLanguage();

	const updateLine = (index: number, patch: Partial<EditableProductLine>) => {
		onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
	};
	const updateSku = (lineIndex: number, skuIndex: number, patch: Partial<EditableSku>) => {
		onChange(
			lines.map((l, i) =>
				i === lineIndex
					? { ...l, skus: l.skus.map((s, j) => (j === skuIndex ? { ...s, ...patch } : s)) }
					: l,
			),
		);
	};
	const updateSource = (lineIndex: number, patch: Partial<ProductResearchEvidence>) => {
		const line = lines[lineIndex];
		updateLine(lineIndex, {
			researchEvidence: { kind: "uncertain", evidenceUrl: null, evidenceQuote: null, ...line.researchEvidence, ...patch },
		});
	};
	const addLine = () => onChange([...lines, newEditableProductLine()]);
	const removeLine = (index: number) => onChange(lines.filter((_, i) => i !== index));
	const addSku = (lineIndex: number) =>
		onChange(lines.map((l, i) => (i === lineIndex ? { ...l, skus: [...l.skus, newEditableSku()] } : l)));
	const removeSku = (lineIndex: number, skuIndex: number) =>
		onChange(
			lines.map((l, i) => (i === lineIndex ? { ...l, skus: l.skus.filter((_, j) => j !== skuIndex) } : l)),
		);

	return (
		<div className="space-y-4" data-no-i18n>
			{lines.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t.noProductLines}
				</p>
			)}

			{lines.map((line, lineIndex) => {
				const skusValid = areSkusValid(line.skus);
				return (
					<div key={line._key} className="space-y-3 rounded-md border p-3">
						<p className="text-xs text-muted-foreground">
							{language === "zh"
								? line.researchEvidence?.kind === "business" ? "业务板块"
									: line.researchEvidence?.kind === "productLine" ? `产品线${line.category ? ` · 所属业务板块：${line.category}` : " · 父板块尚未核对"}`
										: "历史未分类 / 人工条目，来源待核"
								: line.researchEvidence?.kind === "business" ? "Business sector" : line.researchEvidence?.kind === "productLine" ? `Product line${line.category ? ` · ${line.category}` : " · Parent not established"}` : "Legacy / manual, source pending"}
							{` · ${line.skus.length} SKU`}
						</p>
						<div className="space-y-2 text-xs text-muted-foreground">
							<p>{language === "zh" ? "类别与来源（保存时按本轮正文重新核对，不等于独立商业事实审计）" : "Category/source checked against this crawl when saving; not an independent business audit"}</p>
							<select
								aria-label={language === "zh" ? "层级类型" : "Hierarchy type"}
								value={line.researchEvidence?.kind ?? "uncertain"}
								disabled={disabled}
								onChange={(event) => updateSource(lineIndex, { kind: event.target.value === "business" ? "business" : event.target.value === "productLine" ? "productLine" : "uncertain" })}
								className="rounded border bg-background p-1"
							>
								<option value="uncertain">{language === "zh" ? "未分类 / 待核" : "Unclassified / pending"}</option>
								<option value="business">{language === "zh" ? "业务板块" : "Business sector"}</option>
								<option value="productLine">{language === "zh" ? "产品线" : "Product line"}</option>
							</select>
							<Input type="url" aria-label={language === "zh" ? "类别来源 URL" : "Category source URL"} value={line.researchEvidence?.evidenceUrl ?? ""}
								onChange={(event) => updateSource(lineIndex, { evidenceUrl: event.target.value || null })} disabled={disabled} />
							<Textarea aria-label={language === "zh" ? "类别逐字引文" : "Category verbatim quote"} value={line.researchEvidence?.evidenceQuote ?? ""}
								onChange={(event) => updateSource(lineIndex, { evidenceQuote: event.target.value || null })} disabled={disabled} rows={2} />
						</div>
						{line.skus.length === 0 && <p className="text-xs text-muted-foreground">{language === "zh" ? "类别可保留，本轮尚无已核对的具体型号。" : "Category retained; no concrete model established in this crawl."}</p>}
						<div className="flex items-center gap-2">
							<Package className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
							<Input
								value={line.name}
								onChange={(e) => updateLine(lineIndex, { name: e.target.value })}
								placeholder={t.productLineNamePlaceholder}
								disabled={disabled}
								className="flex-1"
							/>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => removeLine(lineIndex)}
								disabled={disabled}
								className="cursor-pointer"
								title={t.removeProductLine}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>

						{!skusValid && (
							<p className="text-xs text-amber-600">
								{t.skuRequirementError}
							</p>
						)}

						{line.skus.length > 0 && (
							<div className="space-y-2 pl-6">
								{line.skus.map((sku, skuIndex) => (
									<div key={sku._key} className="space-y-1 rounded-sm border-l-2 border-dashed pl-3">
										<div className="flex items-center gap-2">
											<Input
												value={sku.name}
												onChange={(e) => updateSku(lineIndex, skuIndex, { name: e.target.value })}
												placeholder={t.skuNamePlaceholder}
												disabled={disabled}
												className="flex-1"
											/>
											<Input
												value={sku.model ?? ""}
												onChange={(e) => updateSku(lineIndex, skuIndex, { model: e.target.value })}
												placeholder={t.skuModelPlaceholder}
												disabled={disabled}
												className="w-40"
											/>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => removeSku(lineIndex, skuIndex)}
												disabled={disabled}
												className="cursor-pointer"
												title={t.removeSku}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
										<Textarea
											value={sku.oneLiner}
											onChange={(e) => updateSku(lineIndex, skuIndex, { oneLiner: e.target.value })}
											placeholder={t.skuOneLinerPlaceholder}
											disabled={disabled}
											rows={1}
										/>
										<Input
											type="url"
											value={sku.evidenceUrl}
											onChange={(e) => updateSku(lineIndex, skuIndex, { evidenceUrl: e.target.value })}
											placeholder={t.skuEvidenceUrlPlaceholder}
											disabled={disabled}
										/>
										<Textarea aria-label={language === "zh" ? "型号逐字引文" : "Model verbatim quote"}
											value={sku.evidenceQuote ?? ""} onChange={(event) => updateSku(lineIndex, skuIndex, { evidenceQuote: event.target.value })}
											disabled={disabled} rows={2} />
									</div>
								))}
							</div>
						)}

						<Button variant="outline" size="sm" onClick={() => addSku(lineIndex)} disabled={disabled || line.researchEvidence?.kind === "business"} className="cursor-pointer">
							<Plus className="h-3 w-3" /> {t.addSkuBtn}
						</Button>
					</div>
				);
			})}

			<Button variant="outline" size="sm" onClick={addLine} disabled={disabled} className="cursor-pointer">
				<Plus className="h-3 w-3" /> {t.addProductLineBtn}
			</Button>

			{unverified && unverified.length > 0 && (
				<div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
					<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
						{language === "zh" ? "待核验的类别或具体型号建议" : "Category or concrete-model suggestions pending review"}
					</p>
					<p className="text-xs text-amber-700 dark:text-amber-300">
						{language === "zh" ? "来源、层级与具体型号分别核对；待核项不会自动入库，也不影响有效问题与已核对类别。" : "Sources, hierarchy and concrete models are reviewed separately. Pending items are not imported and do not remove valid questions or checked categories."}
					</p>
					{unverified.map((u) => (
						<div key={u._key} className="flex items-start justify-between gap-2 rounded-sm border border-amber-200 bg-white/60 p-2 dark:border-amber-900 dark:bg-amber-950/20">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">{u.name}</p>
								<p className="text-xs text-muted-foreground">{u.skuNames.join(" · ")}</p>
								{u.researchEvidence && <p className="break-all text-xs text-muted-foreground">{u.researchEvidence.evidenceUrl} · {u.researchEvidence.evidenceQuote}</p>}
								<p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
									<AlertCircle className="h-3 w-3 flex-shrink-0" />
									{formatEvidenceReason(u.reason, language)}
								</p>
							</div>
							{onIgnoreUnverified && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => onIgnoreUnverified(u._key)}
									disabled={disabled}
									className="cursor-pointer"
								>
									{t.ignoreBtn}
								</Button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
