import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { photos } from "@/db/schema";

type DB = BetterSQLite3Database<typeof schema>;

// "Primary" simply means first by sortOrder — one source of truth for
// ordering, no separate flag to fall out of sync.
export async function setPrimaryPhoto(db: DB, photoId: number, itemId: number) {
  const [row] = await db
    .select({ min: sql<number>`coalesce(min(sort_order), 0)` })
    .from(photos)
    .where(eq(photos.itemId, itemId));

  await db
    .update(photos)
    .set({ sortOrder: (row?.min ?? 0) - 1 })
    .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
}
