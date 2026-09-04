/**
 * /app/$brand/settings/profile - Brand profile page (Epic A)
 *
 * US-A02 product lines (name/category/core params/differentiators/target audience)
 * US-A03 credentials (type/name/year/third-party-public flag)
 * US-A05 completeness bar (<60% amber warning)
 */
import { useState, useEffect, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useBrand } from "@/hooks/use-brands";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@workspace/ui/components/dialog";
import { Badge } from "@workspace/ui/components/badge";
import {
	getBrandProfileFn,
	createProductLineFn,
	updateProductLineFn,
	deleteProductLineFn,
	createCredentialFn,
	updateCredentialFn,
	deleteCredentialFn,
	getProfileCompletenessFn,
} from "@/server/profile";
import type { BrandProductLine, BrandCredential } from "@workspace/lib/db/schema";

export const Route = createFileRoute("/_authed/app/$brand/settings/profile")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Brand Profile", { appName, brandName }) },
				{ name: "description", content: "Product lines and credentials." },
			],
		};
	},
	component: BrandProfilePage,
});

const CRED_TYPE_LABELS: Record<string, string> = {
	certification: "Certification",
	patent: "Patent",
	award: "Award",
	membership: "Membership",
	case_study: "Customer Case Study",
	media: "Media Coverage",
};

const MISSING_LABELS: Record<string, string> = {
	brand: "brand profile",
	product_line: "product lines",
	credential: "third-party credentials",
};

interface ProfileData {
	productLines: BrandProductLine[];
	credentials: BrandCredential[];
}

