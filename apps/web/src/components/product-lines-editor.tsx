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

export interface EditableSku {
	_key: string;
	name: string;
	model: string;
	oneLiner: string;
	evidenceUrl: string;
}

export interface EditableProductLine {
	_key: string;
	name: string;
	skus: EditableSku[];
}

export function newEditableSku(partial?: Partial<EditableSku>): EditableSku {
	return {
		_key: safeUUID(),
		name: partial?.name ?? "",
		model: partial?.model ?? "",
		oneLiner: partial?.oneLiner ?? "",
		evidenceUrl: partial?.evidenceUrl ?? "",
	};
}

export function newEditableProductLine(partial?: Partial<EditableProductLine>): EditableProductLine {
	return {
		_key: safeUUID(),
		name: partial?.name ?? "",
		skus: partial?.skus ?? [newEditableSku()],
	};
}

export interface UnverifiedProductLine {
	_key: string;
	name: string;
	skuNames: string[];
	reason: string;
}

/** Human-readable labels for the evidence failure codes emitted by the analyzer. */
export const EVIDENCE_REASON_LABELS: Record<string, string> = {
	URL_NOT_IN_CRAWL: "引用页面不在抓取范围内，无法核对",
	NAME_NOT_FOUND: "产品名称未能在引用页面中找到",
	MISSING_URL: "缺少证据链接，无法核对",
};

/**
 * Reasons arrive as `"<sku>: <CODE>"` entries joined with "; " — map each
 * embedded code to its human label and keep the rest of the text as-is.
 */
function reasonLabel(reason: string): string {
	return reason.replace(
		/\b(URL_NOT_IN_CRAWL|NAME_NOT_FOUND|MISSING_URL)\b/g,
		(code) => EVIDENCE_REASON_LABELS[code] ?? code,
	);
}

/** An evidence URL is required to keep a SKU — the storage schema enforces it. */
function isSkusValid(skus: EditableSku[]): { valid: boolean; firstInvalidIndex: number } {
	for (let i = 0; i < skus.length; i++) {
		const s = skus[i];
		if (!s.name.trim() || !s.evidenceUrl.trim()) return { valid: false, firstInvalidIndex: i };
		try {
			new URL(s.evidenceUrl);
		} catch {
			return { valid: false, firstInvalidIndex: i };
		}
	}
	return { valid: true, firstInvalidIndex: -1 };
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
	const addLine = () => onChange([...lines, newEditableProductLine()]);
	const removeLine = (index: number) => onChange(lines.filter((_, i) => i !== index));
	const addSku = (lineIndex: number) =>
		onChange(lines.map((l, i) => (i === lineIndex ? { ...l, skus: [...l.skus, newEditableSku()] } : l)));
	const removeSku = (lineIndex: number, skuIndex: number) =>
		onChange(
			lines.map((l, i) => (i === lineIndex ? { ...l, skus: l.skus.filter((_, j) => j !== skuIndex) } : l)),
		);

	return (
		<div className="space-y-4">
			{lines.length === 0 && (
				<p className="text-sm text-muted-foreground">
					No product lines yet. Add one below or keep this section empty.
				</p>
			)}

			{lines.map((line, lineIndex) => {
				const validity = isSkusValid(line.skus);
				return (
					<div key={line._key} className="space-y-3 rounded-md border p-3">
						<div className="flex items-center gap-2">
							<Package className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
							<Input
								value={line.name}
								onChange={(e) => updateLine(lineIndex, { name: e.target.value })}
								placeholder="Product line name (e.g. Refrigerators)"
								disabled={disabled}
								className="flex-1"
							/>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => removeLine(lineIndex)}
								disabled={disabled}
								className="cursor-pointer"
								title="Remove product line"
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>

						{!validity.valid && (
							<p className="text-xs text-amber-600">
								Every SKU needs a name and a valid evidence URL before it can be saved.
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
												placeholder="SKU / model name"
												disabled={disabled}
												className="flex-1"
											/>
											<Input
												value={sku.model ?? ""}
												onChange={(e) => updateSku(lineIndex, skuIndex, { model: e.target.value })}
												placeholder="Model (optional)"
												disabled={disabled}
												className="w-40"
											/>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => removeSku(lineIndex, skuIndex)}
												disabled={disabled}
												className="cursor-pointer"
												title="Remove SKU"
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
										<Textarea
											value={sku.oneLiner}
											onChange={(e) => updateSku(lineIndex, skuIndex, { oneLiner: e.target.value })}
											placeholder="One-line feature summary"
											disabled={disabled}
											rows={1}
										/>
										<Input
											type="url"
											value={sku.evidenceUrl}
											onChange={(e) => updateSku(lineIndex, skuIndex, { evidenceUrl: e.target.value })}
											placeholder="https://… evidence page"
											disabled={disabled}
										/>
									</div>
								))}
							</div>
						)}

						<Button variant="outline" size="sm" onClick={() => addSku(lineIndex)} disabled={disabled} className="cursor-pointer">
							<Plus className="h-3 w-3" /> Add SKU
						</Button>
					</div>
				);
			})}

			<Button variant="outline" size="sm" onClick={addLine} disabled={disabled} className="cursor-pointer">
				<Plus className="h-3 w-3" /> Add product line
			</Button>

			{unverified && unverified.length > 0 && (
				<div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
					<p className="text-sm font-medium text-amber-800 dark:text-amber-200">
						Suggestions that could not be verified against the website
					</p>
					<p className="text-xs text-amber-700 dark:text-amber-300">
						These were left out. Ignore them, or add them manually above with a valid evidence URL.
					</p>
					{unverified.map((u) => (
						<div key={u._key} className="flex items-start justify-between gap-2 rounded-sm border border-amber-200 bg-white/60 p-2 dark:border-amber-900 dark:bg-amber-950/20">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">{u.name}</p>
								<p className="text-xs text-muted-foreground">{u.skuNames.join(" · ")}</p>
								<p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
									<AlertCircle className="h-3 w-3 flex-shrink-0" />
									{reasonLabel(u.reason)}
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
									Ignore
								</Button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
