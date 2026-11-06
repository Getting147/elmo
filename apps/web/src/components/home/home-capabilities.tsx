import { IconAffiliate, IconChartBar, IconNetwork, IconShieldCheck } from "@tabler/icons-react";

const CAPABILITIES = [
	{
		number: "01",
		title: "信源穿透与引用溯源",
		icon: IconAffiliate,
		color: "text-blue-500 bg-blue-500/10 ring-blue-500/20",
		description:
			"精准识别主流大模型回答背后的权威信源链条，透视搜索引擎抓取偏好与高权重结构化数据引用点。",
		badge: "Citations & Sources",
	},
	{
		number: "02",
		title: "推荐位次与归因度量",
		icon: IconChartBar,
		color: "text-indigo-500 bg-indigo-500/10 ring-indigo-500/20",
		description:
			"构建多维行业高意向提示词矩阵，量化评估品牌在不同模型中的首推概率、位次排名与正负向情感偏好。",
		badge: "Answer Rank & Share",
	},
	{
		number: "03",
		title: "意图发散与检索裂变",
		icon: IconNetwork,
		color: "text-sky-500 bg-sky-500/10 ring-sky-500/20",
		description:
			"深度解析大模型在联网检索模式下的子查询裂变（Query Fan-out），拦截前置搜索流量，先发占领关键词心智。",
		badge: "Fan-out Insights",
	},
	{
		number: "04",
		title: "策略干预与资产防御",
		icon: IconShieldCheck,
		color: "text-emerald-500 bg-emerald-500/10 ring-emerald-500/20",
		description:
			"针对品牌未提及、事实错漏或负向竞争场景，输出可落地的权威信源补齐与官方知识库建设防御方案。",
		badge: "GEO Defense Action",
	},
];

export function HomeCapabilities() {
	return (
		<section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
			{/* Section Header */}
			<div className="text-center max-w-2xl mx-auto mb-12">
				<div className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
					核心能力矩阵
				</div>
				<h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
					赋能品牌掌控生成式 AI 时代的搜索分发权
				</h2>
				<p className="mt-2 text-sm text-muted-foreground">
					告别传统 SEO 的流量盲猜，建立面向生成式回答的端到端事实沉淀与信源权威工程。
				</p>
			</div>

			{/* 4 Cards Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{CAPABILITIES.map((cap) => {
					const Icon = cap.icon;
					return (
						<div
							key={cap.number}
							className="group relative rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-sm transition-all hover:border-blue-500/40 hover:shadow-md"
						>
							<div className="flex items-start justify-between">
								<div
									className={`flex size-11 items-center justify-center rounded-xl ring-1 ${cap.color}`}
								>
									<Icon className="size-5" />
								</div>
								<span className="font-mono text-xs font-semibold text-muted-foreground/60">
									{cap.number}
								</span>
							</div>

							<div className="mt-5">
								<div className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
									{cap.badge}
								</div>
								<h3 className="mt-1 text-lg font-bold text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
									{cap.title}
								</h3>
								<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
									{cap.description}
								</p>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