function BrandProfilePage() {
	const { brand } = useBrand();
	const [profile, setProfile] = useState<ProfileData>({ productLines: [], credentials: [] });
	const [completeness, setCompleteness] = useState<{ overall: number; buckets: Record<string, number | null>; missing: string[] } | null>(null);
	const [loading, setLoading] = useState(true);

	// Product line editor state
	const [plEditor, setPlEditor] = useState<null | { id?: string; name: string; category: string; coreParams: string; differentiators: string; targetAudience: string }>(null);
	// Credential editor state
	const [crEditor, setCrEditor] = useState<null | { id?: string; credType: string; name: string; year: string; isThirdPartyPublic: boolean; url: string }>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		if (!brand) return;
		const [prof, comp] = await Promise.all([
			getBrandProfileFn({ data: { brandId: brand.id } }),
			getProfileCompletenessFn({ data: { brandId: brand.id } }),
		]);
		setProfile(prof);
		setCompleteness(comp);
		setLoading(false);
	}, [brand]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	if (loading || !brand) return <div className="p-6">Loading profile...</div>;

	const completenessPct = completeness?.overall ?? 0;
	const completenessColor = completenessPct >= 80 ? "bg-emerald-500" : completenessPct >= 60 ? "bg-amber-500" : "bg-red-500";

	const saveProductLine = async () => {
		if (!brand || !plEditor || !plEditor.name.trim() || !plEditor.differentiators.trim()) return;
		setBusy(true);
		try {
			const payload = {
				name: plEditor.name.trim(),
				category: plEditor.category || null,
				coreParams: plEditor.coreParams || null,
				differentiators: plEditor.differentiators.trim(),
				targetAudience: plEditor.targetAudience || null,
				position: 0,
			};
			if (plEditor.id)
				await updateProductLineFn({ data: { brandId: brand.id, productLineId: plEditor.id, ...payload } });
			else await createProductLineFn({ data: { brandId: brand.id, ...payload } });
			setPlEditor(null);
			await refresh();
		} finally {
			setBusy(false);
		}
	};

	const saveCredential = async () => {
		if (!brand || !crEditor || !crEditor.name.trim()) return;
		setBusy(true);
		try {
			const payload = {
				credType: crEditor.credType as never,
				name: crEditor.name.trim(),
				year: crEditor.year || null,
				isThirdPartyPublic: crEditor.isThirdPartyPublic,
				url: crEditor.url || null,
				position: 0,
			};
			if (crEditor.id)
				await updateCredentialFn({ data: { brandId: brand.id, credentialId: crEditor.id, ...payload } });
			else await createCredentialFn({ data: { brandId: brand.id, ...payload } });
			setCrEditor(null);
			await refresh();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-3xl font-bold">Brand Profile</h1>
				<p className="text-muted-foreground">
					Product lines (differentiators = fact-check ground truth) and credentials (third-party-public flag).
				</p>
			</div>

			{/* Completeness bar (US-A05) */}
			<div className="rounded-lg border p-4">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">Profile completeness</span>
					<span className="text-sm font-bold">{completenessPct}%</span>
				</div>
				<div className="mt-2 h-2 w-full rounded-full bg-muted">
					<div className={`h-2 rounded-full ${completenessColor}`} style={{ width: `${completenessPct}%` }} />
				</div>
				{completenessPct < 60 && (
					<p className="mt-2 text-sm text-amber-600">
						Profile completeness below 60% — reports will note limited fact-check confidence. Missing:{" "}
						{((completeness?.missing ?? []).map((m) => MISSING_LABELS[m] ?? m).join(", ")) || "n/a"}
					</p>
				)}
			</div>

			{/* Product lines (US-A02) */}
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-xl font-semibold">Product Lines</h2>
					<Button size="sm" onClick={() => setPlEditor({ name: "", category: "", coreParams: "", differentiators: "", targetAudience: "" })}>
						+ Add Product Line
					</Button>
				</div>
				{profile.productLines.length === 0 && (
					<p className="text-sm text-muted-foreground">No product lines yet — add your core product lines with their differentiators.</p>
				)}
				{profile.productLines.map((pl) => (
					<div key={pl.id} className="flex items-start justify-between rounded-lg border p-3">
						<div>
							<div className="font-medium">{pl.name}</div>
							{pl.category && <div className="text-xs text-muted-foreground">{pl.category}</div>}
							{pl.differentiators && <div className="mt-1 text-sm">{pl.differentiators}</div>}
							{pl.targetAudience && <div className="mt-1 text-xs text-muted-foreground">Target: {pl.targetAudience}</div>}
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									setPlEditor({
										id: pl.id,
										name: pl.name,
										category: pl.category ?? "",
										coreParams: pl.coreParams ?? "",
										differentiators: pl.differentiators,
										targetAudience: pl.targetAudience ?? "",
									})
								}
							>
								Edit
							</Button>
							<Button
								variant="destructive"
								size="sm"
								onClick={async () => {
									await deleteProductLineFn({ data: { brandId: brand.id, productLineId: pl.id } });
									await refresh();
								}}
							>
								Delete
							</Button>
						</div>
					</div>
				))}
			</section>

			{/* Credentials (US-A03) */}
			<section className="space-y-3">
				<div className="flex items-center justify-between">
					<h2 className="text-xl font-semibold">Credentials</h2>
					<Button size="sm" onClick={() => setCrEditor({ credType: "certification", name: "", year: "", isThirdPartyPublic: false, url: "" })}>
						+ Add Credential
					</Button>
				</div>
				{profile.credentials.length === 0 && (
					<p className="text-sm text-muted-foreground">No credentials yet — certifications, patents, awards, memberships, case studies, media.</p>
				)}
				{profile.credentials.map((c) => (
					<div key={c.id} className="flex items-start justify-between rounded-lg border p-3">
						<div>
							<div className="flex items-center gap-2">
								<span className="font-medium">{c.name}</span>
								<Badge variant="secondary">{CRED_TYPE_LABELS[c.credType] ?? c.credType}</Badge>
								{c.isThirdPartyPublic && <Badge className="bg-emerald-600">Verified · third-party public</Badge>}
							</div>
							{c.year && <div className="text-xs text-muted-foreground">{c.year}</div>}
							{c.url && (
								<a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs underline">
									{c.url}
								</a>
							)}
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									setCrEditor({
										id: c.id,
										credType: c.credType,
										name: c.name,
										year: c.year ?? "",
										isThirdPartyPublic: c.isThirdPartyPublic,
										url: c.url ?? "",
									})
								}
							>
								Edit
							</Button>
							<Button
								variant="destructive"
								size="sm"
								onClick={async () => {
									await deleteCredentialFn({ data: { brandId: brand.id, credentialId: c.id } });
									await refresh();
								}}
							>
								Delete
							</Button>
						</div>
					</div>
				))}
			</section>

			{/* Product line editor dialog */}
			<Dialog open={!!plEditor} onOpenChange={(o) => !o && setPlEditor(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{plEditor?.id ? "Edit Product Line" : "Add Product Line"}</DialogTitle>
					</DialogHeader>
					{plEditor && (
						<div className="space-y-3">
							<div className="space-y-1">
								<Label>Name *</Label>
								<Input value={plEditor.name} onChange={(e) => setPlEditor({ ...plEditor, name: e.target.value })} placeholder="e.g. ProLine 5000 Series" />
							</div>
							<div className="space-y-1">
								<Label>Category</Label>
								<Input value={plEditor.category} onChange={(e) => setPlEditor({ ...plEditor, category: e.target.value })} placeholder="e.g. Air Conditioning" />
							</div>
							<div className="space-y-1">
								<Label>Core Parameters</Label>
								<Input value={plEditor.coreParams} onChange={(e) => setPlEditor({ ...plEditor, coreParams: e.target.value })} placeholder="e.g. 18 SEER, 240V, Wi-Fi" />
							</div>
							<div className="space-y-1">
								<Label>Differentiators *</Label>
								<Textarea value={plEditor.differentiators} onChange={(e) => setPlEditor({ ...plEditor, differentiators: e.target.value })} placeholder="What makes this line different — used as fact-check ground truth" />
							</div>
							<div className="space-y-1">
								<Label>Target Audience</Label>
								<Input value={plEditor.targetAudience} onChange={(e) => setPlEditor({ ...plEditor, targetAudience: e.target.value })} placeholder="e.g. US homeowners, 2,000+ sq ft" />
							</div>
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setPlEditor(null)}>Cancel</Button>
						<Button onClick={saveProductLine} disabled={busy || !plEditor?.name.trim() || !plEditor?.differentiators.trim()}>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Credential editor dialog */}
			<Dialog open={!!crEditor} onOpenChange={(o) => !o && setCrEditor(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{crEditor?.id ? "Edit Credential" : "Add Credential"}</DialogTitle>
					</DialogHeader>
					{crEditor && (
						<div className="space-y-3">
							<div className="space-y-1">
								<Label>Type *</Label>
								<Select value={crEditor.credType} onValueChange={(v) => setCrEditor({ ...crEditor, credType: v })}>
									<SelectTrigger><SelectValue /></SelectTrigger>
									<SelectContent>
										{Object.entries(CRED_TYPE_LABELS).map(([k, v]) => (
											<SelectItem key={k} value={k}>{v}</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1">
								<Label>Name *</Label>
								<Input value={crEditor.name} onChange={(e) => setCrEditor({ ...crEditor, name: e.target.value })} placeholder="e.g. Energy Star 2025" />
							</div>
							<div className="space-y-1">
								<Label>Year</Label>
								<Input value={crEditor.year} onChange={(e) => setCrEditor({ ...crEditor, year: e.target.value })} placeholder="e.g. 2024 or 2023-2024" />
							</div>
							<div className="flex items-center justify-between">
								<Label>Third-party public (independently verifiable)</Label>
								<Switch checked={crEditor.isThirdPartyPublic} onCheckedChange={(v) => setCrEditor({ ...crEditor, isThirdPartyPublic: v })} />
							</div>
							<div className="space-y-1">
								<Label>Source URL</Label>
								<Input value={crEditor.url} onChange={(e) => setCrEditor({ ...crEditor, url: e.target.value })} placeholder="https://..." />
							</div>
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setCrEditor(null)}>Cancel</Button>
						<Button onClick={saveCredential} disabled={busy || !crEditor?.name.trim()}>
							Save
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
