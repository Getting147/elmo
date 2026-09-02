import { createFileRoute } from "@tanstack/react-router";
import { useLanguage } from "@/lib/language-context";
import {
	IconDownload,
	IconFileText,
	IconExternalLink,
	IconSparkles,
	IconCheck,
} from "@tabler/icons-react";

export const Route = createFileRoute("/_authed/reports/")({
	component: DiagnosticReportsPageComponent,
});

function DiagnosticReportsPageComponent() {
	const { t, language, setLanguage } = useLanguage();
	const pdfUrl = "/report.pdf";

	const chapters = [
		{ num: 1, title: t.ch1, desc: "大数字指标卡 (61.67% 可见度, P75+ 分位), SOV 58.33%, 引用有效率 88.24% 与关键发现" },
		{ num: 2, title: t.ch2, desc: "AI 引擎对产品品类与子类的分类感知定位、置信度矩阵" },
		{ num: 3, title: t.ch3, desc: "ChatGPT vs ChatGPT Web 联网搜索模式逐平台样本覆盖与竞品差距" },
		{ num: 4, title: t.ch4, desc: "ComputerBild, TechAdvisor 等权威媒体信源分布与自域占比 (35%)" },
		{ num: 5, title: t.ch5, desc: "正负口碑标签提取 (相机硬件, 性价比 vs 保值率, 系统体验) 与 3 大归因主题" },
		{ num: 6, title: t.ch6, desc: "扫拖机器人与滑板车跨品类高意向决策词条缺席归因" },
		{ num: 7, title: t.ch7, desc: "Samsung (45%), Apple (32%), Huawei (23%) 声量份额矩阵对标" },
		{ num: 8, title: t.ch8, desc: "P0 / P1 / P2 结构化问题台账与证据链锁定" },
		{ num: 9, title: t.ch9, desc: "可落地的 GEO 分级优化执行清单与预期业务提升" },
	];

	return (
		<div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full min-h-screen bg-background text-foreground">
			{/* 顶部标题与操作栏 */}
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
				<div>
					<div className="flex items-center gap-2">
						<span className="p-2 bg-primary/10 text-primary rounded-lg">
							<IconFileText size={26} />
						</span>
						<h1 className="text-2xl font-bold tracking-tight">{t.reportsTitle}</h1>
					</div>
					<p className="text-muted-foreground text-sm mt-1">{t.reportsSubtitle}</p>
				</div>
				<div className="flex items-center gap-3">
					<button
						onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
						className="px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-accent transition-colors flex items-center gap-1.5 cursor-pointer"
					>
						🌐 {language === "zh" ? "English" : "中文"}
					</button>
					<a
						href={pdfUrl}
						target="_blank"
						rel="noopener noreferrer"
						download="GEO-Diagnostic-XIAOMI-20260828-zh.pdf"
						className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-md cursor-pointer"
					>
						<IconDownload size={18} />
						{t.downloadPdf}
					</a>
				</div>
			</div>

			{/* KPI 数据卡片 */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm">
					<div className="text-xs font-medium text-muted-foreground uppercase">{t.sampleStats}</div>
					<div className="text-3xl font-bold mt-2 text-primary">60 <span className="text-sm font-normal text-muted-foreground">Runs</span></div>
					<div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
						<IconCheck size={14} className="text-green-500" /> 通过 Q1-Q8 质量门禁
					</div>
				</div>

				<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm">
					<div className="text-xs font-medium text-muted-foreground uppercase">{t.overallVisibility}</div>
					<div className="text-3xl font-bold mt-2 text-primary">61.67%</div>
					<div className="text-xs text-green-600 font-medium mt-1">↑ 较同类出海竞品均值 +14.2%</div>
				</div>

				<div className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm">
					<div className="text-xs font-medium text-muted-foreground uppercase">{t.industryPercentile}</div>
					<div className="text-3xl font-bold mt-2 text-emerald-600">P75+</div>
					<div className="text-xs text-muted-foreground mt-1">处于同行业标杆领先区间</div>
				</div>
			</div>

			{/* 9 章节导览与在线概览 */}
			<div className="border rounded-xl bg-card p-6 shadow-sm">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold flex items-center gap-2">
						<IconSparkles size={20} className="text-primary" />
						{t.reportChapters}
					</h2>
					<span className="text-xs text-muted-foreground">标准 9 章顾问交付架构</span>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					{chapters.map((c) => (
						<div key={c.num} className="p-3.5 border rounded-lg hover:border-primary/50 transition-colors bg-muted/30">
							<div className="font-semibold text-sm text-foreground">{c.title}</div>
							<div className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.desc}</div>
						</div>
					))}
				</div>

				{/* 底部内嵌操作栏 */}
				<div className="mt-6 pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4">
					<div className="text-xs text-muted-foreground">
						报告编号：<code className="bg-muted px-1.5 py-0.5 rounded">GEO-XIAOMI-20260828-001</code> · 纯程序化计算 (零 Mock)
					</div>
					<div className="flex items-center gap-3">
						<a
							href={pdfUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
						>
							<IconExternalLink size={14} /> 在新标签页直接打开 552KB PDF
						</a>
					</div>
				</div>
			</div>
		</div>
	);
}
