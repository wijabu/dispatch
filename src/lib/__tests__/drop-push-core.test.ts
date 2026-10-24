import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "@/db/schema";
import { items, listings } from "@/db/schema";
import type { AndroidResult } from "@/automation/android/types";
import { facebookRenewThenReprice } from "../drop-push-core";

const NOW = new Date("2026-07-10T12:00:00Z");
const DONE: AndroidResult = { status: "done" };
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
      askingPrice: 6596, minimumPrice: 6200, dropPercent: 3, dropIntervalDays: 7,
    })
    .returning();
  itemId = item.id;
});

async function insertListing(publisher: string, listedPrice: number) {
  const [row] = await db
    .insert(listings)
    .values({ itemId, publisher, status: "active", listedPrice, listedAt: "2026-07-01 00:00:00" })
    .returning();
  return row;
}

async function getListing(id: number) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row;
}

describe("facebookRenewThenReprice", () => {
  it("stops at a failed renew without touching the row or repricing", async () => {
    const l = await insertListing("facebook", 6800);
    const renewFacebook = vi.fn(async (): Promise<AndroidResult> => ({ status: "failed", step: "renew listing", reason: "no Renew" }));
    const repriceFacebook = vi.fn(async () => DONE);
    const res = await facebookRenewThenReprice(db, itemId, l.id, { renewFacebook, repriceFacebook }, NOW);
    expect(res).toEqual({ status: "failed", step: "renew listing", reason: "no Renew" });
    expect(repriceFacebook).not.toHaveBeenCalled();
    const row = await getListing(l.id);
    expect(row.renewedAt).toBeNull();
    expect(row.listedPrice).toBe(6800);
  });

  it("renews without repricing when the live price already matches", async () => {
    const l = await insertListing("facebook", 6596);
    const repriceFacebook = vi.fn(async () => DONE);
    const res = await facebookRenewThenReprice(db, itemId, l.id, { renewFacebook: async () => DONE, repriceFacebook }, NOW);
    expect(res).toEqual(DONE);
    expect(repriceFacebook).not.toHaveBeenCalled();
    expect((await getListing(l.id)).renewedAt).toBe("2026-07-10 12:00:00");
  });

  it("renews, reprices and syncs the listed price when they differ", async () => {
    const l = await insertListing("facebook", 6800);
    const calls: string[] = [];
    const res = await facebookRenewThenReprice(
      db, itemId, l.id,
      {
        renewFacebook: async () => { calls.push("renew"); return DONE; },
        repriceFacebook: async () => { calls.push("reprice"); return DONE; },
      },
      NOW
    );
    expect(res).toEqual(DONE);
    expect(calls).toEqual(["renew", "reprice"]);
    const row = await getListing(l.id);
    expect(row.renewedAt).toBe("2026-07-10 12:00:00");
    expect(row.listedPrice).toBe(6596);
  });

  it("keeps the renew but not the price when the reprice fails", async () => {
    const l = await insertListing("facebook", 6800);
    const res = await facebookRenewThenReprice(
      db, itemId, l.id,
      {
        renewFacebook: async () => DONE,
        repriceFacebook: async () => ({ status: "failed", step: "set price", reason: "no node", screenshot: "/d/p.png" }),
      },
      NOW
    );
    expect(res).toEqual({
      status: "failed", step: "reprice",
      reason: "renewed; reprice failed: set price: no node", screenshot: "/d/p.png",
    });
    const row = await getListing(l.id);
    expect(row.renewedAt).toBe("2026-07-10 12:00:00");
    expect(row.listedPrice).toBe(6800);
  });

  it("turns a thrown runner error into a failed result", async () => {
    const l = await insertListing("facebook", 6800);
    const res = await facebookRenewThenReprice(
      db, itemId, l.id,
      { renewFacebook: async () => { throw new Error("adb gone"); }, repriceFacebook: async () => DONE },
      NOW
    );
    expect(res).toEqual({ status: "failed", step: "unknown", reason: "adb gone" });
  });
});
