import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import path from "path";
import { makeItem } from "@/publishers/__tests__/fixtures";
import { offerup } from "@/publishers/offerup";
import { newTracker } from "../helpers";
import { fillOfferupForm } from "../offerup";

const FIXTURES = path.join(process.cwd(), "src", "automation", "__tests__", "fixtures");

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("offerup fill core (fixture)", () => {
  it(
    "uploads photos first, then fills title, description, price",
    async () => {
      await page.goto("file://" + path.join(FIXTURES, "offerup.html"));
      const item = makeItem({ askingPrice: 6800 });
      const listing = offerup.generate(item, []);
      const t = newTracker();

      await fillOfferupForm(page, {
        listing,
        item,
        photoPaths: [path.join(FIXTURES, "login.html")],
      }, t);

      expect(await page.inputValue('input[name="title"]')).toBe(listing.title);
      expect(await page.inputValue('textarea[name="description"]')).toBe(listing.body);
      expect(await page.inputValue('input[name="price"]')).toBe("6800");
      const files = await page.$eval(
        'input[type="file"]',
        (el) => (el as HTMLInputElement).files!.length
      );
      expect(files).toBe(1);
      expect(t.failed).toEqual([]);
    },
    30_000
  );
});
