import { describe, expect, it } from "vitest";
import { fillScripts, getFillScript } from "../index";
import { AUTOFILL_CHANNELS } from "@/config/staging";
import { getPublisher } from "@/publishers";

describe("automation registry", () => {
  it("registers a fill script for exactly the configured auto-fill channels", () => {
    expect(fillScripts.map((s) => s.publisherId).sort()).toEqual(
      Object.keys(AUTOFILL_CHANNELS).sort()
    );
  });

  it("every fill script maps to a real publisher and has a start URL", () => {
    for (const s of fillScripts) {
      expect(getPublisher(s.publisherId), s.publisherId).toBeDefined();
      expect(s.startUrl).toMatch(/^https:\/\//);
    }
  });

  it("looks up by id", () => {
    expect(getFillScript("craigslist")?.publisherId).toBe("craigslist");
    expect(getFillScript("facebook")).toBeUndefined();
  });
});
