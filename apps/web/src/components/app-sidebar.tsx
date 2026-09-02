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
					title: t?.shareOfVoice || "声量份额 (SOV)",
					url: "/share-of-voice",
					icon: IconSpeakerphone,
				},
				{
					title: t?.queryFanOut || "Query 联网检索",
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
					title: t?.diagnosticReports || "📄 9章诊断报告",
					url: "/reports",
					icon: IconFileText,
					absolute: true,
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
								<Logo className="size-8" />
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-semibold">{brand?.name || "NegencyGEO"}</span>
									<span className="truncate text-xs text-muted-foreground">AI Search Optimizer</span>
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
				<div className="px-2 py-1 flex items-center justify-between border-t pt-2">
					<span className="text-[11px] text-muted-foreground">{t?.currentLang || "简体中文"}</span>
					<button
						onClick={() => setLanguage(language === "zh" ? "en" : "zh")}
						className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
					>
						{t?.switchLang || "切换为 English"}
					</button>
				</div>
				<DemoModePill />
				<NavAppInfo />
				<NavUser />
			</SidebarFooter>
		</Sidebar>
	);
}
