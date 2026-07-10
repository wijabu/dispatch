import { describe, expect, it } from "vitest";
import { formatUsd, specLines, conditionLabel, commonWarnings } from "../helpers";
import { makeItem, makePhotos } from "./fixtures";

describe("formatUsd", () => {
  it("formats whole dollars without cents", () => {
    expect(formatUsd(6800)).toBe("$6,800");
    expect(formatUsd(120)).toBe("$120");
  });
  it("keeps cents when present", () => {
    expect(formatUsd(95.5)).toBe("$95.50");
  });
  it("returns null for null", () => {
    expect(formatUsd(null)).toBeNull();
  });
});

describe("specLines", () => {
  it("renders attribute key/value lines in insertion order", () => {
    expect(specLines(makeItem())).toEqual([
      "Brand: Rolex",
      "Model: Explorer",
      "Reference: 124270",
      "Movement: Automatic",
      "Diameter: 36mm",
      "Box/Papers: Full Set",
    ]);
  });
  it("returns empty array when item has no attributes", () => {
    expect(specLines(makeItem({ attributes: {} }))).toEqual([]);
  });
});

describe("conditionLabel", () => {
  it("maps condition to display label", () => {
    expect(conditionLabel(makeItem())).toBe("Excellent");
    expect(conditionLabel(makeItem({ condition: "like_new" }))).toBe("Like new");
  });
});

describe("commonWarnings", () => {
  it("is empty for a complete item with photos", () => {
    expect(commonWarnings(makeItem(), makePhotos(3))).toEqual([]);
  });
  it("flags missing price and missing photos", () => {
    expect(commonWarnings(makeItem({ askingPrice: null }), makePhotos(0))).toEqual([
      "No asking price set",
      "No photos",
    ]);
  });
});
