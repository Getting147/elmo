import { IconAlertTriangle, IconCheck, IconClock, IconRefresh } from "@tabler/icons-react";
import type { DiagnosisStage } from "@/lib/baseline-stages";

const styles = {
	pending: "bg-muted/20 text-muted-foreground",
	blocked: "bg-muted/20 text-muted-foreground",
	queued: "bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950/20 dark:text-blue-200",
	running: "bg-blue-50 border-blue-400 text-blue-800 dark:bg-blue-950/20 dark:text-blue-200",
	success: "bg-green-50/60 border-green-300 text-green-800 dark:bg-green-950/20 dark:text-green-200",
	partial: "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200",
	failed: "bg-red-50 border-red-300 text-red-800 dark:bg-red-950/20 dark:text-red-200",
};
const labels = {
	pending: "未执行",
	blocked: "前置阻断",
	queued: "已排队",
	running: "运行中",
	success: "已就绪",
	partial: "部分结果",
	failed: "失败",
};

export function DiagnosisStages({ stages }: { stages: DiagnosisStage[] }) {
	return (
		<fieldset
			className="m-0 min-w-0 border-0 p-0 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"
			aria-label="本次诊断阶段"
		>
			{stages.map((stage) => (
				<section
					key={stage.title}
					aria-label={`${stage.title}：${labels[stage.state]}`}
					className={`p-3 rounded-lg border ${styles[stage.state]}`}
				>
					<div className="flex items-center gap-1.5 font-semibold">
						{stage.state === "success" ? (
							<IconCheck size={14} />
						) : stage.state === "running" ? (
							<IconRefresh size={14} className="animate-spin" />
						) : stage.state === "failed" || stage.state === "partial" ? (
							<IconAlertTriangle size={14} />
						) : (
							<IconClock size={14} />
						)}
						<span>{stage.title}</span>
					</div>
					<div className="text-[11px] mt-1">
						{labels[stage.state]} · {stage.description}
					</div>
				</section>
			))}
		</fieldset>
	);
}
