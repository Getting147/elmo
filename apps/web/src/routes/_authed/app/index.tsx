/**
 * /app - Brand switcher page
 *
 * In single-org mode (local/demo): redirects to the default org
 * In multi-org mode (whitelabel): shows brand switcher
 *
 * Row-level delete (V1 soft delete): trash icon per brand removes it from the
 * list — 删除 = 隐藏 + 停扫 + 数据保留（Owner 2026-09-07 拍板）。
 */

import { useState, useEffect } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { syncAuth0UserById } from "@workspace/whitelabel/auth-hooks";
import FullPageCard from "@/components/full-page-card";
import { listUserOrganizations, requireAuthSession } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
import { deleteBrandFn } from "@/server/brands";

const getOrganizations = createServerFn({ method: "GET" }).handler(
	async (): Promise<{
		organizations: { id: string; name: string }[];
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

		// Single-org mode: redirect to the user's one org (created on signup).
		if (!result.supportsMultiOrg && result.organizations.length > 0) {
			throw redirect({ to: "/app/$brand", params: { brand: result.organizations[0].id } });
		}

		return result;
	},
	component: BrandSwitcherPage,
});

interface OrgEntry {
	id: string;
	name: string;
}

function BrandSwitcherPage() {
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
		try {
			await deleteBrandFn({ data: { brandId: deleteTarget.id } });
			// Soft delete: row disappears from the list immediately (data kept, recoverable).
			setOrgs((prev) => prev.filter((o) => o.id !== deleteTarget.id));
			setDeleteTarget(null);
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
					orgs.map((org) => (
						<div key={org.id} className="flex items-center gap-2">
							<Button asChild variant="secondary" className="flex-1">
								<Link to="/app/$brand" params={{ brand: org.id }}>
									{org.name}
								</Link>
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="shrink-0 text-muted-foreground hover:text-destructive cursor-pointer"
								aria-label={`Delete ${org.name}`}
								title="Delete project"
								onClick={() => {
									setDeleteError("");
									setDeleteTarget(org);
								}}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</div>
					))
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
						<DialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</DialogTitle>
						<DialogDescription>
							Deleting a project stops automatic sampling and hides it from all pages.
							Historical data is kept and can be restored by an admin.
						</DialogDescription>
					</DialogHeader>
					{deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="cursor-pointer">
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
