import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { asc, eq } from "drizzle-orm";
import path from "path";
import * as schema from "@/db/schema";
import { items, photos } from "@/db/schema";
import { setPhotoOrder, setPrimaryPhoto, toggleTimestampPhoto } from "../photo-order";

let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const [item] = await db.insert(items).values({ name: "Desk" }).returning();
  await db.insert(photos).values([
    { itemId: item.id, path: "a.jpg", sortOrder: 0 },
    { itemId: item.id, path: "b.jpg", sortOrder: 1 },
    { itemId: item.id, path: "c.jpg", sortOrder: 2 },
  ]);
});

async function orderedPaths(itemId: number) {
  const rows = await db
    .select()
    .from(photos)
    .where(eq(photos.itemId, itemId))
    .orderBy(asc(photos.sortOrder));
  return rows.map((r) => r.path);
}

describe("setPrimaryPhoto", () => {
  it("moves the chosen photo to the front of the ordering", async () => {
    const [target] = await db.select().from(photos).where(eq(photos.path, "c.jpg"));

    await setPrimaryPhoto(db, target.id, target.itemId);

    expect(await orderedPaths(target.itemId)).toEqual(["c.jpg", "a.jpg", "b.jpg"]);
  });

  it("is stable when promoting twice: last promotion wins", async () => {
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    const [c] = await db.select().from(photos).where(eq(photos.path, "c.jpg"));

    await setPrimaryPhoto(db, c.id, c.itemId);
    await setPrimaryPhoto(db, b.id, b.itemId);

    expect(await orderedPaths(b.itemId)).toEqual(["b.jpg", "c.jpg", "a.jpg"]);
  });

  it("setPhotoOrder applies the given sequence as the new order", async () => {
    const rows = await db.select().from(photos).orderBy(asc(photos.sortOrder));
    const byPath = Object.fromEntries(rows.map((r) => [r.path, r]));

    await setPhotoOrder(db, rows[0].itemId, [
      byPath["b.jpg"].id,
      byPath["c.jpg"].id,
      byPath["a.jpg"].id,
    ]);

    expect(await orderedPaths(rows[0].itemId)).toEqual(["b.jpg", "c.jpg", "a.jpg"]);
  });

  it("setPhotoOrder ignores ids that belong to a different item", async () => {
    const [otherItem] = await db.insert(items).values({ name: "Watch" }).returning();
    await db.insert(photos).values({ itemId: otherItem.id, path: "w.jpg", sortOrder: 5 });
    const [w] = await db.select().from(photos).where(eq(photos.path, "w.jpg"));
    const rows = await db
      .select()
      .from(photos)
      .where(eq(photos.path, "a.jpg"));
    const deskItemId = rows[0].itemId;

    // attacker-ish input: w belongs to Watch, not Desk
    await setPhotoOrder(db, deskItemId, [w.id]);

    const [wAfter] = await db.select().from(photos).where(eq(photos.id, w.id));
    expect(wAfter.sortOrder).toBe(5);
  });

  it("ignores a photoId that belongs to a different item", async () => {
    const [otherItem] = await db.insert(items).values({ name: "Watch" }).returning();
    await db.insert(photos).values({ itemId: otherItem.id, path: "w.jpg", sortOrder: 0 });
    const [w] = await db.select().from(photos).where(eq(photos.path, "w.jpg"));
    const [deskItem] = await db.select().from(items).where(eq(items.name, "Desk"));

    // wrong pairing: photo w belongs to Watch, not Desk
    await setPrimaryPhoto(db, w.id, deskItem.id);

    expect(await orderedPaths(deskItem.id)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(await orderedPaths(otherItem.id)).toEqual(["w.jpg"]);
  });
});

async function timestampPaths(itemId: number) {
  const rows = await db.select().from(photos).where(eq(photos.itemId, itemId));
  return rows.filter((r) => r.isTimestamp).map((r) => r.path);
}

describe("toggleTimestampPhoto", () => {
  it("marks the chosen photo as the timestamp", async () => {
    const [t] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    await toggleTimestampPhoto(db, t.id, t.itemId);
    expect(await timestampPaths(t.itemId)).toEqual(["b.jpg"]);
  });

  it("is one-per-item: marking a second clears the first", async () => {
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    const [c] = await db.select().from(photos).where(eq(photos.path, "c.jpg"));
    await toggleTimestampPhoto(db, b.id, b.itemId);
    await toggleTimestampPhoto(db, c.id, c.itemId);
    expect(await timestampPaths(b.itemId)).toEqual(["c.jpg"]);
  });

  it("toggles off when the same photo is marked again", async () => {
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    await toggleTimestampPhoto(db, b.id, b.itemId);
    await toggleTimestampPhoto(db, b.id, b.itemId);
    expect(await timestampPaths(b.itemId)).toEqual([]);
  });

  it("leaves another item's timestamp untouched", async () => {
    const [item2] = await db.insert(items).values({ name: "Other" }).returning();
    const [p2] = await db
      .insert(photos)
      .values({ itemId: item2.id, path: "x.jpg", sortOrder: 0, isTimestamp: true })
      .returning();
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    await toggleTimestampPhoto(db, b.id, b.itemId);
    const [other] = await db.select().from(photos).where(eq(photos.id, p2.id));
    expect(other.isTimestamp).toBe(true); // untouched — clear is scoped to the target's item
  });

  it("is independent of primary: does not change photo order", async () => {
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    await toggleTimestampPhoto(db, b.id, b.itemId);
    expect(await orderedPaths(b.itemId)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });
});
