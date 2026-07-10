import { describe, expect, it } from "vitest";
import { offerup } from "../offerup";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

describe("offerup.generate", () => {
  it("uses the item name as title and provides structured fields", () => {
    const result = offerup.generate(makeItem(), makePhotos(3));
    expect(result.title).toBe("Rolex Explorer 124270");
    expect(result.structuredFields).toEqual({ Price: "6800", Condition: "Excellent" });
    expect(result.warnings).toEqual([]);
  });

  it("includes condition and specs in the body", () => {
    const result = offerup.generate(makeItem(), makePhotos(3));
    expect(result.body).toContain("Condition: Excellent");
    expect(result.body).toContain("Reference: 124270");
  });

  it("warns when the title exceeds 80 characters", () => {
    const longName = "x".repeat(90);
    const result = offerup.generate(makeItem({ name: longName }), makePhotos(1));
    expect(result.warnings).toContain("Title exceeds OfferUp's 80-character limit (90)");
  });

  it("warns when photo count exceeds 12", () => {
    const result = offerup.generate(makeItem(), makePhotos(15));
    expect(result.warnings).toContain("OfferUp allows up to 12 photos; you have 15");
  });

  it("handles a bare desk item", () => {
    const result = offerup.generate(makeItem(deskOverrides), makePhotos(2));
    expect(result.title).toBe("IKEA Bekant Standing Desk");
    expect(result.structuredFields).toEqual({ Price: "120", Condition: "Like new" });
  });
});
