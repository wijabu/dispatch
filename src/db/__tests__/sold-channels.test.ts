import { describe, expect, it } from "vitest";
import { SOLD_CHANNELS } from "../schema";

describe("SOLD_CHANNELS", () => {
  it("includes the shipped watch channels", () => {
    expect(SOLD_CHANNELS).toContain("reddit-watchexchange");
    expect(SOLD_CHANNELS).toContain("watchuseek");
  });
  it("keeps the original local channels", () => {
    expect(SOLD_CHANNELS).toEqual(
      expect.arrayContaining(["offerup", "facebook", "craigslist", "other"])
    );
  });
});
