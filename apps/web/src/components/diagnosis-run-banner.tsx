import { Link } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Card } from "@workspace/ui/components/card";
import {
	IconFileText,
	IconCheck,
	IconAlertTriangle,
	IconLoader2,
	IconClock,
	IconWorld,
	IconAlertCircle,
} from "@tabler/icons-react";
import { useLanguage } from "@/lib/language-context";

export interface DiagnosisRunBannerProps {
	activeRunId?: string;
	runsList: any[];
	runData?: any;
	metricsData?: any;
	onSelectRun: (runId: string) => void;
	brandId?: string;
	pageTitle?: string;
}

export function DiagnosisRunBanner({
	activeRunId,
	runsList,
	runData,
	metricsData,
	onSelectRun,
	brandId,
	pageTitle,
}: DiagnosisRunBannerProps) {
	const { language } = useLanguage();
	const isZh = language === "zh";

	if (!runsList || runsList.length === 0 || !activeRunId) {
		return null;
	}

	const status = runData?.status || "unknown";
	const isCompleted = status === "completed";
	const isPartial = status === "partial";
	const isRunning = status === "running" || status === "created" || status === "started";
	const isFailed = status === "failed" || status === "cancelled";

	const platformName = runData?.model_name || "doubao-pro-32k";
	const webSearchEnabled = runData?.web_search ?? true;

	const sampleDate = (runData?.completed_at || runData?.created_at || "")
		.replace("T", " ")
		.slice(0, 16);

	const validQuestions =
		metricsData?.p0_summary?.effective_sample_count ??
		metricsData?.p0_summary?.valid_questions ??
		runData?.valid_questions ??
		0;
	const totalQuestions =
		metricsData?.p0_summary?.planned_questions ??
		runData?.total_questions ??
		0;

	return (
		<div className="flex flex-col gap-3 rounded-xl border border-blue-200/60 bg-blue-50/40 p-4 dark:border-blue-900/40 dark:bg-blue-950/20 text-xs">
			{/* Top Bar: Selector and Report Link */}
			<div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-semibold text-foreground">
						{isZh ? "当前诊断任务:" : "Diagnostic Task:"}
					</span>
					<select
						value={activeRunId}
						aria-label={isZh ? "切换已有监测任务" : "Switch diagnostic run"}
						onChange={(e) => {
							if (e.target.value) onSelectRun(e.target.value);
						}}
						className="border rounded-md px-2.5 py-1.5 bg-background font-mono text-xs max-w-xs shadow-sm cursor-pointer"
					>
						<option value="" disabled>
							{isZh ? "-- 选择已有任务查看/处理 --" : "-- Select diagnostic task --"}
						</option>
						{runsList.map((r: any) => (
							<option key={r.run_id} value={r.run_id}>
								{r.run_id} ({r.mode || "real"} · {r.status} · {r.created_at?.slice(0, 16)})
							</option>
						))}
					</select>
				</div>

				{brandId && (
					<Link
						to="/app/$brand/reports"
						params={{ brand: brandId }}
						search={{ runId: activeRunId }}
						className="inline-flex items-center gap-1.5 font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
					>
						<IconFileText size={15} />
						<span>{isZh ? "查看 9 章诊断报告完整版 →" : "View 9-Chapter Report →"}</span>
					</Link>
				)}
			</div>

			{/* Metadata Badges Row */}
			<div className="flex flex-wrap items-center gap-2 pt-1 border-t border-blue-100/80 dark:border-blue-900/30 text-muted-foreground">
				<span className="flex items-center gap-1">
					<IconWorld size={13} className="text-muted-foreground" />
					<span className="font-medium text-foreground">
						{isZh ? "评测平台与渠道:" : "Platform & Channel:"}
					</span>
					<span>
						豆包 (Doubao) · {platformName} ·{" "}
						{webSearchEnabled
							? isZh
								? "网页版 / 联网检索开启"
								: "Web Search Enabled"
							: isZh
								? "未开启联网"
								: "No Web Search"}
					</span>
				</span>

				<span className="text-muted-foreground/40">|</span>

				<span className="flex items-center gap-1">
					<span className="font-medium text-foreground">
						{isZh ? "采样状态:" : "Status:"}
					</span>
					{isCompleted && (
						<Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400 gap-1 text-[11px]">
							<IconCheck size={12} /> {isZh ? "已完成" : "Completed"}
						</Badge>
					)}
					{isPartial && (
						<Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400 gap-1 text-[11px]">
							<IconAlertTriangle size={12} /> {isZh ? "部分完成" : "Partial"}
						</Badge>
					)}
					{isRunning && (
						<Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400 gap-1 text-[11px] animate-pulse">
							<IconLoader2 size={12} className="animate-spin" /> {isZh ? "采集中" : "Running"}
						</Badge>
					)}
					{isFailed && (
						<Badge variant="destructive" className="gap-1 text-[11px]">
							<IconAlertCircle size={12} /> {isZh ? "采样失败" : "Failed"}
						</Badge>
					)}
				</span>

				{sampleDate && (
					<>
						<span className="text-muted-foreground/40">|</span>
						<span className="flex items-center gap-1">
							<IconClock size={13} className="text-muted-foreground" />
							<span>{sampleDate}</span>
						</span>
					</>
				)}

				<span className="text-muted-foreground/40">|</span>
				<span>
					{isZh ? "有效样本:" : "Valid Samples:"}{" "}
					<strong className="text-foreground font-semibold">
						{validQuestions} / {totalQuestions}
					</strong>{" "}
					{isZh ? "道正式题" : "prompts"}
				</span>
			</div>

			{/* Status Alerts if running or failed */}
			{isRunning && (
				<div className="bg-blue-100/60 dark:bg-blue-900/30 rounded-lg p-2.5 flex items-center gap-2 text-blue-900 dark:text-blue-200 text-xs">
					<IconLoader2 size={14} className="animate-spin shrink-0" />
					<span>
						{isZh
							? "该诊断任务正在后台进行网络采样，当前看板呈现已产出的阶段性结果，完成后可刷新获取最终统计。"
							: "This diagnostic task is collecting samples in background. Showing available partial results."}
					</span>
				</div>
			)}

			{isFailed && (
				<div className="bg-rose-100/80 dark:bg-rose-950/40 rounded-lg p-2.5 flex items-center gap-2 text-rose-900 dark:text-rose-200 text-xs">
					<IconAlertCircle size={14} className="shrink-0" />
					<span>
						{isZh ? "采样任务未能全部成功完成" : "Sampling task failed to complete"}
						{runData?.error_message ? `：${runData.error_message}` : "。"}
					</span>
				</div>
			)}
		</div>
	);
}
