/**
 * /app/new - Create a new brand (local mode only).
 */
import { useState, useEffect } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import FullPageCard from "@/components/full-page-card";
import { trackEvent } from "@/lib/posthog";
import { createBrandWithOrgFn } from "@/server/brands";
import { getDeployment } from "@/lib/config/server";

const getCanCreateBrands = createServerFn({ method: "GET" }).handler(async () => {
	return { canCreateBrands: getDeployment().features.canCreateBrands };
});

export const Route = createFileRoute("/_authed/app/new")({
	loader: async () => {
		const { canCreateBrands } = await getCanCreateBrands();
		if (!canCreateBrands) {
			throw redirect({ to: "/app" });
		}
		return { canCreateBrands };
	},
	component: NewBrandPage,
});

export function SafeHydrate({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);
	if (!mounted) return null;
	return <>{children}</>;
}

function NewBrandPage() {
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [brandName, setBrandName] = useState("");
	const [website, setWebsite] = useState("");
	const navigate = useNavigate();

	const handleFormSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!brandName.trim() || !website.trim()) {
			setError("Please fill in both brand name and website.");
			return;
		}

		setIsLoading(true);
		setError("");

		try {
			const formattedWebsite = website.startsWith("http") ? website : `https://${website}`;
			const result = await createBrandWithOrgFn({
				data: { brandName: brandName.trim(), website: formattedWebsite.trim() },
			});
			trackEvent("brand_created", { has_website: Boolean(formattedWebsite) });

			// 直接进行原生页面跳转到新品牌的看板
			window.location.href = `/app/${result.brandId}`;
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred while creating brand");
			setIsLoading(false);
		}
	};

	return (
		<SafeHydrate>
			<FullPageCard title="Create a new brand" subtitle="Set up a brand to start tracking">
			<form onSubmit={handleFormSubmit} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="brandName">Brand name</Label>
					<Input
						id="brandName"
						name="brandName"
						type="text"
						value={brandName}
						onChange={(e) => setBrandName(e.target.value)}
						placeholder="Acme"
						required
						disabled={isLoading}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="website">Website</Label>
					<Input
						id="website"
						name="website"
						type="text"
						value={website}
						onChange={(e) => setWebsite(e.target.value)}
						placeholder="https://example.com"
						required
						disabled={isLoading}
					/>
				</div>

				{error && <p className="text-sm text-destructive font-medium">{error}</p>}

				<Button type="submit" className="w-full cursor-pointer" disabled={isLoading}>
					{isLoading ? "Creating..." : "Create brand"}
				</Button>
			</form>
		</FullPageCard>
		</SafeHydrate>
	);
}
