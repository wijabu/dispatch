import { describe, expect, it } from "vitest";
import { craigslist } from "../craigslist";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

describe("craigslist.generate", () => {
  it("builds title with price suffix", () => {
    const result = craigslist.generate(makeItem(deskOverrides), makePhotos(2));
    expect(result.title).toBe("IKEA Bekant Standing Desk - $120");
    expect(result.warnings).toEqual([]);
  });

  it("omits price suffix when no price", () => {
    const result = craigslist.generate(makeItem({ askingPrice: null }), makePhotos(1));
    expect(result.title).toBe("Rolex Explorer 124270");
  });

  it("warns when title exceeds 70 characters", () => {
    // 75-char name + " - $6,800" suffix (9 chars) = 84-char rendered title
    const result = craigslist.generate(makeItem({ name: "z".repeat(75) }), makePhotos(1));
    expect(result.warnings).toContain("Title exceeds Craigslist's 70-character limit (84)");
  });

  it("includes condition and specs in the body", () => {
    const result = craigslist.generate(makeItem(), makePhotos(3));
    expect(result.body).toContain("Condition: Excellent");
    expect(result.body).toContain("Brand: Rolex");
  });
});
