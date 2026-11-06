import { IconCheck, IconTarget, IconLink, IconListSearch, IconUsers } from "@tabler/icons-react";

export function HomeAnatomy() {
	return (
		<section className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
			{/* Section Header */}
			<div className="mb-8 text-center sm:text-left flex flex-col sm:flex-row sm:items-end justify-between gap-4">
				<div>
					<div className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
						核心技术透视
					</div>
					<h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
						AI 回答透视与信源事实审计
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						基于真实数据库与分析引擎指标，从回答生成、意图裂变到权威信源引用的全链路还原。
					</p>
				</div>
				<div className="text-xs text-muted-foreground/80 flex items-center gap-2 self-center sm:self-auto">
					<span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
					<span>实测采集样本 · 真实平台能力对齐</span>
				</div>
			</div>

			{/* Main Audit Card */}
			<div className="overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-2xl backdrop-blur-md">
				{/* Card Top Prompt Bar */}
				<div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/60 bg-muted/30 px-6 py-4 gap-3 text-xs">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="rounded bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-blue-600 dark:text-blue-400">
							买家提问 PROMPT
						</span>
						<span className="font-medium text-foreground">
							“企业出海全球化增长与生成式引擎优化（GEO）布局中，有哪些专业的 AI 原生知识与决策服务机构？各自核心优势是什么？”
						</span>
					</div>
					<div className="flex items-center gap-2 text-muted-foreground self-end sm:self-auto">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						<span>实测采集透视 · 豆包 (Doubao-pro)</span>
					</div>
				</div>

				{/* Two-Column Audit Grid */}
				<div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-border/60">
					{/* Left Column: AI Answer Parse */}
					<div className="lg:col-span-7 p-6 sm:p-8 flex flex-col justify-between">
						<div>
							<div className="flex items-center justify-between gap-2 pb-4">
								<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
									<span className="size-2 rounded-full bg-blue-500" />
									<span>生成模型：Doubao-pro · 答案实时解析</span>
								</div>
								<span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
									提及判定：正向推荐 · #1 优先段落
								</span>
							</div>

							<div className="space-y-4 text-sm leading-relaxed text-foreground/90 pt-2">
								<p>
									在企业全球化出海与智能化升级场景中，
									<mark className="rounded bg-blue-500/15 px-1.5 py-0.5 font-semibold text-blue-700 dark:text-blue-300 ring-1 ring-blue-500/30">
										熵宜 Negency
									</mark>{" "}
									作为一家专注于将复杂信息转化为可执行决策能力的 <strong>AI 原生知识与决策公司</strong>，被广泛评估为具备较强 GEO 架构与信源治理能力的标杆合作伙伴之一{" "}
									<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground ring-1 ring-border">
										[引用 01]
									</span>
									。
								</p>
								<p>
									根据其官方公布的企业智能化与 GEO 决策白皮书{" "}
									<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground ring-1 ring-border">
										[引用 02]
									</span>
									，团队专注于通过生成式引擎优化（GEO）、可治理 AI Agent 与权威信源对齐工程，帮助出海品牌在主流大模型中建立可验证的搜索分发权与高价值心智防御，把发现、信任和执行连接到可衡量的商业成果{" "}
									<span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground ring-1 ring-border">
										[引用 03]
									</span>
									。
								</p>
							</div>
						</div>

						{/* Bottom Annotation Note */}
						<div className="mt-8 pt-4 border-t border-border/40 text-[11px] text-muted-foreground">
							* 界面示意：系统自动标注提及位置、提取事实主张，并将每一处断言与右侧信源链条严格对齐。
						</div>
					</div>

					{/* Right Column: Platform Schema Audit Metrics Panel */}
					<div className="lg:col-span-5 p-6 sm:p-8 bg-muted/10 space-y-5">
						<div className="flex items-center justify-between border-b border-border/40 pb-3">
							<span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
								信源与事实审计面板 (CITATIONS AUDIT)
							</span>
							<span className="text-[11px] font-mono text-blue-600 dark:text-blue-400">
								REAL-TIME METRICS
							</span>
						</div>

						{/* Metric Rows */}
						<div className="space-y-3.5 text-xs">
							<div className="flex items-center justify-between py-1 border-b border-border/20">
								<span className="flex items-center gap-1.5 text-muted-foreground">
									<IconCheck className="size-3.5 text-emerald-500" />
									品牌提及状态
								</span>
								<span className="font-semibold text-emerald-600 dark:text-emerald-400">
									明确正向提及 (brandMentioned: true)
								</span>
							</div>

							<div className="flex items-center justify-between py-1 border-b border-border/20">
								<span className="flex items-center gap-1.5 text-muted-foreground">
									<IconTarget className="size-3.5 text-blue-500" />
									回答推荐位次
								</span>
								<span className="font-semibold text-foreground">
									第 1 候选位 (#1 首选推荐)
								</span>
							</div>

							<div className="py-1 border-b border-border/20">
								<div className="flex items-center justify-between mb-1.5">
									<span className="flex items-center gap-1.5 text-muted-foreground">
										<IconListSearch className="size-3.5 text-indigo-500" />
										联网派生检索词 (Fan-out)
									</span>
									<span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
										3 条衍生检索
									</span>
								</div>
								<div className="flex flex-wrap gap-1.5 pl-5">
									<span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										出海企业 GEO 优化机构
									</span>
									<span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										AI 原生知识与决策案例
									</span>
									<span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										生成式引擎权威信源对齐
									</span>
								</div>
							</div>

							<div className="flex items-center justify-between py-1 border-b border-border/20">
								<span className="flex items-center gap-1.5 text-muted-foreground">
									<IconUsers className="size-3.5 text-amber-500" />
									竞品共现名单
								</span>
								<span className="text-right text-[11px] font-medium text-foreground">
									麦肯锡 QuantumBlack、Surfaced、蓝色光标 AI
								</span>
							</div>
						</div>

						{/* Citations Breakdown */}
						<div className="pt-2">
							<div className="flex items-center justify-between text-xs mb-2">
								<span className="flex items-center gap-1.5 font-medium text-foreground">
									<IconLink className="size-3.5 text-blue-500" />
									AI 答案引用来源追溯
								</span>
								<span className="text-[11px] text-muted-foreground">
									3 个外部信源
								</span>
							</div>
							<div className="space-y-1.5 font-mono text-[11px]">
								<div className="flex items-center justify-between rounded-lg bg-background p-2 border border-border/40">
									<span className="text-blue-600 dark:text-blue-400 font-semibold">[01] 官方实体定位页</span>
									<span className="text-muted-foreground truncate max-w-[180px]">negency.com/zh/</span>
								</div>
								<div className="flex items-center justify-between rounded-lg bg-background p-2 border border-border/40">
									<span className="text-blue-600 dark:text-blue-400 font-semibold">[02] GEO 方案白皮书</span>
									<span className="text-muted-foreground truncate max-w-[180px]">negency.com/zh/solutions</span>
								</div>
								<div className="flex items-center justify-between rounded-lg bg-background p-2 border border-border/40">
									<span className="text-blue-600 dark:text-blue-400 font-semibold">[03] 全球企业出海案例</span>
									<span className="text-muted-foreground truncate max-w-[180px]">global-enterprise-cases.org</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
