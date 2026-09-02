/**
 * /app/$brand/reports — Real brand diagnostic reports (V2 GEO pipeline artifacts)
 *
 * Lists the 9-chapter diagnostic report files generated for THIS brand by the
 * server-side pipeline, with real meta/gate data from the report JSON. No
 * hardcoded demo numbers.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/lib/language-context";
import { useBrand } from "@/hooks/use-brands";
import { getBrandReports, type BrandReportSummary } from "@/server/report-files";
import { IconFileText, IconDownload, IconX, IconArrowLeft, IconRefresh } from "@tabler/icons-react";

export const Route = createFileRoute("/_authed/app/$brand/reports")({
	component: BrandReportsPageComponent,
});

const TXT: Record<string, Record<string, string>> = {
	zh: {
		title: "9 章诊断报告",
		subtitle: "基于真实多引擎采样生成的品牌 AI 可见度诊断报告",
		empty: "该品牌暂无诊断报告",
		emptyHint: "诊断报告由系统在完成采样与评估后自动生成，或由顾问在服务器端为品牌生成。完成采样后请稍后刷新。",
		generated: "生成时间",
		download: "下载 PDF",
		noPdf: "PDF 未同步",
		gates: "质量门禁",
		of: "/",
		passed: "通过",
		samples: "采样样本",
		window: "数据窗口",
		refresh: "刷新",
		back: "返回工作区",
	},
	en: {
		title: "9-Chapter Diagnostic Report",
		subtitle: "Brand AI visibility diagnostic report based on real multi-engine sampling",
		empty: "No diagnostic report for this brand yet",
		emptyHint:
			"Diagnostic reports are generated automatically after sampling completes, or generated on the server for the brand. Refresh after sampling finishes.",
		generated: "Generated",
		download: "Download PDF",
		noPdf: "PDF not synced",
		gates: "Quality Gates",
		of: "/",
		passed: "passed",
		samples: "Samples",
		window: "Window",
		refresh: "Refresh",
		back: "Back to workspace",
	},
};

function BrandReportsPageComponent() {
	const { language } = useLanguage();
	const t = TXT[language] || TXT.zh;
	const { brandId, brand } = useBrand();

	const { data: reports, isFetching, refetch } = useQuery({
		queryKey: ["brand-reports", brandId],
		queryFn: () => getBrandReports({ data: { brandId: brandId! } }),
		enabled: !!brandId,
		staleTime: 30_000,
	});

	const brandName = brand?.name || brandId || "";
	const list: BrandReportSummary[] = reports || [];

	return (
		<div className="flex flex-col gap-6 p-6 max-w-6xl mx-auto w-full min-h-screen bg-background text-foreground">
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-6">
				<div>
					<div className="flex items-center gap-3">
						<Link
							to="/app/$brand"
							params={{ brand: brandId! }}
							className="p-2 rounded-lg border hover:bg-accent transition-colors"
							aria-label={t.back}
						>
							<IconArrowLeft size={18} />
						</Link>
						<span className="p-2 bg-primary/10 text-primary rounded-lg">
							<IconFileText size={26} />
						</span>
						<div>
							<h1 className="text-2xl font-bold tracking-tight">
								{brandName} · {t.title}
							</h1>
							<p className="text-muted-foreground text-sm mt-0.5">{t.subtitle}</p>
						</div>
					</div>
				</div>
				<button
					onClick={() => refetch()}
					disabled={isFetching}
					className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-md hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
				>
					<IconRefresh size={16} />
					{t.refresh}
				</button>
			</div>

			{isFetching && list.length === 0 ? (
				<div className="grid md:grid-cols-2 gap-4">
					{[0, 1].map((i) => (
						<div key={i} className="border rounded-xl p-5 animate-pulse h-44 bg-muted/40" />
					))}
				</div>
			) : list.length === 0 ? (
				<div className="border rounded-xl p-10 text-center bg-muted/20">
					<div className="text-4xl mb-3 text-muted-foreground">
						<IconFileText className="mx-auto" size={40} />
					</div>
					<h2 className="text-lg font-semibold">{t.empty}</h2>
					<p className="text-sm text-muted-foreground mt-2 max-w-lg mx-auto">{t.emptyHint}</p>
				</div>
			) : (
				<div className="grid md:grid-cols-2 gap-4">
					{list.map((r) => (
						<div key={r.file} className="border rounded-xl p-5 bg-card text-card-foreground shadow-sm flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
									{r.clientCode} · {new Date(r.generatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
								</div>
								<span
									className={`text-xs px-2 py-0.5 rounded-full font-medium ${
										r.gatesPassed >= r.gatesTotal && r.gatesTotal > 0
											? "bg-green-100 text-green-700"
											: r.gatesPassed >= Math.ceil((r.gatesTotal * 6) / 8)
												? "bg-amber-100 text-amber-700"
												: "bg-red-100 text-red-700"
									}`}
								>
									{t.gates} {r.gatesPassed}
									{t.of}
									{r.gatesTotal} {t.passed}
								</span>
							</div>
							<div className="grid grid-cols-2 gap-2 text-sm">
								<div className="text-muted-foreground">{t.samples}</div>
								<div className="font-semibold text-right">{r.meta.totalSamples ?? "—"}</div>
								<div className="text-muted-foreground">{t.window}</div>
								<div className="font-semibold text-right">
									{r.meta.startDate && r.meta.endDate
										? `${r.meta.startDate} ~ ${r.meta.endDate}`
										: "—"}
								</div>
							</div>
							{r.pdfUrl ? (
								<a
									href={r.pdfUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-md cursor-pointer"
								>
									<IconDownload size={16} />
									{t.download}
								</a>
							) : (
								<div className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-muted text-muted-foreground">
									<IconX size={16} />
									{t.noPdf}
								</div>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
