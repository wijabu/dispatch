import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { items, listings, priceHistory } from "@/db/schema";
import { computeDropTarget } from "./tasks";

type DB = BetterSQLite3Database<typeof schema>;

export async function applyPriceDropCore(
  db: DB,
  itemId: number,
  now: Date
): Promise<number | null> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) return null;
  const target = computeDropTarget(item);
  if (target == null) return null;
  await db
    .update(items)
    .set({ askingPrice: target, updatedAt: now.toISOString() })
    .where(eq(items.id, itemId));
  await db
    .insert(priceHistory)
    .values({ itemId, askingPrice: target, changedAt: now.toISOString() });
  return target;
}

export async function confirmListingUpdatedCore(
  db: DB,
  listingId: number,
  now: Date
): Promise<void> {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) return;
  const [item] = await db.select().from(items).where(eq(items.id, listing.itemId));
  await db
    .update(listings)
    .set({ listedPrice: item?.askingPrice ?? listing.listedPrice, renewedAt: now.toISOString() })
    .where(eq(listings.id, listingId));
}

export async function snoozeItemCore(
  db: DB,
  itemId: number,
  now: Date,
  days = 7
): Promise<void> {
  const until = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  await db.update(items).set({ snoozedUntil: until }).where(eq(items.id, itemId));
}
