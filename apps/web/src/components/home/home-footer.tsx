import { IconExternalLink } from "@tabler/icons-react";

export function HomeFooter() {
	return (
		<footer className="border-t border-border/40 bg-background py-10 text-xs text-muted-foreground">
			<div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
				<div className="flex items-center gap-3">
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
					<span className="font-semibold text-foreground">
						熵宜 Negency GEO 监测平台
					</span>
				</div>

				<div className="flex items-center gap-6">
					<a
						href="https://www.negency.com/zh/"
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
					>
						访问 Negency 官网
						<IconExternalLink className="size-3" />
					</a>
					<a
						href="https://www.negency.com/zh/solutions"
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
					>
						解决方案
						<IconExternalLink className="size-3" />
					</a>
				</div>

				<div>
					© 2026 Negency GEO. All rights reserved. 赋能品牌在生成式 AI 时代保持可见与权威。
				</div>
			</div>
		</footer>
	);
}
