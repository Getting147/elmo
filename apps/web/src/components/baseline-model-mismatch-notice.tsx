import { Card, CardContent } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { IconAlertCircle } from "@tabler/icons-react";
import { useLanguage } from "@/lib/language-context";

/** Shown when a concrete model filter cannot apply to the active baseline run:
 *  either the run has no recorded model identity, or it ran a different
 *  concrete model. The filter stays in the URL until the user clears it. */
export function BaselineModelMismatchNotice({
	runModel,
	selectedModel,
	onClearModel,
}: {
	runModel?: string | null;
	selectedModel?: string | null;
	onClearModel?: () => void;
}) {
	const { language } = useLanguage();
	const isZh = language === "zh";
	const runModelMissing = !runModel?.trim();

	return (
		<Card className="border border-border/80 shadow-sm">
			<CardContent className="py-12 px-6 text-center space-y-3">
				<div className="size-12 mx-auto rounded-full bg-muted flex items-center justify-center text-muted-foreground">
					<IconAlertCircle size={24} />
				</div>
				<div className="space-y-1 max-w-md mx-auto">
					<h3 className="text-base font-semibold text-foreground">
						{runModelMissing
							? isZh
								? "当前任务未提供模型信息，无法按型号筛选"
								: "This task has no model identity, so the model filter cannot apply"
							: isZh
								? "所选模型与当前任务不一致"
								: "The selected model does not match this task"}
					</h3>
					<p className="text-sm text-muted-foreground leading-relaxed">
						{runModelMissing
							? isZh
								? `当前任务未记录实际执行的模型，系统不会把所选模型「${selectedModel}」视作匹配，也不会推测具体版本。`
								: `This run did not record which model it executed. The selected model "${selectedModel}" is not treated as a match, and no version is inferred.`
							: isZh
								? `当前任务实际使用 ${runModel}，与所选模型「${selectedModel}」不一致，未展示其他模型的结果。`
								: `This task ran ${runModel}, not the selected model "${selectedModel}". Results from a different model are not shown.`}
					</p>
				</div>
				{onClearModel && (
					<Button variant="outline" size="sm" onClick={onClearModel} className="cursor-pointer">
						{isZh ? "清除模型筛选" : "Clear model filter"}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}