import type { Page } from "playwright";
import type { FillContext, FillResult, FillScript } from "./types";
import { looksLikeLoginWall, newTracker, resolveResult, tryStep, type StepTracker } from "./helpers";

// OfferUp's post flow starts with photos; category/condition pickers are
// left for the human review pass (per the human-in-the-loop design).
export async function fillOfferupForm(
  page: Page,
  ctx: FillContext,
  t: StepTracker
): Promise<void> {
  if (ctx.photoPaths.length > 0) {
    await tryStep(t, "photos", () =>
      page.setInputFiles('input[type="file"]', ctx.photoPaths)
    );
  }
  await tryStep(t, "title", () =>
    page.fill('input[name="title"]', ctx.listing.title)
  );
  await tryStep(t, "description", () =>
    page.fill('textarea[name="description"]', ctx.listing.body)
  );
  await tryStep(t, "price", () =>
    page.fill('input[name="price"]', String(ctx.item.askingPrice ?? ""))
  );
}

export const offerupFill: FillScript = {
  publisherId: "offerup",
  startUrl: "https://offerup.com/post/",
  isLoginWall: looksLikeLoginWall,

  async fill(page, ctx): Promise<FillResult> {
    const t = newTracker();
    const ready = await tryStep(t, "navigate to form", () =>
      page.waitForSelector('input[type="file"]', { timeout: 10000 }).then(() => {})
    );
    if (ready) await fillOfferupForm(page, ctx, t);
    return resolveResult(t);
  },
};
