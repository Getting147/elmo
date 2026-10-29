import { IconArrowRight, IconClipboardCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { z } from "zod";
import { baselineRunStatusSchema, diagnosisStatusText, isDiagnosisInProgress } from "@/lib/baseline-status";
import { getBaselineRunFn, listBaselineRunsFn } from "@/server/baseline";

export function DiagnosisStatus({ brandId, enabledPrompts }: { brandId: string; enabledPrompts: number }) {
	const {
		data: run,
		error,
		isPending,
		refetch,
	} = useQuery({
		queryKey: ["baseline-latest-run", brandId],
		queryFn: async () => {
			const list = z
				.object({ items: z.array(z.object({ run_id: z.string().min(1) })) })
				.parse(await listBaselineRunsFn({ data: { brandId } }));
			const latest = list.items[0];
			if (!latest) return null;
			return baselineRunStatusSchema.parse(await getBaselineRunFn({ data: { brandId, runId: latest.run_id } }));
		},
		retry: false,
		refetchInterval: (query) => (query.state.data && isDiagnosisInProgress(query.state.data) ? 2000 : false),
	});
	const content = isPending
		? { title: "正在读取诊断状态", description: "正在查询该品牌已发起的任务。" }
		: error
			? { title: "暂时无法读取诊断状态", description: error.message }
			: diagnosisStatusText(run ?? null);
	return (
		<section
			data-no-i18n="true"
			className="flex flex-1 flex-col items-center justify-center gap-5 p-6 max-w-2xl mx-auto text-center"
			aria-label="豆包诊断状态"
		>
			<div className="rounded-full bg-muted p-4">
				<IconClipboardCheck className="h-9 w-9 text-muted-foreground" />
			</div>
			<div className="space-y-3" aria-live="polite">
				<h2 className="text-2xl font-bold">{content.title}</h2>
				<p className="text-muted-foreground text-balance">{content.description}</p>
			</div>
			{run && (
				<p className="text-sm text-muted-foreground break-all">
					本次任务：{run.run_id} · {run.mode === "synthetic" ? "离线合成测试，非真实豆包结果" : "真实执行"}
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				当前已启用 {enabledPrompts} 道问题，可在诊断流程中核对和补齐分类。
			</p>
			<div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
				<Button asChild>
					<Link to="/app/$brand/reports" params={{ brand: brandId }}>
						{run ? "查看本次诊断" : "进入豆包诊断"}
						<IconArrowRight className="h-4 w-4" />
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to="/app/$brand/settings/prompts" params={{ brand: brandId }}>
						查看现有问题
					</Link>
				</Button>
				{error && (
					<Button variant="outline" onClick={() => refetch()}>
						重新读取状态
					</Button>
				)}
			</div>
		</section>
	);
}
