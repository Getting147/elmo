/**
 * /app - Brand switcher page
 *
 * In single-org mode (local/demo): redirects to the default org
 * In multi-org mode (whitelabel): shows brand switcher
 *
 * Row-level delete (V1 soft delete): trash icon per brand removes it from the
 * list — 删除 = 隐藏 + 停扫 + 数据保留（Owner 2026-09-07 拍板）。
 */

import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { syncAuth0UserById } from "@workspace/whitelabel/auth-hooks";
import { authClient } from "@workspace/lib/auth/client";
import { LogOut, Trash2 } from "lucide-react";
import { IconBuilding, IconChevronRight, IconPlus, IconShieldCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import FullPageCard from "@/components/full-page-card";
import { listUserOrganizations, requireAuthSession, type UserOrgEntry } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
import { useLanguage } from "@/lib/language-context";
import { clearPendingBrandIntent } from "@/lib/pending-brand-intent";
import { resetPostHog } from "@/lib/posthog";
import { deleteBrandFn } from "@/server/brands";

const getOrganizations = createServerFn({ method: "GET" }).handler(
	async (): Promise<{
		organizations: UserOrgEntry[];
		supportsMultiOrg: boolean;
		canCreateBrands: boolean;
	}> => {
		const session = await requireAuthSession();
		const deployment = getDeployment();

		if (deployment.mode === "whitelabel") {
			// Keep /app usable during Auth0 Management API incidents; background sync will reconcile memberships later.
			try {
				await syncAuth0UserById(session.user.id);
			} catch (error) {
				console.error("[auth0-sync] Failed to sync user on /app load; continuing with cached memberships", error);
			}
		}

		const organizations = await listUserOrganizations(session.user.id);
		return {
			organizations,
			supportsMultiOrg: deployment.features.supportsMultiOrg,
			canCreateBrands: deployment.features.canCreateBrands,
		};
	},
);

function OrgSwitcherSkeleton() {
	return (
		<FullPageCard title="" subtitle="">
			<div className="flex flex-col space-y-3 min-w-[200px]">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
		</FullPageCard>
	);
}

export const Route = createFileRoute("/_authed/app/")({
	pendingComponent: OrgSwitcherSkeleton,
	loader: async () => {
		const result = await getOrganizations();

		// Single-org mode: redirect to the user's one org/brand (E3-R01: 传递真实 brandId，保留组织归属).
		if (!result.supportsMultiOrg && result.organizations.length > 0) {
			const targetBrand = result.organizations[0].brandId || result.organizations[0].id;
			throw redirect({ to: "/app/$brand", params: { brand: targetBrand } });
		}

		return result;
	},
	component: BrandSwitcherPage,
});

interface OrgEntry {
	id: string;
	name: string;
	orgId?: string;
	brandId?: string;
	brandName?: string;
	hasBrand?: boolean;
}

function BrandSwitcherPage() {
	const router = useRouter();
	const { language } = useLanguage();
	const isZh = language === "zh";
	const [mounted, setMounted] = useState(false);
	const [orgs, setOrgs] = useState<OrgEntry[]>([]);
	const [deleteTarget, setDeleteTarget] = useState<OrgEntry | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState("");
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [logoutError, setLogoutError] = useState("");
	const { organizations, canCreateBrands } = Route.useLoaderData();

	useEffect(() => {
		setMounted(true);
		setOrgs(organizations);
	}, [organizations]);

	const handleLogout = async () => {
		if (isLoggingOut) return;
		setIsLoggingOut(true);
		setLogoutError("");
		try {
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => {
						clearPendingBrandIntent();
						resetPostHog();
						window.location.href = "/auth/logout";
					},
					onError: (ctx) => {
						setIsLoggingOut(false);
						setLogoutError(
							isZh
								? "退出登录失败，请重试"
								: ctx?.error?.message || "Failed to log out, please retry",
						);
					},
				},
			});
		} catch (err) {
			setIsLoggingOut(false);
			setLogoutError(isZh ? "退出登录失败，请重试" : "Failed to log out, please retry");
		}
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		setIsDeleting(true);
		setDeleteError("");
		const targetKey = deleteTarget.brandId || deleteTarget.id;
		try {
			await deleteBrandFn({ data: { brandId: targetKey } });
			// Soft delete: row disappears from the list immediately (data kept, recoverable).
			// B01: 按具体品牌标识定位过滤，避免同组织并存其他活跃品牌时被错误连带移除
			setOrgs((prev) => prev.filter((o) => (o.brandId || o.id) !== targetKey));
			setDeleteTarget(null);
			await router.invalidate();
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsDeleting(false);
		}
	};

	if (!mounted) return null;

	return (
		<div className="min-h-screen bg-muted/20 relative flex flex-col justify-center items-center p-4 sm:p-6 overflow-hidden">
			{/* Ambient glow backgrounds */}
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-40 dark:opacity-25">
				<div className="size-[500px] rounded-full bg-blue-500/10 blur-3xl" />
				<div className="size-[350px] -translate-x-32 translate-y-24 rounded-full bg-indigo-500/10 blur-3xl" />
			</div>

			<div className="relative w-full max-w-lg mx-auto">
				{/* Brand Top Header */}
				<div className="mb-6 text-center">
					<div className="inline-flex size-12 items-center justify-center rounded-2xl bg-blue-600/10 text-blue-500 ring-1 ring-blue-500/20 shadow-sm mb-3">
						<svg viewBox="0 0 24 24" fill="none" className="size-6">
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
					<h1 className="text-2xl font-bold tracking-tight text-foreground">
						{isZh ? "选择品牌工作台" : "Select Brand Workspace"}
					</h1>
					<p className="mt-1.5 text-xs text-muted-foreground">
						{isZh
							? "进入品牌专属 GEO 监测与信源审计大盘，或初始化新的监测维度"
							: "Access brand GEO monitoring dashboard or initialize a new brand"}
					</p>
				</div>

				{/* Main Card Container */}
				<div className="rounded-2xl border border-border/80 bg-card shadow-xl backdrop-blur-md overflow-hidden">
					<div className="p-6 sm:p-8 space-y-5">
						<div className="flex items-center justify-between border-b border-border/40 pb-3">
							<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
								<IconBuilding className="size-3.5" />
								{isZh ? "已有品牌档案" : "Available Brands"}
							</span>
							<span className="text-[11px] font-mono text-muted-foreground">
								{orgs.length} {isZh ? "个档案" : "brands"}
							</span>
						</div>

						{/* Brand Cards List */}
						<div className="space-y-2.5">
							{orgs.length > 0 ? (
								orgs.map((org) => {
									const targetKey = org.brandId || org.id;
									const displayName = org.brandName || org.name;
									const badgeText = displayName.slice(0, 2).toUpperCase();
									return (
										<div
											key={targetKey}
											className="group relative flex items-center justify-between rounded-xl border border-border/60 bg-background/80 p-3 sm:p-3.5 transition-all hover:border-blue-500/40 hover:bg-muted/30 hover:shadow-sm"
										>
											<Link
												to="/app/$brand"
												params={{ brand: targetKey }}
												className="flex items-center gap-3.5 flex-1 min-w-0 pr-2"
											>
												<div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-xs ring-1 ring-blue-500/20 shrink-0">
													{badgeText}
												</div>
												<div className="min-w-0 flex-1">
													<div className="font-semibold text-sm text-foreground group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
														{displayName}
													</div>
													<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
														<span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
														<span className="truncate">GEO 监测就绪 · 专属隔离空间</span>
													</div>
												</div>
												<IconChevronRight className="size-4 text-muted-foreground opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0" />
											</Link>

											{org.hasBrand !== false && (
												<Button
													variant="ghost"
													size="icon"
													className="size-8 shrink-0 text-muted-foreground hover:text-destructive cursor-pointer opacity-40 hover:opacity-100 transition-opacity ml-1"
													aria-label={`Delete ${displayName}`}
													title={isZh ? "删除品牌档案" : "Delete brand"}
													onClick={() => {
														setDeleteError("");
														setDeleteTarget(org);
													}}
												>
													<Trash2 className="size-3.5" />
												</Button>
											)}
										</div>
									);
								})
							) : (
								<div className="rounded-xl border border-dashed border-border/80 p-6 text-center text-xs text-muted-foreground">
									{isZh ? "当前组织暂无可用品牌档案" : "No brands available"}
								</div>
							)}
						</div>

						{/* Create Brand Button */}
						{canCreateBrands && (
							<Button
								asChild
								variant="outline"
								className="h-11 w-full gap-2 border-dashed border-border/80 hover:border-blue-500/60 hover:bg-blue-500/5 text-xs font-semibold cursor-pointer transition-all"
							>
								<Link to="/app/new">
									<IconPlus className="size-4 text-blue-500" />
									<span>{isZh ? "+ 创建新品牌档案" : "+ Create new brand"}</span>
								</Link>
							</Button>
						)}

						{/* Logout and Guarantees */}
						<div className="pt-4 border-t border-border/40 space-y-3">
							{logoutError && (
								<p
									className="text-xs text-destructive text-center font-medium"
									role="alert"
									data-testid="logout-error-message"
								>
									{logoutError}
								</p>
							)}
							<Button
								type="button"
								variant="ghost"
								className="h-9 w-full text-xs text-muted-foreground hover:text-foreground cursor-pointer flex items-center justify-center gap-2"
								onClick={handleLogout}
								disabled={isLoggingOut}
								data-testid="logout-button"
							>
								<LogOut className="size-3.5" />
								<span>
									{isLoggingOut
										? isZh
											? "正在退出…"
											: "Logging out…"
										: isZh
											? "退出登录"
											: "Log out"}
								</span>
							</Button>
						</div>
					</div>
				</div>

				{/* Bottom Security Note */}
				<div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
					<IconShieldCheck className="size-3.5 text-emerald-500" />
					<span>企业级多组织隔离 · 零跨租户数据串扰</span>
				</div>
			</div>

			{/* Delete Confirmation Dialog */}
			<Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{isZh
								? `确认删除品牌「${deleteTarget?.brandName || deleteTarget?.name}」？`
								: `Delete "${deleteTarget?.brandName || deleteTarget?.name}"?`}
						</DialogTitle>
						<DialogDescription>
							{isZh
								? "删除品牌将停止自动化监测采样并从列表中隐藏，历史数据妥善保留，仅管理员可恢复。"
								: "Deleting a project stops automatic sampling and hides it from all pages. Historical data is kept and can be restored by an admin."}
						</DialogDescription>
					</DialogHeader>
					{deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeleteTarget(null)}
							disabled={isDeleting}
							className="cursor-pointer"
						>
							{isZh ? "取消" : "Cancel"}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={isDeleting}
							className="cursor-pointer"
						>
							{isDeleting
								? isZh
									? "正在删除..."
									: "Deleting..."
								: isZh
									? "确认删除"
									: "Delete Brand"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
