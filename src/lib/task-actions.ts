import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { items, listings, priceHistory } from "@/db/schema";
import type { SoldChannel } from "@/db/schema";
import { computeDropTarget } from "./tasks";

type DB = BetterSQLite3Database<typeof schema>;

// Match SQLite's datetime('now') format so text-ordered columns sort correctly.
function toDbDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

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
    .set({ askingPrice: target, updatedAt: toDbDate(now) })
    .where(eq(items.id, itemId));
  await db
    .insert(priceHistory)
    .values({ itemId, askingPrice: target, changedAt: toDbDate(now) });
  return target;
}

// stale_price "I updated it": syncs listedPrice to the item's current
// asking price. Does not touch renewedAt — this isn't a renew action.
export async function syncListingPriceCore(db: DB, listingId: number): Promise<void> {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) return;
  const [item] = await db.select().from(items).where(eq(items.id, listing.itemId));
  await db
    .update(listings)
    .set({ listedPrice: item?.askingPrice ?? listing.listedPrice })
    .where(eq(listings.id, listingId));
}

// relist "I renewed it": stamps renewedAt. Does not touch listedPrice —
// a renew without an edited price must not erase a price-mismatch signal.
export async function markListingRenewedCore(
  db: DB,
  listingId: number,
  now: Date
): Promise<void> {
  await db
    .update(listings)
    .set({ renewedAt: toDbDate(now) })
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

// Mark-sold fan-out: record the sale on the item. Pure write; the fan-out
// server action wraps this and drives the per-channel takedowns.
export async function markSoldCore(
  db: DB,
  itemId: number,
  soldPrice: number | null,
  soldChannel: SoldChannel | null,
  now: Date
): Promise<void> {
  await db
    .update(items)
    .set({
      status: "sold",
      soldPrice,
      soldChannel,
      soldAt: toDbDate(now),
      updatedAt: toDbDate(now),
    })
    .where(eq(items.id, itemId));
}

// End a single listing row (status=ended, endedAt=now). Shared by the fan-out
// (on a successful takedown) and completeTakedown (manual "Mark done").
export async function endListingCore(
  db: DB,
  listingId: number,
  now: Date
): Promise<void> {
  await db
    .update(listings)
    .set({ status: "ended", endedAt: toDbDate(now) })
    .where(eq(listings.id, listingId));
}
