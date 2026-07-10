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
    expect(tasks).toEqual([]);
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
  const published = { id: 1, status: "published" as const, askingPrice: 6800 };

  it("suggests delete-repost relist on OfferUp after 7 days", () => {
    const item = makeItem(published);
    const tasks = computeTasks(
      inputs({ items: [item], activeListings: [makeListing({ listedAt: "2026-07-01 12:00:00" })] })
    );
    expect(tasks).toContainEqual({
      type: "relist", itemId: 1, itemName: item.name, listingId: 1,
      publisherId: "offerup", publisherName: "OfferUp", action: "relist", ageDays: 9,
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

  it("facebook: fresh relist once listing is 42+ days old", () => {
    const item = makeItem(published);
    const listing = makeListing({
      publisher: "facebook", listedAt: "2026-05-20 12:00:00", renewedAt: "2026-07-01 12:00:00",
    });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks.find((t) => t.type === "relist")).toMatchObject({ action: "relist" });
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
});

describe("computeTasks — stale_price", () => {
  it("flags an active listing whose price differs from asking", () => {
    const item = makeItem({ id: 1, status: "published", askingPrice: 6596 });
    const listing = makeListing({ listedPrice: 6800, listedAt: "2026-07-09 12:00:00" });
    const tasks = computeTasks(inputs({ items: [item], activeListings: [listing] }));
    expect(tasks).toContainEqual({
      type: "stale_price", itemId: 1, itemName: item.name, listingId: 1,
      publisherId: "offerup", publisherName: "OfferUp", listedPrice: 6800, askingPrice: 6596,
    });
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
});

describe("computeTasks — ordering", () => {
  it("orders price_drop, stale_price, relist, ready_to_publish", () => {
    const dropItem = makeItem({
      id: 1, status: "published", askingPrice: 100, minimumPrice: 50,
      dropAmount: 10, dropIntervalDays: 7, createdAt: "2026-06-01 12:00:00",
    });
    const readyItem = makeItem({ id: 2, status: "ready" });
    const listing = makeListing({ itemId: 1, listedPrice: 90, listedAt: "2026-07-01 12:00:00" });
    const types = computeTasks(
      inputs({ items: [dropItem, readyItem], activeListings: [listing] })
    ).map((t) => t.type);
    expect(types).toEqual(["price_drop", "stale_price", "relist", "ready_to_publish"]);
  });
});
