import { describe, expect, it } from "vitest";
import { watchuseek } from "../watchuseek";
import { LOCAL_PICKUP_TERMS } from "../helpers";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

describe("watchuseek.generate", () => {
  it("does NOT append local-pickup terms (shipped CONUS, not local)", () => {
    expect(watchuseek.generate(makeItem(), makePhotos(3)).body).not.toContain(LOCAL_PICKUP_TERMS);
  });

  it("builds an FS: title with price", () => {
    const result = watchuseek.generate(makeItem(), makePhotos(3));
    expect(result.title).toBe("FS: Rolex Explorer 124270 - $6,800");
    expect(result.warnings).toEqual([]);
  });

  it("includes a Specifications block and payment line in the body", () => {
    const result = watchuseek.generate(makeItem(), makePhotos(3));
    expect(result.body).toContain("Specifications:");
    expect(result.body).toContain("- Movement: Automatic");
    expect(result.body).toContain("Asking $6,800 shipped and insured, CONUS.");
  });

  it("degrades without price or attributes", () => {
    const result = watchuseek.generate(
      makeItem({ ...deskOverrides, askingPrice: null }),
      makePhotos(1)
    );
    expect(result.title).toBe("FS: IKEA Bekant Standing Desk");
    expect(result.body).not.toContain("Specifications:");
    expect(result.warnings).toContain("No asking price set");
  });
});
