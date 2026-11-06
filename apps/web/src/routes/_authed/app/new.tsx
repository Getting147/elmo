/**
 * /app/new - Create a new brand with intent prefilling & multi-step roadmap.
 */
import { useState, useEffect } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	IconBuilding,
	IconWorld,
	IconCheck,
	IconArrowRight,
	IconShieldCheck,
	IconSparkles,
	IconClock,
} from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { trackEvent } from "@/lib/posthog";
import { createBrandWithOrgFn } from "@/server/brands";
import { getDeployment } from "@/lib/config/server";
import { validateWebsiteUrl } from "@/lib/brand-website";
import {
	getPendingBrandIntent,
	clearPendingBrandIntent,
} from "@/lib/pending-brand-intent";

const getCanCreateBrands = createServerFn({ method: "GET" }).handler(async () => {
	return { canCreateBrands: getDeployment().features.canCreateBrands };
});

export const Route = createFileRoute("/_authed/app/new")({
	loader: async () => {
		const { canCreateBrands } = await getCanCreateBrands();
		if (!canCreateBrands) {
			throw redirect({ to: "/app" });
		}
		return { canCreateBrands };
	},
	component: NewBrandPage,
});

export function SafeHydrate({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);
	if (!mounted) return null;
	return <>{children}</>;
}

