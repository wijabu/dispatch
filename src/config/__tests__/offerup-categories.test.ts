import { describe, expect, it } from "vitest";
import { OFFERUP_CATEGORIES, offerupSubcategories } from "../offerup-categories";

describe("offerup categories", () => {
  it("has all 12 top-level categories", () => {
    expect(OFFERUP_CATEGORIES).toHaveLength(12);
    expect(OFFERUP_CATEGORIES.map((c) => c.name)).toContain("Home & Garden");
  });

  it("furniture lives under Home & Garden", () => {
    expect(offerupSubcategories("Home & Garden")).toContain("Furniture");
  });

  it("watches live under Clothing, Shoes, & Accessories -> Jewelry & Accessories", () => {
    expect(offerupSubcategories("Clothing, Shoes, & Accessories")).toContain(
      "Jewelry & Accessories"
    );
  });

  it("each category ends with an Other- entry", () => {
    for (const c of OFFERUP_CATEGORIES) {
      expect(c.subcategories.some((s) => s.startsWith("Other - "))).toBe(true);
    }
  });

  it("unknown category returns empty", () => {
    expect(offerupSubcategories("Nope")).toEqual([]);
  });
});
