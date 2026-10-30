/**
 * Shared prompts table — used by the settings/prompts page (manages a brand's
 * full prompt list) and the prompt wizard's Review step (picks from
 * AI-suggested prompts + custom additions).
 *
 * Controlled component: the caller owns the `prompts` array and the change
 * callback. The settings page wraps it with save/server logic; the wizard
 * keeps it inline. The `showSystemTags` prop hides the System Tags column
 * in the wizard since onboarding hasn't yet computed any system tags.
 */

import { IconInfoCircle } from "@tabler/icons-react";
import { describeSkipped, parseBulkPrompts } from "@workspace/lib/bulk-prompts";
import { MAX_PROMPTS } from "@workspace/lib/constants";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Inbox, ListPlus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { safeUUID } from "@/lib/uuid";
import { useLanguage } from "@/lib/language-context";

export interface EditablePrompt {
	id?: string;
	_key: string;
	value: string;
	enabled: boolean;
	tags: string[];
	systemTags: string[];
}

export function newPromptEntry(partial?: Partial<EditablePrompt>): EditablePrompt {
	return {
		_key: safeUUID(),
		value: partial?.value ?? "",
		enabled: partial?.enabled ?? true,
		tags: partial?.tags ?? [],
		systemTags: partial?.systemTags ?? [],
		...(partial?.id ? { id: partial.id } : {}),
	};
}

export function getPromptCategory(tags: string[]): string {
	const match = tags.find((t) => t.startsWith("dim:") || t.startsWith("cat:"));
	if (!match) return "";
	return match.slice(match.indexOf(":") + 1);
}

export function setPromptCategory(tags: string[], category: string): string[] {
	const cleanTags = tags.filter((t) => !t.startsWith("dim:") && !t.startsWith("cat:"));
	const trimmed = category.trim();
	if (trimmed) {
		cleanTags.push(`dim:${trimmed}`);
	}
	return cleanTags;
}

interface PromptsListEditorProps {
	prompts: EditablePrompt[];
	onChange: (next: EditablePrompt[]) => void;
	/** Show the read-only System Tags column. Default true. */
	showSystemTags?: boolean;
	/** Available category options for autocomplete (e.g. from product lines). */
	categoryOptions?: string[];
	/** `_key`s of rows edited since the last save, flagged with an accent rail
	 *  so a change is findable in a list of up to {@link MAX_PROMPTS} rows. */
	changedKeys?: ReadonlySet<string>;
}

