import { describe, expect, it } from "vitest";
import { facebookMarketplace } from "../facebook";
import { makeItem, makePhotos } from "./fixtures";

describe("facebookMarketplace.generate", () => {
  it("uses the item name as title with structured fields", () => {
    const result = facebookMarketplace.generate(makeItem(), makePhotos(3));
    expect(result.title).toBe("Rolex Explorer 124270");
    expect(result.structuredFields).toEqual({
      Price: "6800",
      Condition: "Excellent",
      Category: "watches",
    });
    expect(result.warnings).toEqual([]);
  });

  it("includes description and specs in the body", () => {
    const result = facebookMarketplace.generate(makeItem(), makePhotos(3));
    expect(result.body).toContain("Excellent condition Explorer");
    expect(result.body).toContain("Diameter: 36mm");
  });

  it("warns when the title exceeds 99 characters", () => {
    const result = facebookMarketplace.generate(makeItem({ name: "y".repeat(120) }), makePhotos(1));
    expect(result.warnings).toContain("Title exceeds Facebook's 99-character limit (120)");
  });
});
