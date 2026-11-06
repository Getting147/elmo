const STEPS = [
	{
		step: "01",
		title: "输入品牌档案",
		desc: "填入品牌名称与官方主域名，系统智能解析多语言与二级架构，建立专属监测基准。",
	},
	{
		step: "02",
		title: "构建提问矩阵",
		desc: "覆盖行业高价值购买意向、方案选型、竞品对比等典型问答场景，生成标准化测评集。",
	},
	{
		step: "03",
		title: "全引擎并发采样",
		desc: "调度主流生成式模型进行多轮实测采样，捕获原始回答、引用链接与联网检索过程。",
	},
	{
		step: "04",
		title: "洞察交付与防御",
		desc: "提供包含推荐位次、竞品共现、信源缺口的实时看板，指导品牌实施定向优化干预。",
	},
];

export function HomeWorkflow() {
	return (
		<section className="border-y border-border/40 bg-muted/20 py-16">
			<div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
				<div className="text-center max-w-2xl mx-auto mb-12">
					<div className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
						落地路径
					</div>
					<h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
						清晰可控的 4 步标准化工作流
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						从建档到落地防御，系统化提升品牌在各生成式引擎中的可见性与信赖度。
					</p>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
					{STEPS.map((item) => (
						<div
							key={item.step}
							className="relative rounded-xl border border-border/60 bg-card p-5 shadow-xs"
						>
							<div className="font-mono text-2xl font-extrabold text-blue-600/40 dark:text-blue-400/40">
								{item.step}
							</div>
							<h3 className="mt-3 text-base font-bold text-foreground">
								{item.title}
							</h3>
							<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
								{item.desc}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
