/** biome-ignore-all lint/suspicious/noExplicitAny: The SQL-aware ORM substitute deliberately accepts heterogeneous Drizzle query shapes; real PostgreSQL is verified separately. */
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	rows: new Map<string, any>(),
	sent: [] as any[],
	writes: [] as any[],
	analyze: vi.fn(),
	pgState: "active" as string | null,
	pgThrows: false,
	insertError: null as Error | null,
	sendError: null as Error | null,
	beforeInsert: null as null | (() => Promise<void>),
	onActiveRead: null as null | (() => Promise<void>),
}));
function compiled(where: any) {
	return new PgDialect().sqlToQuery(where);
}
function matches(row: any, where: any) {
	const { sql, params } = compiled(where);
	const fields: any = {
		id: "id",
		brand_id: "brandId",
		url_hash: "urlHash",
		state: "state",
		research_status: "researchStatus",
		created_at: "createdAt",
	};
	for (const m of sql.matchAll(/"draft_research"\."([^"]+)"\s*(=|>=)\s*\$(\d+)/g)) {
		const val = params[Number(m[3]) - 1];
		const actual = row[fields[m[1]]];
		if (m[2] === "=" && actual !== val) return false;
		if (m[2] === ">=" && new Date(actual) < new Date(val as any)) return false;
	}
	for (const m of sql.matchAll(/"draft_research"\."([^"]+)" in \(([^)]+)\)/g)) {
		const vals = [...m[2].matchAll(/\$(\d+)/g)].map((x) => params[Number(x[1]) - 1]);
		if (!vals.includes(row[fields[m[1]]])) return false;
	}
	const relation = sql.match(/->'metadata'->>'supersedesDraftId'\s*=\s*\$(\d+)/);
	if (relation && row.payload?.metadata?.supersedesDraftId !== params[Number(relation[1]) - 1]) return false;
	if (sql.includes("like '队列入队失败:%'") && row.state === "rolled_back" && row.error?.startsWith("队列入队失败:"))
		return false;
	return true;
}
vi.mock("@/server/research-lock", () => ({
	withResearchLock: async (_b: any, _u: any, op: any) => op((await import("@workspace/lib/db/db")).db),
}));
vi.mock("@/lib/boss-client", () => ({
	getBoss: async () => ({
		send: async (name: string, data: any) => {
			if (h.sendError) throw h.sendError;
			h.sent.push({ name, data });
			return "synthetic-job";
		},
	}),
}));
vi.mock("@workspace/lib/db/db", () => ({
	db: {
		query: {
			brands: { findFirst: async () => ({ id: "b1" }) },
			draftResearch: {
				findFirst: async (args: any) => {
					const candidates = [...h.rows.values()].filter((r) => matches(r, args.where));
					if (args.orderBy) candidates.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
					const row = candidates[0];
					const snap = row ? structuredClone(row) : undefined;
					if (compiled(args.where).sql.includes('"brand_id"') && h.onActiveRead) {
						const callback = h.onActiveRead;
						h.onActiveRead = null;
						await callback();
					}
					return snap;
				},
			},
		},
		execute: async () => {
			if (h.pgThrows) throw Error("queue lookup unavailable");
			return { rows: h.pgState ? [{ state: h.pgState }] : [] };
		},
		insert: () => ({
			values: async (values: any) => {
				if (h.beforeInsert) {
					const callback = h.beforeInsert;
					h.beforeInsert = null;
					await callback();
				}
				if (h.insertError) throw h.insertError;
				if (
					[...h.rows.values()].some(
						(r) =>
							r.brandId === values.brandId &&
							r.urlHash === values.urlHash &&
							["pending_review", "confirmed"].includes(r.state),
					)
				) {
					const e: any = new Error("synthetic partial unique violation");
					e.code = "23505";
					throw e;
				}
				h.rows.set(values.id, structuredClone(values));
				h.writes.push({ op: "insert", values: structuredClone(values) });
			},
		}),
		update: () => ({
			set: (values: any) => ({
				where: (where: any) => {
					const apply = () => {
						const rows = [...h.rows.values()].filter((r) => matches(r, where));
						for (const r of rows) {
							const merged = { ...r, ...values };
							if (
								["pending_review", "confirmed"].includes(merged.state) &&
								[...h.rows.values()].some(
									(other) =>
										other.id !== r.id &&
										other.brandId === merged.brandId &&
										other.urlHash === merged.urlHash &&
										["pending_review", "confirmed"].includes(other.state),
								)
							) {
								const e: any = Error("synthetic partial unique update violation");
								e.code = "23505";
								throw e;
							}
							Object.assign(r, structuredClone(values));
						}
						h.writes.push({
							op: "update",
							values: structuredClone(values),
							matched: rows.length,
							sql: compiled(where).sql,
						});
						return rows.map((r) => ({ id: r.id, createdAt: r.createdAt }));
					};
					const result = Promise.resolve().then(apply);
					return Object.assign(result, { returning: () => result });
				},
			}),
		}),
	},
}));
vi.mock("@workspace/lib/onboarding", () => ({
	hashUrlForDraft: (s: string) => `hash_${s}`,
	computeExpiresAt: () => new Date("2026-11-28T00:00:00Z"),
	analyzeBrand: h.analyze,
	createDraft: vi.fn(),
	getDraftById: vi.fn(),
	listDraftsByBrand: vi.fn(),
	markFailed: vi.fn().mockResolvedValue({ updated: true }),
	markRolledBack: vi.fn(),
}));
let triggerResearch: any;

