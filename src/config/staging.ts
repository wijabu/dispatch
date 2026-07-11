import type { GeneratedListing } from "@/publishers/types";

// Per-channel kill switches for Tier-1 auto-fill. Flip to false if a
// marketplace ever pushes back; staged handoff / copy-paste remain.
export const AUTOFILL_CHANNELS: Record<string, boolean> = {
  craigslist: true,
  watchuseek: true,
  offerup: true,
};

export const STAGING = {
  // Browser for Facebook staging — quarantines FB cookies from daily browsing.
  dedicatedBrowser: "Firefox",
  facebookCreateUrl: "https://www.facebook.com/marketplace/create/item",
  redditSubmitUrl: "https://www.reddit.com/r/Watchexchange/submit",
  // Craigslist posting form requires a postal code; set yours once.
  craigslistPostal: "32779",
  // Item category -> Craigslist category label text (matched on the category page).
  craigslistCategoryMap: {
    watches: "jewelry - by owner",
    furniture: "furniture - by owner",
    electronics: "electronics - by owner",
    general: "general for sale - by owner",
  } as Record<string, string>,
  watchuseekCreateThreadUrl:
    "https://www.watchuseek.com/forums/watches-private-sellers-and-sponsors.9/create-thread",
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
