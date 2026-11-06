import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	getPendingBrandIntent,
	setPendingBrandIntent,
	clearPendingBrandIntent,
	hasPendingBrandIntent,
} from "../pending-brand-intent";

class MockSessionStorage {
	private store = new Map<string, string>();

	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.store.set(key, String(value));
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}

	get length(): number {
		return this.store.size;
	}

	key(index: number): string | null {
		return Array.from(this.store.keys())[index] ?? null;
	}
}

describe("pending-brand-intent", () => {
	const mockStorage = new MockSessionStorage();

	beforeEach(() => {
		mockStorage.clear();
		vi.stubGlobal("window", {
			sessionStorage: mockStorage,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns null when no intent is stored", () => {
		expect(getPendingBrandIntent()).toBeNull();
		expect(hasPendingBrandIntent()).toBe(false);
	});

	it("successfully stores and retrieves valid brand intent", () => {
		const success = setPendingBrandIntent({
			brandName: "  熵宜 Negency  ",
			website: "negency.com/zh",
		});
		expect(success).toBe(true);
		expect(hasPendingBrandIntent()).toBe(true);

		const retrieved = getPendingBrandIntent();
		expect(retrieved).not.toBeNull();
		expect(retrieved?.brandName).toBe("熵宜 Negency");
		// validateWebsiteUrl normalizes bare domain and preserves /zh path
		expect(retrieved?.website).toBe("https://negency.com/zh");
		expect(typeof retrieved?.timestamp).toBe("number");
	});

	it("rejects empty or whitespace-only brand names", () => {
		const success = setPendingBrandIntent({
			brandName: "   ",
			website: "https://example.com",
		});
		expect(success).toBe(false);
		expect(getPendingBrandIntent()).toBeNull();
	});

	it("rejects brand names exceeding 100 characters", () => {
		const longName = "A".repeat(101);
		const success = setPendingBrandIntent({
			brandName: longName,
			website: "https://example.com",
		});
		expect(success).toBe(false);
		expect(getPendingBrandIntent()).toBeNull();
	});

	it("rejects invalid websites", () => {
		const success = setPendingBrandIntent({
			brandName: "Valid Brand",
			website: "not a website!@#$",
		});
		expect(success).toBe(false);
		expect(getPendingBrandIntent()).toBeNull();
	});

	it("clears pending brand intent properly", () => {
		setPendingBrandIntent({
			brandName: "Brand X",
			website: "https://example.com",
		});
		expect(hasPendingBrandIntent()).toBe(true);

		clearPendingBrandIntent();
		expect(hasPendingBrandIntent()).toBe(false);
		expect(getPendingBrandIntent()).toBeNull();
	});

	it("expires intent when timestamp is older than 24 hours", () => {
		const oldTimestamp = Date.now() - 25 * 60 * 60 * 1000;
		mockStorage.setItem(
			"negency_pending_brand_intent",
			JSON.stringify({
				brandName: "Expired Brand",
				website: "https://example.com",
				timestamp: oldTimestamp,
			}),
		);

		expect(getPendingBrandIntent()).toBeNull();
		expect(hasPendingBrandIntent()).toBe(false);
	});
});
