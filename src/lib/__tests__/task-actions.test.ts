import { describe, expect, it, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "@/db/schema";
import { items, listings, priceHistory } from "@/db/schema";
import {
  applyPriceDropCore,
  markListingRenewedCore,
  snoozeItemCore,
  syncListingPriceCore,
} from "../task-actions";

const NOW = new Date("2026-07-10T12:00:00Z");
let db: BetterSQLite3Database<typeof schema>;
let itemId: number;

beforeEach(async () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [item] = await db
    .insert(items)
    .values({
      name: "Rolex Explorer", status: "published",
      askingPrice: 6800, minimumPrice: 6200, dropPercent: 3, dropIntervalDays: 7,
    })
    .returning();
  itemId = item.id;
});

describe("applyPriceDropCore", () => {
  it("applies the computed drop and logs price history", async () => {
    const newPrice = await applyPriceDropCore(db, itemId, NOW);
    expect(newPrice).toBe(6596);
    const [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.askingPrice).toBe(6596);
    const history = await db.select().from(priceHistory).where(eq(priceHistory.itemId, itemId));
    expect(history).toHaveLength(1);
    expect(history[0].askingPrice).toBe(6596);
  });

  it("no-ops at the floor", async () => {
    await db.update(items).set({ askingPrice: 6200 }).where(eq(items.id, itemId));
    expect(await applyPriceDropCore(db, itemId, NOW)).toBeNull();
    const history = await db.select().from(priceHistory).where(eq(priceHistory.itemId, itemId));
    expect(history).toHaveLength(0);
  });
});

describe("syncListingPriceCore", () => {
  it("syncs listedPrice to asking price, leaving renewedAt untouched", async () => {
    await db.update(items).set({ askingPrice: 6596 }).where(eq(items.id, itemId));
    const [listing] = await db
      .insert(listings)
      .values({ itemId, publisher: "offerup", listedPrice: 6800 })
      .returning();
    await syncListingPriceCore(db, listing.id);
    const [after] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(after.listedPrice).toBe(6596);
    expect(after.renewedAt).toBeNull();
  });
});

describe("markListingRenewedCore", () => {
  it("stamps renewedAt, leaving listedPrice unchanged", async () => {
    const [listing] = await db
      .insert(listings)
      .values({ itemId, publisher: "facebook", listedPrice: 6800 })
      .returning();
    await markListingRenewedCore(db, listing.id, NOW);
    const [after] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(after.renewedAt).toBe("2026-07-10 12:00:00");
    expect(after.listedPrice).toBe(6800);
  });
});

describe("snoozeItemCore", () => {
  it("sets snoozedUntil 7 days out by default", async () => {
    await snoozeItemCore(db, itemId, NOW);
    const [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.snoozedUntil).toBe("2026-07-17");
  });
});
