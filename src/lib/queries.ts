import { db } from "@/db";
import { items, photos, listings, priceHistory } from "@/db/schema";
import { asc, desc, eq, like, or } from "drizzle-orm";

export async function getItems(search?: string) {
  const query = db.select().from(items).orderBy(desc(items.updatedAt));
  if (search?.trim()) {
    const term = `%${search.trim()}%`;
    return query.where(
      or(
        like(items.name, term),
        like(items.description, term),
        like(items.category, term)
      )
    );
  }
  return query;
}

export async function getItem(id: number) {
  const [item] = await db.select().from(items).where(eq(items.id, id));
  if (!item) return null;
  const [itemPhotos, itemListings, prices] = await Promise.all([
    db
      .select()
      .from(photos)
      .where(eq(photos.itemId, id))
      .orderBy(asc(photos.sortOrder)),
    db.select().from(listings).where(eq(listings.itemId, id)),
    db
      .select()
      .from(priceHistory)
      .where(eq(priceHistory.itemId, id))
      .orderBy(desc(priceHistory.changedAt)),
  ]);
  return { ...item, photos: itemPhotos, listings: itemListings, prices };
}

export async function getFirstPhotos(itemIds: number[]) {
  if (itemIds.length === 0) return new Map<number, string>();
  const allPhotos = await db
    .select()
    .from(photos)
    .orderBy(asc(photos.sortOrder));
  const map = new Map<number, string>();
  for (const photo of allPhotos) {
    if (!map.has(photo.itemId)) map.set(photo.itemId, photo.path);
  }
  return map;
}

export async function getActiveListingsByItem(): Promise<Map<number, string[]>> {
  const rows = await db.select().from(listings).where(eq(listings.status, "active"));
  const map = new Map<number, string[]>();
  for (const row of rows) {
    const arr = map.get(row.itemId) ?? [];
    arr.push(row.publisher);
    map.set(row.itemId, arr);
  }
  return map;
}

export async function getTaskData() {
  const allItems = await db.select().from(items);
  const activeListings = await db
    .select()
    .from(listings)
    .where(eq(listings.status, "active"));
  const history = await db
    .select()
    .from(priceHistory)
    .orderBy(desc(priceHistory.changedAt));
  const lastPriceChange = new Map<number, string>();
  for (const row of history) {
    if (!lastPriceChange.has(row.itemId)) lastPriceChange.set(row.itemId, row.changedAt);
  }
  return { items: allItems, activeListings, lastPriceChange };
}
