import * as React from "react";
import { Link, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import {
	IconDashboard,
	IconChartBar,
	IconSpeakerphone,
	IconSitemap,
	IconTarget,
	IconLink,
	IconBuilding,
	IconPackage,
	IconBuildings,
	IconListDetails,
	IconCpu,
	IconTable,
	IconReport,
	IconTimeline,
	IconTool,
	IconUsers,
	IconFileText,
} from "@tabler/icons-react";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@workspace/ui/components/sidebar";
import { NavMain, type NavGroup } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { NavAppInfo } from "@/components/nav-app-info";
import { DemoModePill } from "@/components/demo-mode-pill";
import { Logo } from "@/components/logo";
import { useLanguage } from "@/lib/language-context";
import type { BrandWithPrompts } from "@workspace/lib/db/schema";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	isAdmin?: boolean;
	hasReportAccess?: boolean;
	/** When true, only show admin section (no brand-specific nav) */
	adminOnly?: boolean;
	/** Brand data from route loader — avoids a separate client-side fetch */
	brand?: BrandWithPrompts | null;
}

function SidebarBrandIcon() {
	return (
		<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm">
			<svg className="size-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
				<circle cx="12" cy="12" r="9" />
				<path d="M12 3a9 9 0 0 1 9 9" />
				<circle cx="12" cy="12" r="3" />
			</svg>
		</div>
	);
}

function SafeLanguageSwitcher() {
	const [mounted, setMounted] = React.useState(false);
	const { t, language, setLanguage } = useLanguage();

	React.useEffect(() => {
		setMounted(true);
	}, []);

	if (!mounted) {
		return (
			<div className="px-2 py-1 flex items-center justify-between border-t pt-2 opacity-0">
				<span className="text-[11px]">...</span>
			</div>
		);
	}

	return (
		<div className="px-2 py-1 flex items-center justify-between border-t pt-2">
			<span className="text-[11px] text-muted-foreground">{t?.currentLang || "简体中文"}</span>
			<button
				onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
				className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
			>
				{t?.switchLang || "切换为 English"}
			</button>
		</div>
	);
}

export function AppSidebar({
	isAdmin = false,
	hasReportAccess = false,
	adminOnly = false,
	brand,
	...props
}: AppSidebarProps) {
	const { setOpenMobile } = useSidebar();
	const { t, language, setLanguage } = useLanguage();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const reportsEnabled = true;

	const showAdminSection = isAdmin || hasReportAccess;

	const groups: NavGroup[] = [];

	// Dashboard section
	if (!adminOnly) {
		const dashboardItems = [
			{
				title: t?.overview || "概览总览",
				url: "/",
				icon: IconDashboard,
			},
		];

		if (brand?.onboarded) {
			dashboardItems.push(
				{
					title: t?.visibility || "AI 可见度",
					url: "/visibility",
					icon: IconChartBar,
				},
				{
					title: t?.shareOfVoice || "声量份额（SOV）",
					url: "/share-of-voice",
					icon: IconSpeakerphone,
				},
				{
					title: t?.queryFanOut || "联网检索发散",
					url: "/query-fan-out",
					icon: IconSitemap,
				},
				{
					title: t?.citations || "信源引用分析",
					url: "/citations",
					icon: IconLink,
				},
				{
					title: t?.opportunities || "增长机会地图",
					url: "/opportunities",
					icon: IconTarget,
				},
				{
					title: t?.diagnosticReports || "9章诊断报告",
					url: "/reports",
					icon: IconFileText,
				},
			);
		}

		groups.push({
			label: t?.dashboard || "数据看板",
			items: dashboardItems,
		});

		if (brand?.onboarded) {
			groups.push({
				label: t?.settings || "配置管理",
				items: [
					{
						title: t?.brandSettings || "品牌档案",
						url: "/settings/brand",
						icon: IconBuilding,
					},
					{
						title: t?.profileSettings || "产品线与背书",
						url: "/settings/profile",
						icon: IconPackage,
					},
					{
						title: t?.competitorSettings || "竞品对标",
						url: "/settings/competitors",
						icon: IconBuildings,
					},
					{
						title: t?.promptSettings || "提示词库",
						url: "/settings/prompts",
						icon: IconListDetails,
					},
					{
						title: t?.llmSettings || "AI 引擎配置",
						url: "/settings/llms",
						icon: IconCpu,
					},
					{
						title: t?.memberSettings || "成员权限",
						url: "/settings/members",
						icon: IconUsers,
					},
				],
			});
		}
	}

	if (showAdminSection) {
		const adminItems = [];

		if (isAdmin) {
			adminItems.push(
				{
					title: "Workflows",
					url: "/admin/workflows",
					icon: IconTimeline,
				},
				{
					title: "Tools",
					url: "/admin/tools",
					icon: IconTool,
				},
				{
					title: "Prompts DB",
					url: "/admin",
					icon: IconTable,
				},
			);
		}

		groups.push({
			label: "Admin",
			items: adminItems,
		});
	}

	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton size="lg" asChild>
							<Link to="/app">
								<SidebarBrandIcon />
								<div className="grid flex-1 text-left text-sm leading-tight overflow-hidden pl-1">
									<span className="truncate font-semibold text-foreground text-[14px]">
										{brand?.name || "NegencyGEO"}
									</span>
									<span className="truncate text-[11px] text-muted-foreground">
										AI Search Optimizer
									</span>
								</div>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain groups={groups} />
			</SidebarContent>
			<SidebarFooter className="gap-2">
				{/* 语言一键切换快捷按钮 */}
				<SafeLanguageSwitcher />
				<DemoModePill />
				<NavAppInfo />
				<NavUser />
			</SidebarFooter>
		</Sidebar>
	);
}
