/**
 * Epic A-2 (V1.0) M2×M3: Brand research draft flow — REST client.
 *
 * 前端调用 /api/v1/... research/draft 端点的薄封装（同源 fetch）。
 * 端点契约见 research/index.ts + drafts/$draftId.ts。
 */

export interface ResearchDraftPayload {
	brandName: string;
	website: string;
	additionalDomains: string[];
	aliases: string[];
	competitors: Array<{ name: string; domains: string[]; aliases: string[] }>;
	suggestedPrompts: Array<{ prompt: string; tags: string[] }>;
	summary?: string;
	description?: string;
	productLines?: {
		confirmed: Array<{
			line: {
				name: string;
				skus: Array<{ name: string; model?: string; oneLiner: string; evidenceUrl: string }>;
			};
			sourceEvidenceChecked?: number;
		}>;
		unverified: Array<{
			line: { name: string; skus: Array<{ name: string; model?: string }> };
			reason: string;
		}>;
	};
}

/** PATCH /drafts/{id} 回写契约 — confirmed 数组（unverified 由后端保留，不灌库仅展示） */
export interface DraftPatchProductLine {
	line: {
		name: string;
		skus: Array<{ name: string; model?: string; oneLiner: string; evidenceUrl: string }>;
	};
	evidence?: number;
}

export interface ResearchDraft {
	id: string;
	brandId: string;
	website: string;
	state: "pending_review" | "done" | "failed" | "rolled_back";
	researchStatus: "queued" | "running" | "done" | "failed" | null;
	payload: ResearchDraftPayload;
	error?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface TriggerResearchResult {
	draftId: string;
	alreadyExisted: boolean;
	jobSkipped: boolean;
}

export interface DraftPatchBody {
	brandName?: string;
	website?: string;
	summary?: string;
	description?: string;
	aliases?: string[];
	additionalDomains?: string[];
	competitors?: ResearchDraftPayload["competitors"];
	prompts?: ResearchDraftPayload["suggestedPrompts"];
	productLines?: DraftPatchProductLine[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
	const resp = await fetch(url, {
		headers: { "Content-Type": "application/json" },
		...init,
	});
	if (!resp.ok) {
		let detail = `Request failed (${resp.status})`;
		try {
			const data = await resp.json();
			if (data?.error?.message) detail = data.error.message;
			else if (data?.message) detail = data.message;
			else if (typeof data?.detail === "string") detail = data.detail;
		} catch {
			// non-JSON error body — keep status detail
		}
		throw new Error(detail);
	}
	return (await resp.json()) as T;
}

export function triggerResearch(brandId: string, website: string): Promise<TriggerResearchResult> {
	return request<TriggerResearchResult>(`/api/v1/brands/${brandId}/research/`, {
		method: "POST",
		body: JSON.stringify({ website }),
	});
}

export function fetchDraft(draftId: string): Promise<ResearchDraft> {
	return request<ResearchDraft>(`/api/v1/drafts/${draftId}`, { method: "GET" });
}

export function patchDraft(draftId: string, body: DraftPatchBody): Promise<ResearchDraft> {
	return request<ResearchDraft>(`/api/v1/drafts/${draftId}`, {
		method: "PATCH",
		body: JSON.stringify(body),
	});
}

export function confirmDraft(draftId: string): Promise<{ id: string }> {
	return request<{ id: string }>(`/api/v1/drafts/${draftId}`, {
		method: "POST",
		body: JSON.stringify({ _action: "confirm" }),
	});
}

export function rollbackDraft(draftId: string): Promise<{ rolledBack: boolean }> {
	return request<{ rolledBack: boolean }>(`/api/v1/drafts/${draftId}`, {
		method: "POST",
		body: JSON.stringify({ _action: "rollback" }),
	});
}

export function fetchBrandDrafts(brandId: string, includeAll = false): Promise<{ drafts: ResearchDraft[] }> {
	return request<{ drafts: ResearchDraft[] }>(`/api/v1/brands/${brandId}/research/?include_all=${includeAll}`, {
		method: "GET",
	});
}