export function PromptsListEditor({
	prompts,
	onChange,
	showSystemTags = true,
	categoryOptions,
	changedKeys,
}: PromptsListEditorProps) {
	const { language, t } = useLanguage();
	const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

	const allCategoryOptions = useMemo(() => {
		const set = new Set<string>(categoryOptions ?? []);
		for (const p of prompts) {
			const c = getPromptCategory(p.tags);
			if (c) set.add(c);
		}
		return [...set].filter(Boolean);
	}, [categoryOptions, prompts]);

	const allTagOptions = useMemo(() => {
		const set = new Set<string>();
		for (const p of prompts) {
			for (const t of p.tags) {
				if (!t.startsWith("dim:") && !t.startsWith("cat:")) {
					set.add(t);
				}
			}
		}
		return [...set].sort().map((t) => ({ value: t }));
	}, [prompts]);

	const update = (index: number, patch: Partial<EditablePrompt>) => {
		onChange(prompts.map((p, i) => (i === index ? { ...p, ...patch } : p)));
	};
	const handleCategoryChange = (index: number, newCat: string) => {
		const nextTags = setPromptCategory(prompts[index].tags, newCat);
		update(index, { tags: nextTags });
	};
	const handleCustomTagsChange = (index: number, newCustomTags: string[]) => {
		const currentCategory = getPromptCategory(prompts[index].tags);
		const nextTags = [...newCustomTags.filter((t) => !t.startsWith("dim:") && !t.startsWith("cat:"))];
		if (currentCategory) {
			nextTags.push(`dim:${currentCategory}`);
		}
		update(index, { tags: nextTags });
	};
	const add = () => {
		if (prompts.length >= MAX_PROMPTS) return;
		onChange([...prompts, newPromptEntry()]);
	};

	// Bulk paste. The parse is pure and lives in @workspace/lib so the rules
	// (trim, dedupe, cap) are tested without a DOM, and it runs on every
	// keystroke only to label the button and warn about what will be dropped.
	const [bulkOpen, setBulkOpen] = useState(false);
	const [bulkText, setBulkText] = useState("");

	// A row only takes a slot once it has text. Blank rows are how this editor
	// stages a new prompt and they're dropped on save, so counting them against
	// the cap would refuse prompts the list still has room for.
	const filledValues = useMemo(() => prompts.map((p) => p.value).filter((v) => v.trim().length > 0), [prompts]);
	const atCapacity = filledValues.length >= MAX_PROMPTS;

	const bulkPreview = useMemo(
		() => parseBulkPrompts(bulkText, { existing: filledValues, limit: MAX_PROMPTS }),
		[bulkText, filledValues],
	);
	const bulkNotice = bulkText.trim().length > 0 ? describeSkipped(bulkPreview.skipped) : null;

	// Over capacity blocks the whole paste rather than quietly taking the lines
	// that fit, so nobody submits a list believing all of it landed.
	const overCapacity = bulkPreview.skipped.overCapacity.length;
	const bulkError =
		overCapacity > 0
			? language === "zh"
				? `本次粘贴超出 ${overCapacity} 条提示词（最多 ${MAX_PROMPTS} 条）。请删除部分行后再继续。`
				: `This paste is ${overCapacity} prompt${overCapacity === 1 ? "" : "s"} over the ${MAX_PROMPTS} limit. Remove ${overCapacity === 1 ? "a line" : "some lines"} to continue.`
			: null;

	const closeBulk = () => {
		setBulkOpen(false);
		setBulkText("");
	};
	const addBulk = () => {
		if (bulkPreview.added.length === 0 || overCapacity > 0) return;
		onChange([...prompts, ...bulkPreview.added.map((value) => newPromptEntry({ value }))]);
		closeBulk();
	};

	// Count selection against current prompts so stale keys (e.g. after the
	// wizard regenerates suggestions) don't linger.
	const liveSelectedCount = prompts.reduce((n, p) => (selectedKeys.has(p._key) ? n + 1 : n), 0);
	const allSelected = prompts.length > 0 && liveSelectedCount === prompts.length;

	const toggleSelect = (key: string) => {
		setSelectedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	const toggleSelectAll = () => {
		if (allSelected) setSelectedKeys(new Set());
		else setSelectedKeys(new Set(prompts.map((p) => p._key)));
	};
	const applyEnabledToSelection = (enabled: boolean) => {
		if (liveSelectedCount === 0) return;
		onChange(prompts.map((p) => (selectedKeys.has(p._key) ? { ...p, enabled } : p)));
	};
	const clearSelection = () => setSelectedKeys(new Set());

	const validCount = prompts.filter((p) => p.enabled && p.value.trim().length > 0).length;

	// Desktop layout only — column order is [select] [text] [system?] [category] [tags] [switch].
	// Mobile renders a stacked per-prompt block instead (no selection, no bulk).
	const gridCols = showSystemTags
		? "md:grid-cols-[2.25rem_minmax(0,1.6fr)_4.5rem_minmax(7.5rem,9.5rem)_minmax(7rem,1fr)_2.75rem]"
		: "md:grid-cols-[2.25rem_minmax(0,1.8fr)_minmax(8rem,10.5rem)_minmax(8rem,1fr)_2.75rem]";

	return (
		<div className="space-y-4" data-no-i18n>
			<datalist id="prompt-category-options">
				{allCategoryOptions.map((c) => (
					<option key={c} value={c} />
				))}
			</datalist>

			{liveSelectedCount > 0 && (
				<div className="hidden md:flex flex-wrap items-center justify-between gap-x-2 gap-y-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
					<span className="text-muted-foreground">
						<strong className="text-foreground">{liveSelectedCount}</strong> {t.selectedCount}
					</span>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => applyEnabledToSelection(true)}
							className="cursor-pointer"
						>
							{t.enableBtn}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => applyEnabledToSelection(false)}
							className="cursor-pointer"
						>
							{t.disableBtn}
						</Button>
						<Button type="button" size="sm" variant="ghost" onClick={clearSelection} className="cursor-pointer">
							{t.clearSelectionBtn}
						</Button>
					</div>
				</div>
			)}

			<div className={`hidden md:grid ${gridCols} gap-2 text-sm font-medium text-muted-foreground border-b pb-2`}>
				<div className="flex justify-center">
					<Checkbox
						checked={allSelected}
						onCheckedChange={toggleSelectAll}
						disabled={prompts.length === 0}
						aria-label={allSelected ? "Deselect all prompts" : "Select all prompts"}
					/>
				</div>
				<div className="flex items-center gap-1 min-w-0">
					{t.promptTextCol}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent>
							<p className="max-w-xs">{t.promptTextTooltip}</p>
						</TooltipContent>
					</Tooltip>
				</div>
				{showSystemTags && (
					<div className="hidden md:flex items-center gap-1">
						{t.systemTagsCol}
						<Tooltip>
							<TooltipTrigger asChild>
								<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
							</TooltipTrigger>
							<TooltipContent>
								<p className="max-w-xs">{t.systemTagsTooltip}</p>
							</TooltipContent>
						</Tooltip>
					</div>
				)}
				<div className="flex items-center gap-1 min-w-0">
					{t.categoryCol}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent>
							<p className="max-w-xs">{t.categoryTooltip}</p>
						</TooltipContent>
					</Tooltip>
				</div>
				<div className="flex items-center gap-1 min-w-0">
					{t.tagsCol}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent>
							<p className="max-w-xs">{t.tagsTooltip}</p>
						</TooltipContent>
					</Tooltip>
				</div>
				<div className="flex justify-center">
					<span className="sr-only">Enabled</span>
				</div>
			</div>

			{prompts.length === 0 ? (
				<div className="border-2 border-dashed border-muted rounded-lg min-h-48 flex items-center justify-center">
					<div className="text-center py-8 text-muted-foreground">
						<Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
						<p>{t.noPromptsYet}</p>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					{prompts.map((prompt, index) => {
						const promptCategory = getPromptCategory(prompt.tags);
						const customTags = prompt.tags.filter((tag) => !tag.startsWith("dim:") && !tag.startsWith("cat:"));
						const isUnclassified = !promptCategory && prompt.enabled && prompt.value.trim().length > 0;

						return (
							<div
								key={prompt._key}
								className={cn(
									"-ml-3 border-l-2 pl-3 transition-colors",
									changedKeys?.has(prompt._key) ? "border-amber-500" : "border-transparent",
									!prompt.enabled && "opacity-60",
								)}
							>
								{changedKeys?.has(prompt._key) && <span className="sr-only">Has unsaved changes</span>}
								{/* Mobile: stacked, no selection/bulk */}
								<div className={`md:hidden flex flex-col gap-2 pb-3 ${index < prompts.length - 1 ? "border-b" : ""}`}>
									<div className="flex items-start gap-2">
										<Input
											value={prompt.value}
											onChange={(e) => update(index, { value: e.target.value })}
											placeholder={t.promptTextPlaceholder}
											className="min-w-0 flex-1"
										/>
										<div className="pt-2">
											<Switch
												checked={prompt.enabled}
												onCheckedChange={(checked) => update(index, { enabled: checked })}
												aria-label={prompt.enabled ? "Disable prompt" : "Enable prompt"}
											/>
										</div>
									</div>
									<div className="flex gap-2">
										<div className="flex-1 space-y-1">
											<Input
												list="prompt-category-options"
												value={promptCategory}
												onChange={(e) => handleCategoryChange(index, e.target.value)}
												placeholder={t.selectCategoryPlaceholder}
												className={cn("min-w-0 text-xs", isUnclassified && "border-amber-500 focus-visible:ring-amber-500")}
											/>
											{isUnclassified && (
												<p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
													{t.unclassifiedWarning}
												</p>
											)}
										</div>
										<div className="flex-1">
											<TagsInput
												value={customTags}
												onValueChange={(tags) => handleCustomTagsChange(index, tags)}
												options={allTagOptions}
												placeholder={t.addTagPlaceholder}
												searchPlaceholder={t.searchOrCreateTagPlaceholder}
												normalizeValue={(raw) => raw.toLowerCase().trim()}
											/>
										</div>
									</div>
								</div>

								{/* Desktop (md+): single-line grid */}
								<div className={`hidden md:grid ${gridCols} gap-2 items-start`}>
									<div className="flex justify-center pt-2">
										<Checkbox
											checked={selectedKeys.has(prompt._key)}
											onCheckedChange={() => toggleSelect(prompt._key)}
											aria-label="Select prompt"
										/>
									</div>
									<Input
										value={prompt.value}
										onChange={(e) => update(index, { value: e.target.value })}
										placeholder={t.promptTextPlaceholder}
										className="min-w-0"
									/>
									{showSystemTags && (
										<TagsInput value={prompt.systemTags} onValueChange={() => {}} disabled placeholder="—" />
									)}
									<div className="space-y-1">
										<Input
											list="prompt-category-options"
											value={promptCategory}
											onChange={(e) => handleCategoryChange(index, e.target.value)}
											placeholder={t.selectCategoryPlaceholder}
											className={cn("min-w-0 text-xs", isUnclassified && "border-amber-500 focus-visible:ring-amber-500")}
										/>
										{isUnclassified && (
											<p className="text-[10px] text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap">
												{t.unclassifiedWarning}
											</p>
										)}
									</div>
									<TagsInput
										value={customTags}
										onValueChange={(tags) => handleCustomTagsChange(index, tags)}
										options={allTagOptions}
										placeholder={t.addTagPlaceholder}
										searchPlaceholder={t.searchOrCreateTagPlaceholder}
										normalizeValue={(raw) => raw.toLowerCase().trim()}
									/>
									<div className="flex justify-center pt-2">
										<Switch
											checked={prompt.enabled}
											onCheckedChange={(checked) => update(index, { enabled: checked })}
											aria-label={prompt.enabled ? "Disable prompt" : "Enable prompt"}
										/>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}

			{!atCapacity && (
				<div className="flex flex-wrap items-center gap-2">
					{prompts.length < MAX_PROMPTS && (
						<Button
							variant="outline"
							size="sm"
							type="button"
							onClick={add}
							className="flex items-center gap-2 cursor-pointer"
						>
							<Plus className="h-4 w-4" /> {t.addPromptBtn}
						</Button>
					)}
					<Button
						variant="outline"
						size="sm"
						type="button"
						onClick={() => setBulkOpen((open) => !open)}
						className="flex items-center gap-2 cursor-pointer"
					>
						<ListPlus className="h-4 w-4" /> {t.addMultipleBtn}
					</Button>
				</div>
			)}

			{bulkOpen && !atCapacity && (
				<div className="space-y-2 rounded-md border bg-muted/40 p-3">
					<Textarea
						value={bulkText}
						onChange={(e) => setBulkText(e.target.value)}
						placeholder={t.onePromptPerLinePlaceholder}
						rows={6}
						aria-label="Prompts to add, one per line"
					/>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							type="button"
							onClick={addBulk}
							disabled={bulkPreview.added.length === 0 || overCapacity > 0}
						>
							{language === "zh"
								? `添加 ${bulkPreview.added.length > 0 ? `${bulkPreview.added.length} 条` : ""}提示词`
								: `Add ${bulkPreview.added.length > 0 ? `${bulkPreview.added.length} ` : ""}${bulkPreview.added.length === 1 ? "Prompt" : "Prompts"}`}
						</Button>
						<Button variant="ghost" size="sm" type="button" onClick={closeBulk}>
							{t.cancelBtn}
						</Button>
						{bulkNotice && <span className="text-xs text-muted-foreground">{bulkNotice}</span>}
					</div>
					{bulkError && (
						<p role="alert" className="text-xs text-destructive">
							{bulkError}
						</p>
					)}
				</div>
			)}

			{atCapacity && (
				<p className="text-xs text-muted-foreground">
					{t.itemsAddedMax}
				</p>
			)}

			<p className="text-xs text-muted-foreground">
				<strong>
					{validCount}/{MAX_PROMPTS}
				</strong>{" "}
				{t.promptsConfigured}
			</p>
		</div>
	);
}
