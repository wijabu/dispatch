import type { Page } from "playwright";
import type { FillContext, FillResult, FillScript } from "./types";
import { looksLikeLoginWall, newTracker, resolveResult, tryStep, type StepTracker } from "./helpers";
import { STAGING } from "@/config/staging";

export async function fillWatchuseekForm(
  page: Page,
  ctx: FillContext,
  t: StepTracker
): Promise<void> {
  await tryStep(t, "title", () =>
    page.fill('input[name="title"]', ctx.listing.title)
  );
  await tryStep(t, "body", () =>
    page.locator('[contenteditable="true"]').first().fill(ctx.listing.body)
  );
  if (ctx.photoPaths.length > 0) {
    await tryStep(t, "photos", () =>
      page.setInputFiles('input[type="file"]', ctx.photoPaths)
    );
  }
}

export const watchuseekFill: FillScript = {
  publisherId: "watchuseek",
  startUrl: STAGING.watchuseekCreateThreadUrl,
  loginUrl: STAGING.watchuseekLoginUrl,
  isLoginWall: looksLikeLoginWall,

  async fill(page, ctx): Promise<FillResult> {
    const t = newTracker();
    const ready = await tryStep(t, "navigate to form", () =>
      page.waitForSelector('input[name="title"]', { timeout: 10000 }).then(() => {})
    );
    if (ready) await fillWatchuseekForm(page, ctx, t);
    return resolveResult(t);
  },
};
