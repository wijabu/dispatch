import { describe, expect, it } from "vitest";
import { ANDROID, OFFERUP_AUTOMATION_ENABLED, offerupTestIds } from "../android";

describe("android config", () => {
  it("points at the SDK adb, AVD, and emulator serial", () => {
    expect(ANDROID.adbPath).toMatch(/platform-tools\/adb$/);
    expect(ANDROID.avdName).toBe("dispatch_offerup");
    expect(ANDROID.deviceSerial).toBe("emulator-5554");
    expect(ANDROID.photoPushDir).toBe("/sdcard/Pictures");
  });
  it("exposes the OfferUp enable flag and known testIDs", () => {
    expect(typeof OFFERUP_AUTOMATION_ENABLED).toBe("boolean");
    expect(offerupTestIds.accountTab).toBe("tab-bar-widget.tab.account");
    expect(offerupTestIds.editPostLink).toBe("item-dashboard-screen.edit-post-link");
  });
});
