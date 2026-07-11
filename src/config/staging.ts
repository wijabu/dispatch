import type { GeneratedListing } from "@/publishers/types";

// Per-channel kill switches for Tier-1 auto-fill. Flip to false if a
// marketplace ever pushes back; staged handoff / copy-paste remain.
// Reality after live acceptance (2026-07-11): only Craigslist permits auto-fill.
//  - watchuseek: Tollbit bot gate blanks the automation browser at the origin
//    level (even the home page) → lite staged handoff instead.
//  - offerup: web posting deprecated, mobile-app-only → copy/paste floor.
export const AUTOFILL_CHANNELS: Record<string, boolean> = {
  craigslist: true,
  watchuseek: false,
  offerup: false,
};

export const STAGING = {
  // Browser for Facebook staging — quarantines FB cookies from daily browsing.
  dedicatedBrowser: "Firefox",
  facebookCreateUrl: "https://www.facebook.com/marketplace/create/item",
  redditSubmitUrl: "https://www.reddit.com/r/Watchexchange/submit",
  // Craigslist posting form requires a postal code; set yours once.
  craigslistPostal: "32779",
  // Item category -> Craigslist category label text (matched exactly on the
  // category page — CL uses bare labels like "furniture", "general for sale").
  craigslistCategoryMap: {
    watches: "jewelry",
    furniture: "furniture",
    electronics: "electronics",
    general: "general for sale",
  } as Record<string, string>,
  watchuseekCreateThreadUrl:
    "https://www.watchuseek.com/forums/watches-private-sellers-and-sponsors.9/create-thread",
  // "Log in" target: the create-thread page shows nothing when logged out, so
  // send the login flow to the forum home where the log-in bar renders.
  watchuseekLoginUrl: "https://www.watchuseek.com/",
};

export function craigslistCategory(itemCategory: string): string {
  return (
    STAGING.craigslistCategoryMap[itemCategory] ??
    STAGING.craigslistCategoryMap.general
  );
}

// Paste-ready text for staged handoff (FB / Reddit).
export function buildStagedBundle(listing: GeneratedListing): string {
  return `${listing.title}\n\n${listing.body}`;
}
