import { describe, expect, it } from "vitest";
import { AUTOFILL_CHANNELS, STAGING, buildStagedBundle } from "../staging";

describe("staging config", () => {
  it("declares kill switches for exactly the three auto-fill channels", () => {
    expect(AUTOFILL_CHANNELS).toEqual({
      craigslist: true,
      watchuseek: true,
      offerup: true,
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
