import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const snapshotSchema = z.object({
	snapshot_id: z.string().min(1),
	content_sha256: z.string().min(1),
	question_count: z.number().int().positive(),
});
const draftSchema = z.object({
	profileSignature: z.string(),
	dimensions: z.record(z.string(), z.string()),
	mode: z.enum(["real", "synthetic"]),
	snapshot: snapshotSchema.nullable(),
	authorizedRunId: z.string().optional(),
	runId: z.string().optional(),
	parameters: z.object({ modelName: z.string().optional(), webSearch: z.boolean().optional() }).optional(),
	submitted: z.boolean(),
});
type Draft = z.infer<typeof draftSchema>;

// Share preparation and task identity across this user's tabs; the server still verifies all authorization.
export function useDiagnosisDraft(userId: string, brandId: string, profile: unknown) {
	const key = `diagnosis-draft:${userId}:${brandId}`;
	const profileSignature = JSON.stringify(profile ?? null);
	const empty = useCallback(
		(): Draft => ({ profileSignature, dimensions: {}, mode: "synthetic", snapshot: null, submitted: false }),
		[profileSignature],
	);
	const [draft, setDraft] = useState<Draft>(empty);
	const read = useCallback(() => {
		const raw = localStorage.getItem(key);
		if (!raw) return empty();
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			return empty();
		}
		const result = draftSchema.safeParse(value);
		return result.success && result.data.profileSignature === profileSignature ? result.data : empty();
	}, [key, profileSignature, empty]);
	useEffect(() => {
		setDraft(read());
		const receive = (event: StorageEvent) => {
			if (event.key === key) setDraft(read());
		};
		window.addEventListener("storage", receive);
		return () => window.removeEventListener("storage", receive);
	}, [key, read]);
	const transact = useCallback(
		async (action: (current: Draft, save: (next: Draft) => void) => Promise<Draft> | Draft) => {
			if (!navigator.locks) throw new Error("当前浏览器无法安全协调本次操作，请使用最新版本浏览器。");
			return navigator.locks.request(key, async () => {
				const save = (next: Draft) => {
					localStorage.setItem(key, JSON.stringify(draftSchema.parse(next)));
					setDraft(next);
				};
				const next = await action(read(), save);
				save(next);
				return next;
			});
		},
		[key, read],
	);
	return { draft, transact };
}
