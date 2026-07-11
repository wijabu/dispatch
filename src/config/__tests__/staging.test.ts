import { describe, expect, it } from "vitest";
import { AUTOFILL_CHANNELS, STAGING, buildStagedBundle } from "../staging";

describe("staging config", () => {
  // Live acceptance (2026-07-11): only Craigslist permits auto-fill. Watchuseek
  // is Tollbit-gated and OfferUp deprecated web posting, so both are switched
  // off (their fill scripts stay registered in case either reopens).
  it("enables auto-fill only where the site permits it (Craigslist)", () => {
    expect(AUTOFILL_CHANNELS).toEqual({
      craigslist: true,
      watchuseek: false,
      offerup: false,
    });
  });

  it("uses Firefox as the dedicated Facebook browser", () => {
    expect(STAGING.dedicatedBrowser).toBe("Firefox");
    expect(STAGING.facebookCreateUrl).toBe(
      "https://www.facebook.com/marketplace/create/item"
    );
    expect(STAGING.redditSubmitUrl).toBe(
      "https://www.reddit.com/r/Watchexchange/submit"
    );
  });

  it("builds the staged bundle as title, blank line, body", () => {
    const bundle = buildStagedBundle({
      title: "Rolex Explorer 124270",
      body: "Great watch.\n\nPrice: $6,800",
      warnings: [],
    });
    expect(bundle).toBe("Rolex Explorer 124270\n\nGreat watch.\n\nPrice: $6,800");
  });
});
