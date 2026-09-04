/// <reference types="vite/client" />
import { useEffect } from "react";
import { HeadContent, Outlet, ScriptOnce, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { NotFound } from "@/router-default-components";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { DEFAULT_APP_ICON, ELMO_THEME_COLOR } from "@workspace/config/constants";
import type { DeploymentMode } from "@workspace/config/types";
import type { MissingEnvVar } from "@workspace/config/env";
import { getClientConfig, getEnvValidationStateFn, type PublicClientConfig } from "@/server/config";
import MissingEnvPage from "@/components/missing-env-page";
import { usesWordmarkFont } from "@/components/logo";
import queryDevtools from "@/integrations/tanstack-query/devtools";
import { initPostHog } from "@/lib/posthog";
import { LanguageProvider } from "@/lib/language-context";
import appCss from "../styles.css?url";
import titanOneFont from "@fontsource/titan-one/files/titan-one-latin-400-normal.woff2?url";

interface RouterContext {
	queryClient: QueryClient;
	clientConfig: PublicClientConfig;
	envValidation: {
		mode: DeploymentMode;
		missing: MissingEnvVar[];
		isValid: boolean;
	};
}

let cachedRootData: {
	clientConfig: PublicClientConfig;
	envValidation: { mode: DeploymentMode; missing: MissingEnvVar[]; isValid: boolean };
} | null = typeof window === "undefined" ? null : null;

export const Route = createRootRouteWithContext<RouterContext>()({
	notFoundComponent: NotFound,
	beforeLoad: async () => {
		if (cachedRootData) return cachedRootData;
		const [clientConfig, envValidation] = await Promise.all([getClientConfig(), getEnvValidationStateFn()]);
		cachedRootData = { clientConfig, envValidation };
		return cachedRootData;
	},
	head: ({ match }) => {
		const branding = match.context?.clientConfig?.branding;
		const analytics = match.context?.clientConfig?.analytics;
		const scripts: { src: string; defer?: boolean; async?: boolean; "data-domain"?: string; "data-api"?: string }[] = [
			{
				src: "/i18n-global.js",
				defer: true,
			}
		];
		if (analytics?.clarityProjectId) {
			scripts.push({
				src: `https://www.clarity.ms/tag/${analytics.clarityProjectId}`,
				async: true,
			});
		}
		if (analytics?.plausibleDomain) {
			scripts.push({
				src: "/api/plausible/js/script",
				defer: true,
				"data-domain": analytics.plausibleDomain,
				"data-api": "/api/plausible/event",
			});
		}

		const hasCustomIcon = Boolean(branding?.icon && branding.icon !== DEFAULT_APP_ICON);
		const appName = branding?.name || "NegencyGEO-Monitor";
		const themeColor = hasCustomIcon ? "#000000" : ELMO_THEME_COLOR;
		const appUrl = branding?.url ? branding.url.replace(/\/$/, "") : undefined;

		const title = `${appName} - AI Search Optimization`;
		const description = "Track and optimize your brand's visibility across AI models.";
		const ogImageParams = new URLSearchParams({ description });
		const ogImagePath = `/api/og?${ogImageParams.toString()}`;
		const ogImage = appUrl ? `${appUrl}${ogImagePath}` : ogImagePath;
		const ogLogo = (() => {
			if (!branding?.icon) return undefined;
			if (branding.icon.startsWith("http")) return branding.icon;
			return appUrl ? `${appUrl}${branding.icon}` : undefined;
		})();

		return {
			meta: [
				{ title },
				{ name: "description", content: description },
				{ charSet: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
				{ name: "theme-color", content: themeColor },
				{ name: "apple-mobile-web-app-title", content: appName },
				{ property: "og:site_name", content: appName },
				{ property: "og:locale", content: "en_US" },
				{ property: "og:title", content: title },
				{ property: "og:description", content: description },
				{ property: "og:image", content: ogImage },
				{ property: "og:image:width", content: "1200" },
				{ property: "og:image:height", content: "630" },
				{ property: "og:type", content: "website" },
				...(appUrl ? [{ property: "og:url", content: appUrl }] : []),
				...(ogLogo ? [{ property: "og:logo", content: ogLogo }] : []),
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: title },
				{ name: "twitter:description", content: description },
				{ name: "twitter:image", content: ogImage },
			],
			links: [
				...(usesWordmarkFont(branding)
					? [
							{
								rel: "preload",
								as: "font",
								type: "font/woff2",
								href: titanOneFont,
								crossOrigin: "anonymous" as const,
							},
						]
					: []),
				{ rel: "stylesheet", href: appCss },
				{ rel: "manifest", href: "/api/manifest" },
				...(hasCustomIcon && branding?.icon
					? [
							{ rel: "icon", type: "image/png", href: branding.icon },
							{ rel: "apple-touch-icon", href: branding.icon },
						]
					: [
							{ rel: "icon", type: "image/svg+xml", href: "/icons/elmo-icon.svg" },
							{ rel: "icon", type: "image/png", sizes: "96x96", href: "/icons/elmo-icon-96.png" },
							{ rel: "icon", type: "image/x-icon", href: "/icons/favicon.ico" },
							{ rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
						]),
			],
			scripts,
		};
	},
	component: RootComponent,
});

function RootComponent() {
	const { envValidation, clientConfig } = Route.useRouteContext();
	const clarityProjectId = clientConfig?.analytics?.clarityProjectId;

	useEffect(() => {
		const key = clientConfig?.analytics?.posthogKey;
		if (key) initPostHog(key);
	}, [clientConfig?.analytics?.posthogKey]);

	const clarityQueueScript = `window.clarity=window.clarity||function(){(window.clarity.q=window.clarity.q||[]).push(arguments)};`;

	if (!envValidation.isValid) {
		return (
			<html lang="en">
				<head>
					<HeadContent />
				</head>
				<body className="font-sans antialiased">
					<MissingEnvPage mode={envValidation.mode} missing={envValidation.missing} />
					<Scripts />
				</body>
			</html>
		);
	}

	return (
		<html lang="en">
			<head>
				{clarityProjectId && <ScriptOnce>{clarityQueueScript}</ScriptOnce>}
				{/* i18n-global: 组件级注入（TanStack head scripts 在 SSR 构建中不输出，实测丢失）。
				    ?v= 为缓存破坏版本号——每次更新 public/i18n-global.js 必须同步 +1，否则浏览器缓存旧词表 */ }
				<script src="/i18n-global.js?v=3" defer />
				<HeadContent />
			</head>
			<body className="font-sans antialiased">
				<LanguageProvider>
					<Outlet />
				</LanguageProvider>
				<TanStackDevtools plugins={[queryDevtools]} />
				<Scripts />
			</body>
		</html>
	);
}
