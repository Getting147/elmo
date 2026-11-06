import { IconShieldCheck, IconLock, IconRefresh } from "@tabler/icons-react";

const TRUST_POINTS = [
	{
		icon: IconShieldCheck,
		title: "权威信源严格对齐",
		desc: "绝非黑盒打分。每一项提及判定均锚定真实的模型原始回答、句子级位置标记与外部抓取信源快照，确保数据可被第三方复核。",
	},
	{
		icon: IconLock,
		title: "隔离租户与数据安全",
		desc: "支持多组织与多品牌专属隔离工作区，遵循企业级数据权限控制机制，品牌敏感战略与诊断指标完全私有闭环。",
	},
	{
		icon: IconRefresh,
		title: "持续防御与动态监控",
		desc: "主流大模型每周频繁迭代更新权重。通过周期性复测与告警，第一时间发现品牌位次滑落或竞品异动，掌握防守主动权。",
	},
];

export function HomeTrust() {
	return (
		<section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
			<div className="rounded-2xl border border-border/80 bg-card p-8 sm:p-12 shadow-sm">
				<div className="text-center max-w-2xl mx-auto mb-10">
					<div className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
						企业级治理
					</div>
					<h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
						为出海企业打造的可信 AI 资产治理底座
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						以事实和可追溯证据为基石，守护品牌在生成式 AI 时代的核心声誉与知识资产。
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-8">
					{TRUST_POINTS.map((item) => {
						const Icon = item.icon;
						return (
							<div key={item.title} className="space-y-3 text-left">
								<div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
									<Icon className="size-5" />
								</div>
								<h3 className="text-base font-bold text-foreground">
									{item.title}
								</h3>
								<p className="text-xs leading-relaxed text-muted-foreground">
									{item.desc}
								</p>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
