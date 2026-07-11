import type { Page } from "playwright";
import type { FillContext, FillResult, FillScript } from "./types";
import { looksLikeLoginWall, newTracker, resolveResult, tryStep, type StepTracker } from "./helpers";
import { craigslistCategory, STAGING } from "@/config/staging";

// Single-page form core — fixture-testable. Navigation lives in fill().
export async function fillCraigslistForm(
  page: Page,
  ctx: FillContext,
  t: StepTracker,
  opts: { postal: string }
): Promise<void> {
  await tryStep(t, "title", () => page.fill("#PostingTitle", ctx.listing.title));
  await tryStep(t, "price", () =>
    page.fill("#Ask", String(ctx.item.askingPrice ?? ""))
  );
  if (opts.postal) {
    await tryStep(t, "postal code", () => page.fill("#postal_code", opts.postal));
  }
  await tryStep(t, "description", () =>
    page.fill("#PostingBody", ctx.listing.body)
  );
  if (ctx.photoPaths.length > 0) {
    await tryStep(t, "photos", () =>
      page.setInputFiles('input[type="file"]', ctx.photoPaths)
    );
  }
}

export const craigslistFill: FillScript = {
  publisherId: "craigslist",
  startUrl: "https://post.craigslist.org/",
  isLoginWall: looksLikeLoginWall,

  async fill(page, ctx): Promise<FillResult> {
    const t = newTracker();

    // Craigslist's post flow is multi-page: type -> category -> form -> images.
    // Selectors here are best-effort; live acceptance tunes them. Any failure
    // records and continues — the window stays open wherever we got to.
    const navigated = await tryStep(t, "navigate to form", async () => {
      // Type page: "for sale by owner"
      const fso = page.locator("label", { hasText: "for sale by owner" }).first();
      await fso.click({ timeout: 8000 });
      await page
        .locator('button[type="submit"], input[name="go"]')
        .first()
        .click({ timeout: 8000 })
        .catch(() => {}); // some regions auto-advance on radio click
      // Category page
      const cat = page
        .locator("label", { hasText: craigslistCategory(ctx.item.category) })
        .first();
      await cat.click({ timeout: 8000 });
      await page
        .locator('button[type="submit"], input[name="go"]')
        .first()
        .click({ timeout: 8000 })
        .catch(() => {});
      await page.waitForSelector("#PostingTitle", { timeout: 10000 });
    });

    if (navigated) {
      await fillCraigslistForm(page, ctx, t, {
        postal: STAGING.craigslistPostal,
      });
      // CL uploads images on the page after the form; try to advance and upload.
      if (ctx.photoPaths.length > 0 && !t.filled.includes("photos")) {
        await tryStep(t, "photos", async () => {
          await page.locator('button[type="submit"]').first().click({ timeout: 8000 });
          await page.waitForSelector('input[type="file"]', { timeout: 10000 });
          await page.setInputFiles('input[type="file"]', ctx.photoPaths);
        });
      }
    }

    return resolveResult(t);
  },
};
