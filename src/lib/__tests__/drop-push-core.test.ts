import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "@/db/schema";
import { items, listings, priceHistory } from "@/db/schema";
import type { AndroidResult } from "@/automation/android/types";
import { dropAndPushCore, facebookRenewThenReprice, type PushRunners } from "../drop-push-core";

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
      status: "failed", step: "renewed; reprice failed",
      reason: "set price: no node", screenshot: "/d/p.png",
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

// The item starts at 6800 (beforeEach sets 6596 for the FB helper tests).
async function resetTo6800() {
  await db.update(items).set({ askingPrice: 6800 }).where(eq(items.id, itemId));
}

function fakeRunners(overrides: Partial<PushRunners> = {}) {
  const calls: string[] = [];
  const ok = (name: string) => vi.fn(async (): Promise<AndroidResult> => { calls.push(name); return DONE; });
  const runners: PushRunners = {
    repriceOfferup: ok("repriceOfferup"),
    relistOfferup: ok("relistOfferup"),
    repriceFacebook: ok("repriceFacebook"),
    renewFacebook: ok("renewFacebook"),
    ...overrides,
  };
  return { runners, calls };
}

describe("dropAndPushCore", () => {
  beforeEach(resetTo6800);

  it("drops the price once and reprices every channel", async () => {
    const ou = await insertListing("offerup", 6800);
    const fb = await insertListing("facebook", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.newPrice).toBe(6596);
    expect(res.channels.map((c) => [c.channel, c.outcome])).toEqual([
      ["offerup", "repriced"], ["facebook", "repriced"],
    ]);
    expect(calls).toEqual(["repriceOfferup", "repriceFacebook"]);
    const history = await db.select().from(priceHistory).where(eq(priceHistory.itemId, itemId));
    expect(history).toHaveLength(1);
    expect((await getListing(ou.id)).listedPrice).toBe(6596);
    expect((await getListing(fb.id)).listedPrice).toBe(6596);
  });

  it("orders OfferUp before Facebook regardless of insert order", async () => {
    await insertListing("facebook", 6800);
    await insertListing("offerup", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels.map((c) => c.channel)).toEqual(["offerup", "facebook"]);
    expect(calls).toEqual(["repriceOfferup", "repriceFacebook"]);
  });

  it("keeps going when one channel fails", async () => {
    const ou = await insertListing("offerup", 6800);
    const fb = await insertListing("facebook", 6800);
    const { runners } = fakeRunners({
      repriceOfferup: async () => ({ status: "failed", step: "set price", reason: "no node" }),
    });
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels[0]).toMatchObject({ channel: "offerup", outcome: "failed", detail: "set price: no node" });
    expect(res.channels[1]).toMatchObject({ channel: "facebook", outcome: "repriced" });
    expect((await getListing(ou.id)).listedPrice).toBe(6800);
    expect((await getListing(fb.id)).listedPrice).toBe(6596);
  });

  it("converts a thrown runner error into a failed channel", async () => {
    await insertListing("offerup", 6800);
    const { runners } = fakeRunners({ repriceOfferup: async () => { throw new Error("boom"); } });
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels[0]).toMatchObject({ channel: "offerup", outcome: "failed", detail: "unknown: boom" });
  });

  it("relist mode reposts OfferUp and renews-then-reprices Facebook", async () => {
    const ou = await insertListing("offerup", 6800);
    const fb = await insertListing("facebook", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "relist", runners, NOW);
    expect(res.channels.map((c) => [c.channel, c.outcome])).toEqual([
      ["offerup", "relisted"], ["facebook", "relisted"],
    ]);
    expect(calls).toEqual(["relistOfferup", "renewFacebook", "repriceFacebook"]);
    const ouRow = await getListing(ou.id);
    expect(ouRow.listedAt).toBe("2026-07-10 12:00:00");
    expect(ouRow.listedPrice).toBe(6596);
    const fbRow = await getListing(fb.id);
    expect(fbRow.listedAt).toBe("2026-07-01 00:00:00");
    expect(fbRow.renewedAt).toBe("2026-07-10 12:00:00");
    expect(fbRow.listedPrice).toBe(6596);
  });

  it("relist mode reports a Facebook reprice failure after a good renew", async () => {
    await insertListing("facebook", 6800);
    const { runners } = fakeRunners({
      repriceFacebook: async () => ({ status: "failed", step: "set price", reason: "no node" }),
    });
    const res = await dropAndPushCore(db, itemId, "relist", runners, NOW);
    expect(res.channels[0]).toMatchObject({
      channel: "facebook",
      outcome: "failed",
      detail: "renewed; reprice failed: set price: no node",
    });
  });

  it("marks manual channels without running anything", async () => {
    const cl = await insertListing("craigslist", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "relist", runners, NOW);
    expect(res.newPrice).toBe(6596);
    expect(res.channels).toEqual([{ channel: "craigslist", outcome: "manual", detail: "update by hand" }]);
    expect(calls).toEqual([]);
    expect((await getListing(cl.id)).listedPrice).toBe(6800);
  });

  it("ignores ended listings", async () => {
    await db.insert(listings).values({ itemId, publisher: "offerup", status: "ended", listedPrice: 6800 });
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("writes nothing when no drop is available", async () => {
    await db.update(items).set({ askingPrice: 6200 }).where(eq(items.id, itemId)); // at floor
    await insertListing("offerup", 6200);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res).toEqual({
      newPrice: null,
      channels: [{ channel: "item", outcome: "failed", detail: "no price drop available" }],
    });
    expect(calls).toEqual([]);
    const history = await db.select().from(priceHistory).where(eq(priceHistory.itemId, itemId));
    expect(history).toHaveLength(0);
  });

  it("reports a missing item", async () => {
    const { runners } = fakeRunners();
    const res = await dropAndPushCore(db, 9999, "reprice", runners, NOW);
    expect(res).toEqual({
      newPrice: null,
      channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }],
    });
  });
});
