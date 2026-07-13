import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parseUiTree, findByTestId, findByTextContains } from "../adb";

const xml = fs.readFileSync(
  path.join(process.cwd(), "src/automation/android/__tests__/fixtures/offerup-listing.xml"),
  "utf8"
);

describe("uiautomator parse", () => {
  it("parses nodes with testId, text, bounds, and computed center", () => {
    const nodes = parseUiTree(xml);
    const acct = findByTestId(nodes, "tab-bar-widget.tab.account")!;
    expect(acct.text).toBe("Account");
    expect(acct.bounds).toEqual([879, 2253, 997, 2306]);
    expect(acct.center).toEqual([938, 2279]); // (879+997)/2, (2253+2306)/2 floored
  });
  it("finds a listing node by title substring", () => {
    const nodes = parseUiTree(xml);
    const listing = findByTextContains(nodes, "Sample Desk")!;
    expect(listing.testId).toBe("ProfileListingItem.btn.Sample Desk");
  });
  it("returns undefined for a missing testId", () => {
    expect(findByTestId(parseUiTree(xml), "does.not.exist")).toBeUndefined();
  });
});