import { processResearchJob } from "../../../worker/src/jobs/process-research";

const website = "https://fixture.invalid";
const suggestion = {
	brandName: "Fixture",
	website,
	additionalDomains: [],
	aliases: [],
	competitors: [],
	suggestedPrompts: [],
	productLines: { confirmed: [], unverified: [] },
};
function oldRow(status = "queued", state = "pending_review") {
	return {
		id: "old",
		brandId: "b1",
		urlHash: `hash_${website}`,
		researchStatus: status,
		state,
		error: null,
		createdAt: new Date("2026-10-28T14:00:00Z"),
		updatedAt: new Date("2026-10-28T14:00:00Z"),
		payload: { ...suggestion, legacyNote: "preserve" },
	};
}
const job = (id: string) =>
	[{ id: `job-${id}`, data: { draftId: id, brandId: "b1", website, additionalDomains: [] } }] as any;
beforeEach(() => {
	h.rows.clear();
	h.sent = [];
	h.writes = [];
	h.pgState = "active";
	h.pgThrows = false;
	h.insertError = null;
	h.sendError = null;
	h.beforeInsert = null;
	h.onActiveRead = null;
	h.analyze.mockReset();
	h.analyze.mockResolvedValue(structuredClone(suggestion));
	vi.stubEnv("RESEARCH_WORKER_STARTED_AT", "2026-10-28T13:00:00Z");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

beforeEach(async () => {
	vi.resetModules();
	({ triggerResearch } = await import("./research"));
});
describe("Research recovery persistence and concurrent response contracts", () => {
	it("W01 a successful duplicate response must not reference a draft that never exists when winner insertion fails", async () => {
		h.rows.set("old", oldRow());
		let arrived: any, release: any;
		const paused = new Promise<void>((r) => (arrived = r));
		const resume = new Promise<void>((r) => (release = r));
		h.beforeInsert = async () => {
			arrived();
			await resume;
		};
		const winner = triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" }).then(
			(value: any) => ({ value }),
			(error: any) => ({ error }),
		);
		await paused;
		let duplicateSettled = false;
		const duplicate = triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" })
			.then(
				(value: any) => ({ value }),
				(error: any) => ({ error }),
			)
			.finally(() => {
				duplicateSettled = true;
			});
		await Promise.resolve();
		expect(duplicateSettled).toBe(false);
		h.insertError = Error("Synthetic winner insert rejected");
		release();
		const [outcome, repeated] = await Promise.all([winner, duplicate]);
		expect(outcome.error).toBeDefined();
		expect(repeated.error).toBe(outcome.error);
		expect(repeated.value).toBeUndefined();
		expect(h.rows.size).toBe(1);
		expect(h.rows.get("old").state).toBe("pending_review");
		expect(h.sent).toHaveLength(0);
		console.log("OBSERVED W01 both_rejected=true phantom_ids=0 old_restored=true jobs=0 real_http_calls=0");
	});
	it("W01 successful duplicates wait for INSERT and receive one persisted draft and one job", async () => {
		h.rows.set("old", oldRow());
		let arrived: any, release: any;
		const paused = new Promise<void>((r) => (arrived = r)),
			resume = new Promise<void>((r) => (release = r));
		h.beforeInsert = async () => {
			arrived();
			await resume;
		};
		const winner = triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" });
		await paused;
		let settled = false;
		const duplicate = triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" }).then((r: any) => {
			settled = true;
			expect(h.rows.has(r.draftId)).toBe(true);
			return r;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		release();
		const [first, second] = await Promise.all([winner, duplicate]);
		expect(first.draftId).toBe(second.draftId);
		expect(h.sent).toHaveLength(1);
	});
	it("W02 A must still map to B after module memory is cleared while database A B C history is preserved", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-29T04:00:00Z"));
		h.rows.set("old", oldRow("failed", "failed"));
		const b = await triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" });
		h.analyze.mockRejectedValueOnce(Error("Synthetic B failure"));
		await processResearchJob(job(b.draftId));
		vi.setSystemTime(new Date("2026-10-29T04:00:02Z"));
		const c = await triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: b.draftId });
		const warm = await triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" });
		expect(warm.draftId).toBe(b.draftId);
		const rowsBefore = [...h.rows.values()].map((r) => structuredClone(r));
		vi.resetModules();
		const cold = await import("./research");
		const late = await cold.triggerResearch({ brandId: "b1", website, retry: true, targetDraftId: "old" });
		expect([...h.rows.values()]).toEqual(rowsBefore);
		console.log(
			"OBSERVED W02 successor_of_A=" +
				b.draftId +
				" successor_of_B=" +
				c.draftId +
				" warm_A_returned=" +
				warm.draftId +
				" cold_A_returned=" +
				late.draftId +
				" preserved_db_rows=" +
				h.rows.size +
				" jobs=" +
				h.sent.length +
				" real_http_calls=0",
		);
		expect(late.draftId).toBe(b.draftId);
	});
});
