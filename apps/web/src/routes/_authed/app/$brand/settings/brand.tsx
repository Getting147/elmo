/**
 * /app/$brand/settings/brand - Brand settings page
 *
 * Form to edit brand name, website, additional domains, and aliases.
 */
import { useState, useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useBrand } from "@/hooks/use-brands";
import { deleteBrandFn, updateBrandFn } from "@/server/brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { TagsInput } from "@workspace/ui/components/tags-input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert";
import { AlertTriangle, Trash2 } from "lucide-react";
import { cleanAndValidateDomain } from "@/lib/domain-categories";

export const Route = createFileRoute("/_authed/app/$brand/settings/brand")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Brand Settings", { appName, brandName }) },
				{ name: "description", content: "Manage your brand name and website." },
			],
		};
	},
	component: BrandSettingsPage,
});

function BrandSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const queryClient = useQueryClient();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [additionalDomains, setAdditionalDomains] = useState<string[]>([]);
	const [aliases, setAliases] = useState<string[]>([]);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState("");

	useEffect(() => {
		if (brand) {
			setAdditionalDomains(brand.additionalDomains || []);
			setAliases(brand.aliases || []);
		}
	}, [brand?.updatedAt]);

	const validateDomain = useCallback((val: string): true | string => {
		const cleaned = cleanAndValidateDomain(val);
		if (!cleaned) return `"${val}" is not a valid domain`;
		return true;
	}, []);
	const handleAliasesChange = useCallback((values: string[]) => setAliases(values), []);

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	if (!brand) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-destructive">Brand not found</p>
				</div>
			</div>
		);
	}

	const handleDelete = async () => {
		setIsDeleting(true);
		setDeleteError("");
		try {
			await deleteBrandFn({ data: { brandId: brand.id } });
			queryClient.invalidateQueries();
			window.location.href = "/";
		} catch (err) {
			setDeleteError(err instanceof Error ? err.message : "An error occurred");
			setIsDeleting(false);
		}
	};

	const handleSubmit = async (formData: FormData) => {
		setIsSubmitting(true);
		setError("");
		setSuccess("");

		try {
			const name = formData.get("name") as string;
			const website = formData.get("website") as string;

			await updateBrandFn({
				data: {
					brandId: brand.id,
					name,
					website,
					additionalDomains,
					aliases,
				},
			});

			// Domain/alias changes affect citation categorization and mention detection
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

			setSuccess("Brand details updated successfully!");
			await revalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<div>
				<h1 className="text-3xl font-bold">Brand</h1>
				<p className="text-muted-foreground">Manage your brand name and website</p>
			</div>

			<form action={handleSubmit} className="space-y-6">
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">Brand Name</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder="Brand Name"
							defaultValue={brand.name}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Enter your brand&apos;s name</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="website">Website</Label>
						<Input
							id="website"
							name="website"
							type="text"
							placeholder="example.com"
							defaultValue={brand.website}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Your brand&apos;s primary website</p>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Additional Domains
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									Other domains your brand owns (e.g. blog.example.com, shop.example.com). Citations from these domains
									will be counted as your brand&apos;s citations. <strong>Updates retroactively</strong> &mdash;
									existing citations will be reclassified immediately.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={additionalDomains}
							onValueChange={setAdditionalDomains}
							placeholder="Add domain..."
							searchPlaceholder="Add domain..."
							maxItems={10}
							normalizeValue={(raw) => cleanAndValidateDomain(raw) ?? raw.trim()}
							onValidate={validateDomain}
						/>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Brand Aliases
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									Alternative names for your brand (sub-brands, product lines, abbreviations). Used for mention
									detection in <strong>future</strong> prompt runs only &mdash; does not apply retroactively to past
									results.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={aliases}
							onValueChange={handleAliasesChange}
							placeholder="Add alias..."
							searchPlaceholder="Add alias..."
							maxItems={10}
						/>
					</div>
				</div>

				{error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
				{success && <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md">{success}</div>}

				<div className="flex gap-2">
					<Button type="submit" disabled={isSubmitting} className="cursor-pointer">
						{isSubmitting ? "Saving..." : "Save Changes"}
					</Button>
				</div>
			</form>

			<div className="border-t pt-6">
				<Alert variant="destructive">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>Danger Zone</AlertTitle>
					<AlertDescription>
						Delete this project. It stops automatic sampling, hides the project from all
						lists, and blocks access. Historical data is kept and can be restored by an
						administrator.
					</AlertDescription>
				</Alert>
				<div className="mt-4">
					<Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
						<DialogTrigger asChild>
							<Button variant="destructive" className="cursor-pointer">
								<Trash2 className="h-4 w-4" />
								Delete Project
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Delete &quot;{brand.name}&quot;?</DialogTitle>
								<DialogDescription>
									This will stop automatic sampling and hide the project from all lists.
									Historical data (prompts, runs, citations, reports) is kept and can be
									restored by an administrator. This action can be undone by an administrator.
								</DialogDescription>
							</DialogHeader>
							{deleteError && (
								<div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{deleteError}</div>
							)}
							<DialogFooter>
								<Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting} className="cursor-pointer">
									Cancel
								</Button>
								<Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="cursor-pointer">
									{isDeleting ? "Deleting..." : "Delete Project"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</div>
		</div>
	);
}
