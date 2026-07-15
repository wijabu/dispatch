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

describe("XML entity decoding", () => {
  it("decodes entities in both text and testId attributes", () => {
    const entityXml = `<hierarchy><node index="0" text="Home &amp; Garden" resource-id="category.item &lt;Home &amp; Garden&gt; &quot;top&quot; &#39;pick&#39;&#10;line2" class="android.widget.TextView" bounds="[0,0][10,10]" /></hierarchy>`;
    const [node] = parseUiTree(entityXml);
    expect(node.text).toBe("Home & Garden");
    expect(node.testId).toBe('category.item <Home & Garden> "top" \'pick\'\nline2');
  });
});
