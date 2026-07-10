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
});
