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
} as const;

// Flip on once live acceptance passes.
export const OFFERUP_AUTOMATION_ENABLED = true;

// Known testIDs captured from the OfferUp RN app (2026-07-13). Central so a
// selector change on an app update is a one-line edit.
export const offerupTestIds = {
  accountTab: "tab-bar-widget.tab.account",
  publicProfile: "account-screen.public-profile",
  listingByTitle: (title: string) => `ProfileListingItem.btn.${title}`,
  manageOwnItem: "ItemDetailScreenBottomBarManageOwnItemButton",
  editPostLink: "item-dashboard-screen.edit-post-link",
  markSold: "item-dashboard-screen.mark-sold-button",
} as const;
