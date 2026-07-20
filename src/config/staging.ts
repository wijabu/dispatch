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
  // Craigslist posting form requires a postal code + reply email. These are
  // personal, and this repo is public, so they live in a gitignored .env.local
  // (CRAIGSLIST_POSTAL, CRAIGSLIST_EMAIL) — NOT in source. See .env.local.example.
  // Read server-side only (the fill script); empty string if unset → that field
  // is left for you to complete.
  craigslistPostal: process.env.CRAIGSLIST_POSTAL ?? "",
  craigslistEmail: process.env.CRAIGSLIST_EMAIL ?? "",
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

// Dispatch's condition scale -> Craigslist's condition dropdown labels
// (new / like new / excellent / good / fair / salvage). for_parts -> salvage.
const CRAIGSLIST_CONDITION_MAP: Record<string, string> = {
  new: "new",
  like_new: "like new",
  excellent: "excellent",
  good: "good",
  fair: "fair",
  for_parts: "salvage",
};

export function craigslistCondition(itemCondition: string): string {
  return CRAIGSLIST_CONDITION_MAP[itemCondition] ?? "good";
}

// Paste-ready text for staged handoff (FB / Reddit).
export function buildStagedBundle(listing: GeneratedListing): string {
  return `${listing.title}\n\n${listing.body}`;
}
