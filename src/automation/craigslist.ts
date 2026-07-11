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
  // id first (fixture + legacy), then current name-based selector.
  await tryStep(t, "title", () =>
    page.fill("#PostingTitle, input[name='PostingTitle']", ctx.listing.title)
  );
  await tryStep(t, "price", () =>
    page.fill("#Ask, input[name='price']", String(ctx.item.askingPrice ?? ""))
  );
  if (opts.postal) {
    await tryStep(t, "postal code", () =>
      page.fill("#postal_code, input[name='postal']", opts.postal)
    );
  }
  await tryStep(t, "description", () =>
    page.fill("#PostingBody, textarea[name='PostingBody']", ctx.listing.body)
  );
  // Photos live on a later Craigslist page; only upload if a file input is on
  // THIS page (true for the fixture, not for the real details form). Skipping
  // when absent keeps it out of the failure list.
  if (ctx.photoPaths.length > 0 && (await page.locator('input[type="file"]').count()) > 0) {
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
      const continueBtn = () =>
        page
          .locator('button:has-text("continue"), button[type="submit"], input[name="go"]')
          .first();

      // Type page: "for sale by owner". Some flows skip straight to categories.
      const fso = page.getByText("for sale by owner", { exact: true }).first();
      if (await fso.count()) {
        await fso.click({ timeout: 8000 });
        await continueBtn().click({ timeout: 8000 }).catch(() => {}); // some regions auto-advance
      }

      // Category page: bare labels ("furniture", "general for sale") — exact
      // match so "electronics" can't collide with "computer parts" etc.
      const cat = page
        .getByText(craigslistCategory(ctx.item.category), { exact: true })
        .first();
      await cat.click({ timeout: 8000 });
      await continueBtn().click({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector("#PostingTitle", { timeout: 15000 });
    });

    if (navigated) {
      // Fill the details-page text fields and stop. We do NOT click continue/
      // submit — that would violate "Dispatch never submits" and trip CL's
      // validation. You pick condition, add photos on the next page, and post.
      await fillCraigslistForm(page, ctx, t, {
        postal: STAGING.craigslistPostal,
      });
    }

    return resolveResult(t);
  },
};
