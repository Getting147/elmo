/**
 * Helper module for managing pending brand diagnosis intent.
 * Stored in sessionStorage to prevent leaking in URL queries or logs.
 */

import { validateWebsiteUrl } from "./brand-website";

export interface PendingBrandIntent {
	brandName: string;
	website: string;
	timestamp: number;
}

const STORAGE_KEY = "negency_pending_brand_intent";
const INTENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getPendingBrandIntent(): PendingBrandIntent | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<PendingBrandIntent>;
		if (
			typeof parsed.brandName === "string" &&
			typeof parsed.website === "string" &&
			typeof parsed.timestamp === "number"
		) {
			// Check expiration
			if (Date.now() - parsed.timestamp > INTENT_TTL_MS) {
				clearPendingBrandIntent();
				return null;
			}
			return {
				brandName: parsed.brandName,
				website: parsed.website,
				timestamp: parsed.timestamp,
			};
		}
		return null;
	} catch {
		return null;
	}
}

export function setPendingBrandIntent(data: { brandName: string; website: string }): boolean {
	if (typeof window === "undefined") return false;
	const trimmedName = data.brandName.trim();
	if (!trimmedName || trimmedName.length > 100) return false;

	const validation = validateWebsiteUrl(data.website);
	if (!validation.isValid) return false;

	const intent: PendingBrandIntent = {
		brandName: trimmedName,
		website: validation.formattedUrl,
		timestamp: Date.now(),
	};

	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
		return true;
	} catch {
		return false;
	}
}

export function clearPendingBrandIntent(): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

export function hasPendingBrandIntent(): boolean {
	return getPendingBrandIntent() !== null;
}
