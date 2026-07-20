import { describe, expect, it } from "vitest";
import { formatUsd, specLines, conditionLabel, commonWarnings, formatDescription } from "../helpers";
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

describe("formatDescription", () => {
  it("puts a blank line between sentences", () => {
    expect(formatDescription("First sentence. Second sentence.")).toBe(
      "First sentence.\n\nSecond sentence."
    );
  });

  it("puts a blank line before each bullet", () => {
    expect(formatDescription("Intro line • First bullet • Second bullet")).toBe(
      "Intro line\n\n• First bullet\n\n• Second bullet"
    );
  });

  it("does not split on decimals or inch-marks", () => {
    expect(
      formatDescription('Desktop is 23.6" wide and 47" long. It is sturdy.')
    ).toBe('Desktop is 23.6" wide and 47" long.\n\nIt is sturdy.');
  });

  it("preserves blank-line breaks the author already made", () => {
    expect(formatDescription("Heading line\n\nBody sentence.")).toBe(
      "Heading line\n\nBody sentence."
    );
  });

  it("leaves a single simple sentence unchanged", () => {
    expect(formatDescription("A nice desk in great shape")).toBe(
      "A nice desk in great shape"
    );
  });

  it("collapses stray internal whitespace within a sentence", () => {
    expect(formatDescription("Too    many   spaces here.")).toBe("Too many spaces here.");
  });

  it("returns an empty string for null/undefined/blank", () => {
    expect(formatDescription(null)).toBe("");
    expect(formatDescription(undefined)).toBe("");
    expect(formatDescription("   ")).toBe("");
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
