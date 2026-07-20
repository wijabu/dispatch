import { describe, expect, it } from "vitest";
import type { Listing } from "@/db/schema";
import { makeItem } from "@/publishers/__tests__/fixtures";
import { publishers } from "@/publishers";
import { computeDropTarget, computeTasks, daysBetween, parseDbDate } from "../tasks";

const NOW = new Date("2026-07-10T12:00:00Z");

function inputs(overrides: Partial<Parameters<typeof computeTasks>[0]> = {}) {
  return {
    items: [],
    activeListings: [],
    lastPriceChange: new Map<number, string>(),
    publishers,
    now: NOW,
    ...overrides,
  };
}

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 1,
    itemId: 1,
    publisher: "offerup",
    url: null,
    listedPrice: 6800,
    status: "active",
    listedAt: "2026-07-01 12:00:00",
    renewedAt: null,
    endedAt: null,
    ...overrides,
  };
}

describe("parseDbDate", () => {
  it("parses sqlite 'YYYY-MM-DD HH:MM:SS' as UTC", () => {
    expect(parseDbDate("2026-07-01 12:00:00").toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });
  it("parses ISO strings unchanged", () => {
    expect(parseDbDate("2026-07-01T12:00:00.000Z").toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });
  it("parses bare dates as UTC midnight", () => {
    expect(parseDbDate("2026-07-01").toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("daysBetween", () => {
  it("floors to whole days", () => {
    expect(daysBetween(parseDbDate("2026-07-01 12:00:00"), NOW)).toBe(9);
    expect(daysBetween(parseDbDate("2026-07-03 13:00:00"), NOW)).toBe(6); // 6.96 days → 6
  });
});

describe("computeDropTarget", () => {
  it("percent drop rounds to nearest dollar", () => {
    const item = makeItem({ askingPrice: 6800, dropPercent: 3, minimumPrice: 6200 });
    expect(computeDropTarget(item)).toBe(6596);
  });
  it("dollar drop", () => {
    const item = makeItem({ askingPrice: 100, dropAmount: 5, minimumPrice: 80 });
    expect(computeDropTarget(item)).toBe(95);
  });
  it("clamps to minimum price", () => {
    const item = makeItem({ askingPrice: 82, dropAmount: 10, minimumPrice: 80 });
    expect(computeDropTarget(item)).toBe(80);
  });
  it("no target at or below minimum", () => {
    expect(computeDropTarget(makeItem({ askingPrice: 80, dropAmount: 10, minimumPrice: 80 }))).toBeNull();
  });
  it("no target without asking price or without any drop field", () => {
    expect(computeDropTarget(makeItem({ askingPrice: null, dropAmount: 5 }))).toBeNull();
    expect(computeDropTarget(makeItem({ askingPrice: 100 }))).toBeNull();
  });
  it("uncapped when no minimum set", () => {
    expect(computeDropTarget(makeItem({ askingPrice: 100, dropAmount: 30, minimumPrice: null }))).toBe(70);
  });
});

describe("computeTasks — price_drop", () => {
  const cadence = {
    id: 1,
    status: "published" as const,
    askingPrice: 6800,
    minimumPrice: 6200,
    dropPercent: 3,
    dropIntervalDays: 7,
  };

  it("emits a drop task when the interval has elapsed since last price change", () => {
    const item = makeItem(cadence);
    const tasks = computeTasks(
      inputs({ items: [item], lastPriceChange: new Map([[1, "2026-07-01 12:00:00"]]) })
    );
    expect(tasks).toEqual([
      { type: "price_drop", itemId: 1, itemName: item.name, currentPrice: 6800, targetPrice: 6596 },
    ]);
  });

  it("no task before the interval elapses", () => {
    const item = makeItem(cadence);
    const tasks = computeTasks(
      inputs({ items: [item], lastPriceChange: new Map([[1, "2026-07-05 12:00:00"]]) })
    );
    expect(tasks.filter((t) => t.type === "price_drop")).toEqual([]);
  });

  it("emits a drop exactly at the interval boundary", () => {
    const item = makeItem(cadence);
    const tasks = computeTasks(
      inputs({ items: [item], lastPriceChange: new Map([[1, "2026-07-03 12:00:00"]]) })
    );
    expect(tasks).toEqual([
      { type: "price_drop", itemId: 1, itemName: item.name, currentPrice: 6800, targetPrice: 6596 },
    ]);
  });

  it("falls back to createdAt when no price history exists", () => {
    const item = makeItem({ ...cadence, createdAt: "2026-06-01 12:00:00" });
    expect(computeTasks(inputs({ items: [item] }))).toHaveLength(1);
  });

  it("snoozed items emit nothing", () => {
    const item = makeItem({ ...cadence, snoozedUntil: "2026-07-15" });
    const tasks = computeTasks(
      inputs({ items: [item], lastPriceChange: new Map([[1, "2026-06-01 12:00:00"]]) })
    );
    expect(tasks).toEqual([]);
  });

  it("expired snooze no longer suppresses", () => {
    const item = makeItem({ ...cadence, snoozedUntil: "2026-07-09" });
    const tasks = computeTasks(
      inputs({ items: [item], lastPriceChange: new Map([[1, "2026-06-01 12:00:00"]]) })
    );
    expect(tasks).toHaveLength(1);
  });

  it("only published items participate", () => {
    for (const status of ["draft", "ready", "sold", "archived"] as const) {
      const item = makeItem({ ...cadence, status });
      const tasks = computeTasks(
        inputs({ items: [item], lastPriceChange: new Map([[1, "2026-06-01 12:00:00"]]) })
      );
      expect(tasks.filter((t) => t.type === "price_drop")).toEqual([]);
    }
  });
});

describe("computeTasks — relist", () => {
  // At floor (askingPrice === minimumPrice) so these cadence/policy cases
  // clear the drop-to-floor-then-relist gate on their own merits.
  const published = { id: 1, status: "published" as const, askingPrice: 6800, minimumPrice: 6800 };

  it("suggests delete-repost relist on OfferUp after 7 days", () => {
    const item = makeItem(published);
    const tasks = computeTasks(
      inputs({ items: [item], activeListings: [makeListing({ listedAt: "2026-07-01 12:00:00" })] })
    );
    expect(tasks).toContainEqual({
      type: "relist", itemId: 1, itemName: item.name, listingId: 1,
      publisherId: "offerup", publisherName: "OfferUp", listingUrl: null, action: "relist", ageDays: 9,
    });
  });

  it("nothing before the channel interval", () => {
    const item = makeItem(published);
    const tasks = computeTasks(
      inputs({ items: [item], activeListings: [makeListing({ listedAt: "2026-07-05 12:00:00" })] })
    );
    expect(tasks.filter((t) => t.type === "relist")).toEqual([]);
  });

  it("reddit never suggests inside its 7-day hard cooldown", () => {
    const item = makeItem(published);
    const listing = makeListing({ publisher: "reddit-watchexchange", listedAt: "2026-07-04 12:00:00" });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.filter((t) => t.type === "relist")).toEqual([]);
  });

  it("facebook: renew action measured from renewedAt", () => {
    const item = makeItem(published);
    const listing = makeListing({
      publisher: "facebook", listedAt: "2026-06-20 12:00:00", renewedAt: "2026-07-01 12:00:00",
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    const relist = tasks.find((t) => t.type === "relist");
    expect(relist).toMatchObject({ publisherId: "facebook", action: "renew", ageDays: 9 });
  });

  it("facebook: renew-only — still renews (never reposts) even when 42+ days old", () => {
    const item = makeItem(published);
    const listing = makeListing({
      publisher: "facebook", listedAt: "2026-05-20 12:00:00", renewedAt: "2026-07-01 12:00:00",
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.find((t) => t.type === "relist")).toMatchObject({ action: "renew" });
  });

  it("recent renew suppresses even an old listing (unless fresh-relist due)", () => {
    const item = makeItem(published);
    const listing = makeListing({
      publisher: "facebook", listedAt: "2026-06-25 12:00:00", renewedAt: "2026-07-08 12:00:00",
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.filter((t) => t.type === "relist")).toEqual([]);
  });

  it("snoozed item suppresses relist tasks too", () => {
    const item = makeItem({ ...published, snoozedUntil: "2026-07-20" });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [makeListing()] }));
    expect(tasks).toEqual([]);
  });

  it("unknown publisher id in ledger is skipped silently", () => {
    const item = makeItem(published);
    const listing = makeListing({ publisher: "ebay-legacy" });
    expect(computeTasks(inputs({ items: [item], activeListings: [listing] }))).toEqual([]);
  });

  it("offerup ignores renewedAt (delete-repost channel) — anchor stays listedAt", () => {
    const item = makeItem(published);
    const listing = makeListing({
      listedAt: "2026-07-01 12:00:00", // 9 days old
      renewedAt: "2026-07-09 12:00:00", // 1 day ago — must not reset the clock
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks).toContainEqual({
      type: "relist", itemId: 1, itemName: item.name, listingId: 1,
      publisherId: "offerup", publisherName: "OfferUp", listingUrl: null, action: "relist", ageDays: 9,
    });
  });

  it("hard minimum interval suppresses even a due fresh relist", () => {
    const item = makeItem(published);
    // listed 51 days ago (fresh relist due) but renewed 3 days ago —
    // inside Facebook's 7-day hard window, so nothing may be suggested
    const listing = makeListing({
      publisher: "facebook",
      listedAt: "2026-05-20 12:00:00",
      renewedAt: "2026-07-07 12:00:00",
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.filter((t) => t.type === "relist")).toEqual([]);
  });

  it("suppresses relist while the item can still drop (above floor)", () => {
    const item = makeItem({ id: 1, status: "published", askingPrice: 100, minimumPrice: 50 });
    const listing = makeListing({ itemId: 1, listedAt: "2026-05-01 12:00:00" }); // well overdue
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.some((t) => t.type === "relist" && t.itemId === 1)).toBe(false);
  });

  it("emits relist once the item is at its floor and cadence is due", () => {
    const item = makeItem({ id: 1, status: "published", askingPrice: 50, minimumPrice: 50 });
    const listing = makeListing({ itemId: 1, listedAt: "2026-05-01 12:00:00" }); // well overdue
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.some((t) => t.type === "relist" && t.itemId === 1)).toBe(true);
  });

  it("no relist when minimum price is null — item never reaches a floor", () => {
    const item = makeItem({ id: 1, status: "published", askingPrice: 50, minimumPrice: null });
    const listing = makeListing({ itemId: 1, listedAt: "2026-05-01 12:00:00" }); // well overdue
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.filter((t) => t.type === "relist")).toEqual([]);
  });
});

describe("computeTasks — stale_price", () => {
  it("flags an active listing whose price differs from asking", () => {
    const item = makeItem({ id: 1, status: "published", askingPrice: 6596 });
    const listing = makeListing({ listedPrice: 6800, listedAt: "2026-07-09 12:00:00" });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks).toContainEqual({
      type: "stale_price", itemId: 1, itemName: item.name, listingId: 1,
      publisherId: "offerup", publisherName: "OfferUp", listingUrl: null, listedPrice: 6800, askingPrice: 6596,
    });
  });

  it("passes the listing url through on stale_price and relist tasks", () => {
    // At floor so the relist gate is satisfied alongside the stale price.
    const item = makeItem({ id: 1, status: "published", askingPrice: 6596, minimumPrice: 6596 });
    const listing = makeListing({
      listedPrice: 6800,
      listedAt: "2026-07-01 12:00:00",
      url: "https://facebook.com/marketplace/item/123",
      publisher: "facebook",
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    const stale = tasks.find((t) => t.type === "stale_price");
    const relist = tasks.find((t) => t.type === "relist");
    expect(stale).toMatchObject({ listingUrl: "https://facebook.com/marketplace/item/123" });
    expect(relist).toMatchObject({ listingUrl: "https://facebook.com/marketplace/item/123" });
  });

  it("null listedPrice counts as stale when asking exists", () => {
    const item = makeItem({ id: 1, status: "published", askingPrice: 100 });
    const listing = makeListing({ listedPrice: null, listedAt: "2026-07-09 12:00:00" });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.filter((t) => t.type === "stale_price")).toHaveLength(1);
  });

  it("matching price → no task; null asking → no task", () => {
    const matching = makeItem({ id: 1, status: "published", askingPrice: 6800 });
    const noAsk = makeItem({ id: 1, status: "published", askingPrice: null });
    const listing = makeListing({ listedPrice: 6800, listedAt: "2026-07-09 12:00:00" });
    expect(computeTasks(inputs({ items: [matching], activeListings: [listing] }))
      .filter((t) => t.type === "stale_price")).toEqual([]);
    expect(computeTasks(inputs({ items: [noAsk], activeListings: [listing] }))
      .filter((t) => t.type === "stale_price")).toEqual([]);
  });
});

describe("computeTasks — ready_to_publish", () => {
  it("nudges ready items with no active listings", () => {
    const item = makeItem({ id: 2, status: "ready" });
    const tasks = computeTasks(inputs({ items: [item] }));
    expect(tasks).toEqual([{ type: "ready_to_publish", itemId: 2, itemName: item.name }]);
  });

  it("no nudge when an active listing exists, or when snoozed", () => {
    const item = makeItem({ id: 2, status: "ready" });
    const listed = computeTasks(
      inputs({ items: [item], activeListings: [makeListing({ itemId: 2, listedAt: "2026-07-09 12:00:00" })] })
    );
    expect(listed.filter((t) => t.type === "ready_to_publish")).toEqual([]);
    const snoozed = makeItem({ id: 2, status: "ready", snoozedUntil: "2026-08-01" });
    expect(computeTasks(inputs({ items: [snoozed] }))).toEqual([]);
  });

  it("nudges published items with no active listings too (ended-listing fallthrough)", () => {
    const item = makeItem({ id: 3, status: "published", askingPrice: 500 });
    const tasks = computeTasks(inputs({ items: [item] }));
    expect(tasks).toEqual([{ type: "ready_to_publish", itemId: 3, itemName: item.name }]);
  });

  it("a due price drop takes precedence — no nudge alongside it", () => {
    const item = makeItem({
      id: 3, status: "published", askingPrice: 6800, minimumPrice: 6200,
      dropPercent: 3, dropIntervalDays: 7,
    });
    const tasks = computeTasks(
      inputs({ items: [item], lastPriceChange: new Map([[3, "2026-07-01 12:00:00"]]) })
    );
    expect(tasks).toEqual([
      { type: "price_drop", itemId: 3, itemName: item.name, currentPrice: 6800, targetPrice: 6596 },
    ]);
  });
});

describe("computeTasks — ordering", () => {
  it("orders price_drop, stale_price, relist, ready_to_publish", () => {
    // price_drop and relist are mutually exclusive on one item post-gate
    // (drop fires above floor, relist fires at floor), so two items are
    // needed to exercise all four task types together.
    const dropItem = makeItem({
      id: 1, status: "published", askingPrice: 100, minimumPrice: 50,
      dropAmount: 10, dropIntervalDays: 7, createdAt: "2026-06-01 12:00:00",
    });
    const relistItem = makeItem({ id: 4, status: "published", askingPrice: 50, minimumPrice: 50 });
    const readyItem = makeItem({ id: 2, status: "ready" });
    const dropListing = makeListing({ itemId: 1, listedPrice: 90, listedAt: "2026-07-01 12:00:00" });
    const relistListing = makeListing({ id: 2, itemId: 4, listedPrice: 50, listedAt: "2026-05-01 12:00:00" });
    const types = computeTasks(
      inputs({ items: [dropItem, relistItem, readyItem], activeListings: [dropListing, relistListing] })
    ).map((t) => t.type);
    expect(types).toEqual(["price_drop", "stale_price", "relist", "ready_to_publish"]);
  });
});
