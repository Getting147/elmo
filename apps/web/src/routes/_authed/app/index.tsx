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
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import FullPageCard from "@/components/full-page-card";
import { listUserOrganizations, requireAuthSession, type UserOrgEntry } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
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
	const [mounted, setMounted] = useState(false);
	const [orgs, setOrgs] = useState<OrgEntry[]>([]);
	const [deleteTarget, setDeleteTarget] = useState<OrgEntry | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState("");
	const { organizations, canCreateBrands } = Route.useLoaderData();

	useEffect(() => {
		setMounted(true);
		setOrgs(organizations);
	}, [organizations]);

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
		<FullPageCard title="Brand Switcher" subtitle="Select a brand to get started">
			<div className="flex flex-col space-y-3 min-w-[200px]">
				{orgs.length > 0 ? (
					orgs.map((org) => {
						const targetKey = org.brandId || org.id;
						return (
							<div key={targetKey} className="flex items-center gap-2">
								<Button asChild variant="secondary" className="flex-1">
									<Link to="/app/$brand" params={{ brand: targetKey }}>
										{org.brandName || org.name}
									</Link>
								</Button>
								{org.hasBrand !== false && (
									<Button
										variant="ghost"
										size="icon"
										className="shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
										aria-label={`Delete ${org.brandName || org.name}`}
										title="Delete project"
										onClick={() => {
											setDeleteError("");
											setDeleteTarget(org);
										}}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								)}
							</div>
						);
					})
				) : (
					<p className="text-muted-foreground text-center">No brands available</p>
				)}
				{canCreateBrands && (
					<Button asChild variant="outline">
						<Link to="/app/new">+ Create new brand</Link>
					</Button>
				)}
			</div>

			<Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete &quot;{deleteTarget?.brandName || deleteTarget?.name}&quot;?</DialogTitle>
						<DialogDescription>
							Deleting a project stops automatic sampling and hides it from all pages. Historical data is kept and can
							be restored by an admin.
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
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="cursor-pointer">
							{isDeleting ? "Deleting..." : "Delete Project"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</FullPageCard>
	);
}
