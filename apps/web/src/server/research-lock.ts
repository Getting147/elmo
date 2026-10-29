import { db } from "@workspace/lib/db/db";
import * as schema from "@workspace/lib/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";

export type ResearchDatabase = Pick<typeof db, "query" | "insert" | "update" | "execute">;

export async function withResearchLock<T>(
	brandId: string,
	urlHash: string,
	operation: (database: ResearchDatabase) => Promise<T>,
): Promise<T> {
	const client = await db.$client.connect();
	let unlocked = false;
	try {
		// Keep the same session through enqueue/compensation. Each draft write commits before boss.send,
		// so workers and independent GET connections can see it without borrowing another pool connection.
		await client.query("select pg_advisory_lock(hashtext($1), hashtext($2))", [brandId, urlHash]);
		try {
			return await operation(drizzle(client, { schema }));
		} finally {
			await client.query("select pg_advisory_unlock(hashtext($1), hashtext($2))", [brandId, urlHash]);
			unlocked = true;
		}
	} finally {
		// Never return a session with an uncertain lock to the pool.
		client.release(!unlocked);
	}
}
