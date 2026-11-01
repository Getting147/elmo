import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { useLanguage } from "@/lib/language-context";

function StatCard({ title, tooltip, value }: { title: string; tooltip: React.ReactNode; value: React.ReactNode }) {
	return (
		<Card className="flex flex-col">
			<CardHeader className="gap-0">
				<CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
					{title}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">{tooltip}</TooltipContent>
					</Tooltip>
				</CardTitle>
			</CardHeader>
			<CardContent className="flex-1 flex items-center">
				<div className="text-2xl sm:text-3xl lg:text-4xl font-bold">{value}</div>
			</CardContent>
		</Card>
	);
}

export function CitationStatsCards({
	brandShare,
	uniqueDomains,
	totalCitations,
}: {
	brandShare: number;
	uniqueDomains: number;
	totalCitations: number;
}) {
	const { language } = useLanguage();
	const isZh = language === "zh";

	return (
		<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
			<StatCard
				title={isZh ? "品牌引用份额" : "Brand Citation Share"}
				tooltip={
					isZh
						? "所有引用中指向您品牌域名的百分比。更高的份额意味着 AI 模型更有可能引用您的内容。"
						: "The percentage of all citations that link to your brand's domain. A higher share means AI models are more likely to reference your content."
				}
				value={`${brandShare}%`}
			/>
			<StatCard
				title={isZh ? "独立域名数" : "Unique Domains"}
				tooltip={
					isZh
						? "所选周期内所有评测引用的不同独立域名总数。"
						: "The number of distinct domains cited across all prompt evaluations in this period."
				}
				value={uniqueDomains.toLocaleString()}
			/>
			<StatCard
				title={isZh ? "引用总数" : "Total Citations"}
				tooltip={
					isZh
						? "AI 模型在评测中引用的外部网站链接总数。"
						: "The total external websites cited by AI models across prompt evaluations."
				}
				value={totalCitations.toLocaleString()}
			/>
		</div>
	);
}
