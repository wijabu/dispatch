import { describe, expect, it } from "vitest";
import { craigslist } from "../craigslist";
import { LOCAL_PICKUP_TERMS } from "../helpers";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

describe("craigslist.generate", () => {
  it("appends the local-pickup terms (Craigslist is local pickup)", () => {
    expect(craigslist.generate(makeItem(deskOverrides), makePhotos(2)).body).toContain(LOCAL_PICKUP_TERMS);
  });

  it("title is the item name only (CL appends the price itself)", () => {
    const result = craigslist.generate(makeItem(deskOverrides), makePhotos(2));
    expect(result.title).toBe("IKEA Bekant Standing Desk");
    expect(result.warnings).toEqual([]);
  });

  it("title is the item name regardless of price", () => {
    const result = craigslist.generate(makeItem({ askingPrice: null }), makePhotos(1));
    expect(result.title).toBe("Rolex Explorer 124270");
  });

  it("warns when title exceeds 70 characters", () => {
    // 75-char name, no price suffix, = 75-char title
    const result = craigslist.generate(makeItem({ name: "z".repeat(75) }), makePhotos(1));
    expect(result.warnings).toContain("Title exceeds Craigslist's 70-character limit (75)");
  });

  it("includes condition and specs in the body", () => {
    const result = craigslist.generate(makeItem(), makePhotos(3));
    expect(result.body).toContain("Condition: Excellent");
    expect(result.body).toContain("Brand: Rolex");
  });
});
