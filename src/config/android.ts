import os from "os";
import path from "path";

const sdkRoot = path.join(os.homedir(), "Library", "Android", "sdk");

// Client-safe: no playwright/adb imports here. Paths + constants only.
export const ANDROID = {
  sdkRoot,
  adbPath: path.join(sdkRoot, "platform-tools", "adb"),
  emulatorPath: path.join(sdkRoot, "emulator", "emulator"),
  avdName: "dispatch_offerup",
  deviceSerial: "emulator-5554",
  photoPushDir: "/sdcard/Pictures",
  debugDir: path.join(process.cwd(), "data", "automation-debug"),
  // ADBKeyBoard IME (package com.android.adbkeyboard) — installed + enabled as
  // a one-time manual setup step. Types arbitrary Unicode via broadcast,
  // replacing the flaky ASCII-only `adb shell input text`.
  adbKeyboardIme: "com.android.adbkeyboard/.AdbIME",
} as const;

// Flip on once live acceptance passes.
export const OFFERUP_AUTOMATION_ENABLED = true;

// The post flow works, but its category auto-select is only robust for simple
// two-level categories (e.g. Home & Garden > Furniture); long/complex ones
// (e.g. Business equipment > Office equipment & Supplies) don't reliably close
// the picker. Keep the "Post to OfferUp" button hidden until that's hardened.
// Reprice ("Sync price to OfferUp") is unaffected and stays live.
export const OFFERUP_POST_ENABLED = false;

// Known testIDs captured live from the OfferUp RN app (2026-07-13, expanded
// with the post/reprice flow selectors from the live-capture session). Central
// so a selector change on an app update is a one-line edit.
export const offerupTestIds = {
  // Bottom nav
  postTab: "tab-bar-widget.tab.post",
  accountTab: "tab-bar-widget.tab.account",
  listingsTab: "tab-bar-widget.tab.listings",
  // Account -> listings -> manage (reprice/relist entry)
  publicProfile: "account-screen.public-profile",
  listingByTitle: (title: string) => `ProfileListingItem.btn.${title}`,
  manageOwnItem: "ItemDetailScreenBottomBarManageOwnItemButton",
  editPostLink: "item-dashboard-screen.edit-post-link",
  markSold: "item-dashboard-screen.mark-sold-button",
  // Post/Edit composer — single-page form (Edit-post reuses this; confirm live)
  mediaSelectorButton: "MediaSelectorButton", // opens the CameraRoll bottom sheet
  titleField: "TitleField",
  descriptionField: "DescriptionField",
  priceField: "PriceField",
  categoryField: "CategoryField",
  conditionField: "ConditionField",
  locationField: "LocationField",
  submitAction: "PostItemHeader.rightAction", // label becomes "Post" once valid; NEVER tap for a brand-new listing
  // Photo picker (CameraRoll bottom sheet)
  photoTile: "CameraRollListMediaAssetItem", // one per gallery photo; newest first
  photoConfirm: "CameraRollFooterUploadButton", // confirms the selected tiles
} as const;

// (Category is no longer a fuzzy Dispatch-category->OfferUp guess: each item
// carries its exact OfferUp category + subcategory, set by the user in Dispatch,
// and the flow selects that two-level path. See src/config/offerup-categories.ts
// for the full taxonomy.)

// OfferUp condition options are plain-text selectables on the composer.
export const OFFERUP_CONDITIONS = ["New", "Open Box", "Refurbished", "Used", "Broken"] as const;
