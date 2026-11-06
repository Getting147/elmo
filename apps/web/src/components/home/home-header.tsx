import { IconSun, IconMoon, IconExternalLink } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";

interface HomeHeaderProps {
	theme: "dark" | "light";
	onToggleTheme: () => void;
	onOpenLogin: () => void;
}

export function HomeHeader({ theme, onToggleTheme, onOpenLogin }: HomeHeaderProps) {
	return (
		<header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
			<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
				{/* Brand Mark */}
				<div className="flex items-center gap-3">
					<div className="flex size-9 items-center justify-center rounded-xl bg-blue-600/10 text-blue-500 ring-1 ring-blue-500/20 shadow-sm">
						<svg viewBox="0 0 24 24" fill="none" className="size-5">
							<path
								d="M12 2L2 7L12 12L22 7L12 2Z"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							<path
								d="M2 17L12 22L22 17"
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
					<div className="flex items-baseline gap-2">
						<span className="text-base font-bold tracking-tight text-foreground">
							熵宜 Negency
						</span>
						<span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-500 ring-1 ring-blue-500/20">
							GEO
						</span>
					</div>
				</div>

				{/* Navigation Actions */}
				<div className="flex items-center gap-2 sm:gap-4">
					<a
						href="https://www.negency.com/zh/"
						target="_blank"
						rel="noopener noreferrer"
						className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md"
					>
						返回官网
						<IconExternalLink className="size-3.5 opacity-70" />
					</a>

					<Button
						variant="ghost"
						size="icon"
						onClick={onToggleTheme}
						className="size-9 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
						title={theme === "dark" ? "切换为日间模式" : "切换为夜间模式"}
					>
						{theme === "dark" ? (
							<IconSun className="size-4" />
						) : (
							<IconMoon className="size-4" />
						)}
					</Button>

					<Button
						variant="outline"
						size="sm"
						onClick={onOpenLogin}
						className="cursor-pointer font-medium text-xs sm:text-sm px-3 sm:px-4"
					>
						登录
					</Button>
				</div>
			</div>
		</header>
	);
}
