import { describe, expect, it } from "vitest";
import { CATEGORY_SUGGESTIONS } from "../categories";

describe("watch attribute chips", () => {
  it("offers the r/WatchExchange spec-block fields", () => {
    const w = CATEGORY_SUGGESTIONS.watches;
    for (const f of ["Variant", "Thickness", "Lug Width", "Lug-to-Lug", "Water Resistance", "Condition Rating", "Kit Contents"]) {
      expect(w).toContain(f);
    }
  });
  it("keeps the original watch chips", () => {
    expect(CATEGORY_SUGGESTIONS.watches).toEqual(
      expect.arrayContaining(["Brand", "Model", "Reference", "Diameter", "Movement", "Year"])
    );
  });
});
