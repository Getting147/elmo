import { useState } from "react";
import { IconArrowRight, IconSparkles, IconWorld, IconBuilding } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { validateWebsiteUrl } from "@/lib/brand-website";

interface HomeHeroProps {
	onStartDiagnosis: (brandName: string, website: string) => void;
	defaultBrandName?: string;
	defaultWebsite?: string;
}

export function HomeHero({
	onStartDiagnosis,
	defaultBrandName = "",
	defaultWebsite = "",
}: HomeHeroProps) {
	const [brandName, setBrandName] = useState(defaultBrandName);
	const [website, setWebsite] = useState(defaultWebsite);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);

		const trimmedName = brandName.trim();
		if (!trimmedName) {
			setError("请输入品牌名称");
			return;
		}
		if (trimmedName.length > 100) {
			setError("品牌名称不能超过 100 个字符");
			return;
		}

		const trimmedWebsite = website.trim();
		if (!trimmedWebsite) {
			setError("请输入品牌官网地址");
			return;
		}

		const validation = validateWebsiteUrl(trimmedWebsite);
		if (!validation.isValid) {
			setError("请输入有效的网站地址（如 negency.com 或 https://example.com）");
			return;
		}

		onStartDiagnosis(trimmedName, validation.formattedUrl);
	};

	return (
		<section className="relative overflow-hidden py-16 sm:py-24">
			{/* High-Tech Grid & Radar Ambient Background */}
			<div className="pointer-events-none absolute inset-0 overflow-hidden">
				{/* Fine Engineering Grid */}
				<div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.06)_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_35%,#000_55%,transparent_100%)]" />

				{/* Concentric Radar / Scanner Orbital Rings */}
				<div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 opacity-70 dark:opacity-80">
					{/* Inner subtle radar orbit */}
					<div className="size-[580px] rounded-full border border-blue-500/15 dark:border-blue-400/15 [mask-image:radial-gradient(ellipse_at_center,#000_40%,transparent_95%)]" />
					{/* Outer dashed orbital ring */}
					<div className="absolute inset-0 -m-[130px] size-[840px] rounded-full border border-dashed border-indigo-500/10 dark:border-indigo-400/15 [mask-image:radial-gradient(ellipse_at_center,#000_50%,transparent_90%)]" />
				</div>

				{/* Precision Crosshair Coordinate Marks in Negative Space */}
				<div className="hidden lg:flex items-center gap-1.5 absolute left-[8%] top-[32%] text-[10px] font-mono text-muted-foreground/40 select-none">
					<span className="text-blue-500/60">+</span>
					<span>GEO-RADAR // ACTIVE</span>
				</div>
				<div className="hidden lg:flex items-center gap-1.5 absolute right-[8%] top-[32%] text-[10px] font-mono text-muted-foreground/40 select-none">
					<span>AUDIT-GRID // 48PX</span>
					<span className="text-blue-500/60">+</span>
				</div>
				<div className="hidden xl:block absolute left-[6%] top-[58%] text-[10px] font-mono text-muted-foreground/30 select-none">
					+ —— +
				</div>
				<div className="hidden xl:block absolute right-[6%] top-[58%] text-[10px] font-mono text-muted-foreground/30 select-none">
					+ —— +
				</div>

				{/* Ambient Ambient Glows */}
				<div className="absolute left-1/2 top-[32%] -translate-x-1/2 -translate-y-1/2">
					<div className="size-[560px] rounded-full bg-blue-500/10 dark:bg-blue-600/15 blur-3xl" />
					<div className="size-[380px] -translate-x-36 translate-y-16 rounded-full bg-indigo-500/10 dark:bg-indigo-600/10 blur-3xl" />
				</div>
			</div>

			<div className="relative mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
				{/* Top Tag */}
				<div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/5 px-3.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400">
					<IconSparkles className="size-3.5" />
					<span>新一代生成式引擎优化 · GENERATIVE ENGINE OPTIMIZATION</span>
				</div>

				{/* Main Headline */}
				<h1 className="mt-6 text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl sm:leading-tight">
					让 AI 在每一个高价值问答中，
					<br className="hidden sm:inline" />
					<span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500 bg-clip-text text-transparent">
						优先推荐你的品牌
					</span>
				</h1>

				{/* Subtitle */}
				<p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg sm:leading-relaxed">
					穿透豆包、DeepSeek 等主流生成式引擎，实时审计信源引用、推荐位次与竞品共现，建立可验证的品牌 AI 资产防御体系。
				</p>

				{/* Interactive Diagnosis Form Card */}
				<div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-border/80 bg-card/80 p-4 shadow-xl backdrop-blur-md sm:p-6 text-left">
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							{/* Brand Name Input */}
							<div className="space-y-1.5">
								<label
									htmlFor="hero-brand-name"
									className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80"
								>
									<IconBuilding className="size-3.5 text-muted-foreground" />
									品牌名称
								</label>
								<Input
									id="hero-brand-name"
									type="text"
									value={brandName}
									onChange={(e) => {
										setBrandName(e.target.value);
										if (error) setError(null);
									}}
									placeholder="例如：熵宜 Negency"
									className="h-11 bg-background text-sm"
									autoComplete="organization"
								/>
							</div>

							{/* Website Input */}
							<div className="space-y-1.5">
								<label
									htmlFor="hero-website"
									className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80"
								>
									<IconWorld className="size-3.5 text-muted-foreground" />
									品牌官网
								</label>
								<Input
									id="hero-website"
									type="text"
									value={website}
									onChange={(e) => {
										setWebsite(e.target.value);
										if (error) setError(null);
									}}
									placeholder="例如：https://www.negency.com/zh/"
									className="h-11 bg-background text-sm"
									autoComplete="url"
								/>
							</div>
						</div>

						{/* Validation Error Feedback */}
						{error && (
							<div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
								{error}
							</div>
						)}

						{/* Action Button */}
						<Button
							type="submit"
							size="lg"
							className="h-12 w-full gap-2 text-sm font-semibold shadow-md cursor-pointer transition-all hover:shadow-lg"
						>
							<span>开始品牌 AI 表现诊断</span>
							<IconArrowRight className="size-4" />
						</Button>

						{/* Hint & Guarantees */}
						<div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-2 text-[11px] text-muted-foreground">
							<span className="flex items-center gap-1">
								<span className="size-1.5 rounded-full bg-emerald-500" />
								支持保留多语言及二级路径（如 /zh），作为主权威信源基准
							</span>
							<span className="opacity-80">
								点击后进入登录接续 · 资料自动预填
							</span>
						</div>
					</form>
				</div>

				{/* Engine Support Badges */}
				<div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground/80">
					<span className="font-medium text-foreground/60">实测审计覆盖引擎：</span>
					<span className="flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-blue-500" />
						字节跳动 · 豆包 (Doubao)
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-indigo-500" />
						深度求索 · DeepSeek
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-cyan-500" />
						智谱清言 · GLM
					</span>
					<span className="flex items-center gap-1.5">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						百川智能 · Baichuan
					</span>
				</div>
			</div>
		</section>
	);
}
