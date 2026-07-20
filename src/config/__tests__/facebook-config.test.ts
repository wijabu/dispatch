import { describe, expect, it } from "vitest";
import { CONDITION_MAP, FACEBOOK_CONDITIONS } from "../facebook";
import { CONDITIONS } from "@/db/schema";

describe("facebook config", () => {
  it("maps every Dispatch condition to a captured Facebook label", () => {
    for (const c of CONDITIONS) {
      expect(FACEBOOK_CONDITIONS).toContain(CONDITION_MAP[c]);
    }
  });

  it("exposes the captured condition labels", () => {
    expect(FACEBOOK_CONDITIONS).toEqual([
      "New",
      "Used - Like New",
      "Used - Good",
      "Used - Fair",
    ]);
  });
});
