import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import path from "path";
import { makeItem } from "@/publishers/__tests__/fixtures";
import { redditWatchexchange } from "@/publishers/reddit-watchexchange";
import { newTracker, looksLikeLoginWall } from "../helpers";
import { fillCraigslistForm } from "../craigslist";

const FIXTURES = path.join(process.cwd(), "src", "automation", "__tests__", "fixtures");
const fixtureUrl = (f: string) => "file://" + path.join(FIXTURES, f);

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch(); // headless for tests
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("craigslist fill core (fixture)", () => {
  it(
    "fills title, price, postal, body, and uploads photos primary-first",
    async () => {
      await page.goto(fixtureUrl("craigslist.html"));
      const item = makeItem({ askingPrice: 6800 });
      const listing = redditWatchexchange.generate(item, []); // any GeneratedListing works for the core
      const photoA = path.join(FIXTURES, "craigslist.html"); // any real files serve as upload stand-ins
      const photoB = path.join(FIXTURES, "login.html");
      const t = newTracker();

      await fillCraigslistForm(
        page,
        { listing, item, photoPaths: [photoA, photoB] },
        t,
        { postal: "60614" }
      );

      expect(await page.inputValue("#PostingTitle")).toBe(listing.title);
      expect(await page.inputValue("#Ask")).toBe("6800");
      expect(await page.inputValue("#postal_code")).toBe("60614");
      expect(await page.inputValue("#PostingBody")).toBe(listing.body);
      const files = await page.$eval(
        "#file",
        (el) => (el as HTMLInputElement).files!.length
      );
      expect(files).toBe(2);
      expect(t.failed).toEqual([]);
    },
    30_000
  );

  it(
    "login fixture trips the login-wall heuristic; posting fixture does not",
    async () => {
      await page.goto(fixtureUrl("login.html"));
      expect(await looksLikeLoginWall(page)).toBe(true);
      await page.goto(fixtureUrl("craigslist.html"));
      expect(await looksLikeLoginWall(page)).toBe(false);
    },
    30_000
  );
});