function NewBrandPage() {
	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [brandName, setBrandName] = useState("");
	const [website, setWebsite] = useState("");
	const [hasPrefilled, setHasPrefilled] = useState(false);

	// Read pending intent on mount
	useEffect(() => {
		const intent = getPendingBrandIntent();
		if (intent) {
			if (intent.brandName) setBrandName(intent.brandName);
			if (intent.website) setWebsite(intent.website);
			setHasPrefilled(true);
		}
	}, []);

	const handleFormSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		const trimmedName = brandName.trim();
		if (!trimmedName) {
			setError("请输入品牌名称。");
			return;
		}
		if (trimmedName.length > 100) {
			setError("品牌名称不能超过 100 个字符。");
			return;
		}

		const trimmedWebsite = website.trim();
		if (!trimmedWebsite) {
			setError("请输入品牌官网。");
			return;
		}

		const validation = validateWebsiteUrl(trimmedWebsite);
		if (!validation.isValid) {
			setError("请输入有效的品牌官网地址（支持保留 /zh 等二级路径）。");
			return;
		}

		setIsLoading(true);

		try {
			const formattedWebsite = validation.formattedUrl;
			const result = await createBrandWithOrgFn({
				data: { brandName: trimmedName, website: formattedWebsite },
			});
			trackEvent("brand_created", { has_website: Boolean(formattedWebsite) });

			// Clear intent before navigation to prevent stale prefilling
			clearPendingBrandIntent();

			// Native page navigation to the newly created brand dashboard
			window.location.href = `/app/${result.brandId}`;
		} catch (err) {
			setError(err instanceof Error ? err.message : "创建品牌时发生异常，请重试");
			setIsLoading(false);
		}
	};

	const handleCancel = () => {
		clearPendingBrandIntent();
		navigate({ to: "/app" });
	};

	return (
		<SafeHydrate>
			<div className="min-h-screen bg-muted/20 py-8 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
				<div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border/80 bg-background shadow-xl">
					{/* Header */}
					<div className="border-b border-border/60 bg-muted/10 px-6 py-4 flex items-center justify-between">
						<div className="flex items-center gap-2.5">
							<div className="flex size-7 items-center justify-center rounded-lg bg-blue-600/10 text-blue-500 ring-1 ring-blue-500/20">
								<svg viewBox="0 0 24 24" fill="none" className="size-4">
									<path
										d="M12 2L2 7L12 12L22 7L12 2Z"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
									<path
										d="M2 17L12 22L2 17"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
									<path
										d="M2 12L12 17L22 12"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</div>
							<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								档案建档向导 · STEP 1 OF 3
							</span>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={handleCancel}
							className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
						>
							返回工作台
						</Button>
					</div>

					{/* 2-Column Split Content */}
					<div className="grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border/60">
						{/* Left Column: Prefilled Form */}
						<div className="md:col-span-7 p-6 sm:p-8">
							<h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
								创建新品牌档案
							</h1>
							<p className="mt-1 text-xs text-muted-foreground">
								确认品牌基本信息以初始化专属工作区与全引擎监测维度
							</p>

							{/* Prefill Callout Notice */}
							{hasPrefilled && (
								<div className="mt-4 flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3.5 text-xs text-blue-900 dark:text-blue-100">
									<IconCheck className="size-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
									<div className="leading-relaxed">
										<span className="font-semibold">已从首页带入待建资料：</span>
										系统已自动预填并规范化网址，您可以在此自由修改后再提交创建。
									</div>
								</div>
							)}

							<form onSubmit={handleFormSubmit} className="mt-6 space-y-4">
								{/* Brand Name Input */}
								<div className="space-y-1.5">
									<div className="flex items-center justify-between">
										<Label htmlFor="brandName" className="text-xs font-semibold flex items-center gap-1.5">
											<IconBuilding className="size-3.5 text-muted-foreground" />
											品牌名称 (Brand Name)
										</Label>
										{hasPrefilled && (
											<span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
												✓ 已预填
											</span>
										)}
									</div>
									<Input
										id="brandName"
										name="brandName"
										type="text"
										value={brandName}
										onChange={(e) => {
											setBrandName(e.target.value);
											if (error) setError("");
										}}
										placeholder="例如：熵宜 Negency"
										required
										disabled={isLoading}
										className="h-11 bg-background text-sm"
										autoFocus={!hasPrefilled}
									/>
									<p className="text-[11px] text-muted-foreground">
										支持中文、英文及空格，最大 100 字符。
									</p>
								</div>

								{/* Website Input */}
								<div className="space-y-1.5">
									<div className="flex items-center justify-between">
										<Label htmlFor="website" className="text-xs font-semibold flex items-center gap-1.5">
											<IconWorld className="size-3.5 text-muted-foreground" />
											品牌官网 (Website)
										</Label>
										<span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
											✓ 已保留多语言路径
										</span>
									</div>
									<Input
										id="website"
										name="website"
										type="text"
										value={website}
										onChange={(e) => {
											setWebsite(e.target.value);
											if (error) setError("");
										}}
										placeholder="例如：https://www.negency.com/zh/"
										required
										disabled={isLoading}
										className="h-11 bg-background text-sm font-mono text-xs sm:text-sm"
									/>
									<p className="text-[11px] text-muted-foreground">
										保留多语言及二级路径（如 /zh），作为主权威信源域名校验基准。
									</p>
								</div>

								{/* Error Callout */}
								{error && (
									<div className="rounded-lg bg-destructive/10 p-3 text-xs font-medium text-destructive">
										{error}
									</div>
								)}

								{/* Submit Button */}
								<Button
									type="submit"
									className="h-11 w-full gap-2 text-sm font-semibold cursor-pointer shadow-sm"
									disabled={isLoading}
								>
									{isLoading ? (
										<span>正在初始化工作空间...</span>
									) : (
										<>
											<span>创建品牌并进入监测配置向导</span>
											<IconArrowRight className="size-4" />
										</>
									)}
								</Button>

								{/* Cancel Option */}
								<div className="text-center pt-2">
									<button
										type="button"
										onClick={handleCancel}
										className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 cursor-pointer"
									>
										取消并返回首页
									</button>
								</div>
							</form>

							{/* Running & Billing Guarantees */}
							<div className="mt-6 rounded-xl border border-border/40 bg-muted/15 p-3 text-[11px] text-muted-foreground space-y-1">
								<div className="font-semibold text-foreground flex items-center gap-1">
									<IconShieldCheck className="size-3.5 text-emerald-500" />
									运行与计费保护
								</div>
								<p className="leading-relaxed">
									点击创建品牌仅建立当前工作区组织与基本记录（复用 createBrandWithOrgFn），不会自动触发官网网页深度爬取、Ark 豆包调用或后台报告生成。
								</p>
							</div>
						</div>

						{/* Right Column: Live Card Preview & Roadmap */}
						<div className="hidden md:flex md:col-span-5 flex-col justify-between p-6 sm:p-8 bg-muted/10">
							<div>
								<div className="flex items-center gap-2 mb-4">
									<IconSparkles className="size-4 text-blue-500" />
									<span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
										实时品牌名片预览
									</span>
								</div>

								{/* Live Preview Card */}
								<div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm space-y-3">
									<div className="flex items-center gap-3">
										<div className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-sm">
											{brandName.trim() ? brandName.trim().slice(0, 2).toUpperCase() : "NB"}
										</div>
										<div className="min-w-0 flex-1">
											<div className="font-bold text-foreground truncate text-sm">
												{brandName.trim() || "未命名品牌"}
											</div>
											<div className="font-mono text-[11px] text-muted-foreground truncate">
												{website.trim() || "https://example.com"}
											</div>
										</div>
									</div>
									<div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
										<span>工作区隔离：专属独立租户</span>
										<span className="text-emerald-500 font-medium">就绪</span>
									</div>
								</div>

								{/* 3-Step Onboarding Roadmap */}
								<div className="mt-8 space-y-3">
									<div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
										建档全流程路线图
									</div>

									<div className="space-y-3 text-xs">
										<div className="flex items-start gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5">
											<span className="flex size-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white shrink-0">
												1
											</span>
											<div>
												<div className="font-semibold text-blue-600 dark:text-blue-400">
													基础档案与权威信源
												</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													确定品牌名称、主域名与语言目录（当前进行中）
												</div>
											</div>
										</div>

										<div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-card/60 p-2.5 opacity-80">
											<span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground shrink-0">
												2
											</span>
											<div>
												<div className="font-semibold text-foreground">
													行业高价值提示词配置
												</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													定制购买意向、场景选型与对比评测题库
												</div>
											</div>
										</div>

										<div className="flex items-start gap-2.5 rounded-lg border border-border/40 bg-card/60 p-2.5 opacity-80">
											<span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground shrink-0">
												3
											</span>
											<div>
												<div className="font-semibold text-foreground">
													全引擎采样与首期审计
												</div>
												<div className="text-[11px] text-muted-foreground mt-0.5">
													多模型实测采集，生成信源穿透看板
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>

							<div className="pt-4 border-t border-border/40 text-[10px] text-muted-foreground/80 flex items-center gap-1.5">
								<IconClock className="size-3.5" />
								<span>平均初始化耗时约 30 秒 · 零外部付费调用</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</SafeHydrate>
	);
}
