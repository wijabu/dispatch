import type { Condition } from "@/db/schema";

// Client-safe: constants + selectors only, no adb/playwright imports. Mirrors
// src/config/android.ts (OfferUp). The Facebook Marketplace automation drives
// the native Facebook Android app (com.facebook.katana) in the same emulator as
// OfferUp, over ADB/uiautomator.
export const FACEBOOK = {
  packageName: "com.facebook.katana",
  mainActivity: "com.facebook.katana/com.facebook.katana.activity.FbMainTabActivity",
} as const;

// Flip on once live acceptance passes (mirrors OFFERUP_AUTOMATION_ENABLED).
export const FACEBOOK_AUTOMATION_ENABLED = true;

// Gates the "Post to Facebook" button until the post flow is hardened +
// live-verified. Reprice/relist are unaffected. (Mirrors OFFERUP_POST_ENABLED.)
export const FACEBOOK_POST_ENABLED = false;

// Selectors captured live from the Facebook app (2026-07-18). Marketplace →
// Sell → Create listing → One item → composer. The one-item composer exposes
// clean composer_v3_* resource-ids; navigation controls are matched by text /
// content-desc. A Facebook app update is a one-line edit here.
//
// NOTE: Facebook has NO user-facing category picker — it auto-categorizes
// server-side — so there is no category selector.
export const facebookSelectors = {
  sellTab: "Sell", // Marketplace sub-tab → Seller Hub
  createListing: "Create listing", // Seller Hub button
  oneItem: "One item", // "Create new listing" sheet
  titleField: "composer_v3_title",
  priceField: "composer_v3_price",
  descriptionField: "composer_v3_description",
  addPhotos: "Add photos", // content-desc / text on the photo tile
  // Facebook's OWN in-app gallery picker (opens on "Add photos" WHEN FB holds
  // READ_MEDIA_IMAGES — grant it before launch). Tiles carry indexed
  // resource-ids camera_roll_image_0, _1, _2 … newest-first, so the just-pushed
  // fb_*.jpg are indices 0..N-1. Confirm with the "Next" button, which returns
  // to the composer with the photos attached. Captured live 2026-07-19.
  //
  // (The revoke-permission path routes to Android's PhotoPickerUserSelectActivity
  // — a scoped-ACCESS *grant* picker that widens FB's media access but does NOT
  // attach photos to the composer. Do not use it. Grant, don't revoke.)
  photoTilePrefix: "camera_roll_image_", // + index (0-based, newest-first)
  photoConfirm: "marketplace_camera_roll_android_next_button", // "Next"
  publish: "Publish", // bottom of composer (final submit — review-gated)
  // Seller Hub maintenance surfaces (reprice/relist). Labels below are the
  // Facebook UI strings; their exact nodes are confirmed during live acceptance.
  yourListings: "Your listings",
  editListing: "Edit listing",
  renewListing: "Renew",
  deleteListing: "Delete",
  markSold: "Mark as sold",
} as const;

// Facebook's condition chips (captured live). Dispatch's finer condition scale
// collapses onto these; default anything unmapped to "Used - Good".
export const FACEBOOK_CONDITIONS = [
  "New",
  "Used - Like New",
  "Used - Good",
  "Used - Fair",
] as const;

export const CONDITION_MAP: Record<Condition, (typeof FACEBOOK_CONDITIONS)[number]> = {
  new: "New",
  like_new: "Used - Like New",
  excellent: "Used - Good",
  good: "Used - Good",
  fair: "Used - Fair",
  for_parts: "Used - Fair",
};
