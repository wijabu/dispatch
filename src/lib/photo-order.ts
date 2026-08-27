import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq, sql } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { photos } from "@/db/schema";

type DB = BetterSQLite3Database<typeof schema>;

// "Primary" simply means first by sortOrder — one source of truth for
// ordering, no separate flag to fall out of sync.
// Persist an explicit ordering: each photo's sortOrder becomes its index
// in orderedIds. Ids not belonging to the item are ignored.
export async function setPhotoOrder(db: DB, itemId: number, orderedIds: number[]) {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(photos)
      .set({ sortOrder: i })
      .where(and(eq(photos.id, orderedIds[i]), eq(photos.itemId, itemId)));
  }
}

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

// Mark one photo as the r/WatchExchange timestamp (one per item). Toggling the
// same photo again clears it. Independent of primary/sortOrder.
export async function toggleTimestampPhoto(db: DB, photoId: number, itemId: number) {
  const [target] = await db
    .select({ isTimestamp: photos.isTimestamp })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
  if (!target) return;
  if (target.isTimestamp) {
    await db
      .update(photos)
      .set({ isTimestamp: false })
      .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
    return;
  }
  await db.update(photos).set({ isTimestamp: false }).where(eq(photos.itemId, itemId));
  await db
    .update(photos)
    .set({ isTimestamp: true })
    .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
}
