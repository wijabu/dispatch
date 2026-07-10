import { describe, expect, it } from "vitest";
import { publishers, getPublisher } from "../index";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

describe("publisher registry", () => {
  it("registers all five v1 publishers in display order", () => {
    expect(publishers.map((p) => p.id)).toEqual([
      "offerup",
      "facebook",
      "craigslist",
      "reddit-watchexchange",
      "watchuseek",
    ]);
  });

  it("looks up publishers by id", () => {
    expect(getPublisher("offerup")?.name).toBe("OfferUp");
    expect(getPublisher("nope")).toBeUndefined();
  });

  it("every publisher generates without throwing for a bare-bones item", () => {
    const bare = makeItem({ ...deskOverrides, askingPrice: null, description: "" });
    for (const pub of publishers) {
      const result = pub.generate(bare, makePhotos(0));
      expect(result.title.length).toBeGreaterThan(0);
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });
});
