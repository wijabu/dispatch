import { describe, expect, it } from "vitest";
import { redditWatchexchange } from "../reddit-watchexchange";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

describe("redditWatchexchange.generate", () => {
  it("builds the [WTS] title with price and Box/Papers", () => {
    const result = redditWatchexchange.generate(makeItem(), makePhotos(3));
    expect(result.title).toBe("[WTS] Rolex Explorer 124270 | $6,800 | Full Set");
    expect(result.warnings).toEqual([]);
  });

  it("includes description, spec block, condition, and price in the body", () => {
    const result = redditWatchexchange.generate(makeItem(), makePhotos(3));
    expect(result.body).toContain("Excellent condition Explorer, purchased 2022.");
    expect(result.body).toContain("* Reference: 124270");
    expect(result.body).toContain("Condition: Excellent");
    expect(result.body).toContain("Price: $6,800 shipped CONUS");
  });

  it("degrades for a bare item: no Box/Papers segment, no spec block", () => {
    const result = redditWatchexchange.generate(makeItem(deskOverrides), makePhotos(1));
    expect(result.title).toBe("[WTS] IKEA Bekant Standing Desk | $120");
    expect(result.body).not.toContain("Specs:");
  });

  it("omits price segment and warns when no price is set", () => {
    const result = redditWatchexchange.generate(makeItem({ askingPrice: null }), makePhotos(1));
    expect(result.title).toBe("[WTS] Rolex Explorer 124270 | Full Set");
    expect(result.warnings).toContain("No asking price set");
  });
});
