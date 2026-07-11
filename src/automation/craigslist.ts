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
      const category = craigslistCategory(ctx.item.category);
      const titleSel = "#PostingTitle, input[name='PostingTitle']";

      const catContainer = ".radio-option-container";

      // Select the category by clicking its LABEL. CL's newer json-form tracks
      // selection in JS state, so clicking the raw <input> sets DOM `checked`
      // but the framework ignores it on submit — clicking the <label> is what
      // it listens to. Walk the real markup (<label class="radio-option"> with
      // a <span class="option-label"> text), falling back to any label/radio
      // whose text matches (classic form). Returns true if something was
      // clicked.
      const selectCategory = async (): Promise<boolean> => {
        const picked = await page.evaluate((want) => {
          const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
          const target = norm(want);
          // New json-form: label.radio-option > input + div > span.option-label
          const labels = Array.from(
            document.querySelectorAll<HTMLLabelElement>("label.radio-option, label")
          );
          for (const lab of labels) {
            const span = lab.querySelector(".option-label") ?? lab;
            if (norm(span.textContent ?? "") === target) {
              lab.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
              lab.click();
              return true;
            }
          }
          // Classic fallback: derive each radio's label text.
          const radios = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="radio"]')
          );
          const labelFor = (r: HTMLInputElement): string => {
            if (r.id) {
              const l = document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
              if (l?.textContent) return l.textContent;
            }
            return r.closest("label")?.textContent ?? r.parentElement?.textContent ?? "";
          };
          for (const r of radios) {
            if (norm(labelFor(r)) === target) {
              r.click();
              return true;
            }
          }
          return false;
        }, category);

        if (!picked) return false;

        await continueBtn().click({ timeout: 8000 }).catch(() => {});
        // "Advanced" for EITHER form variant: the category list is gone, or a
        // title field appeared.
        await Promise.race([
          page.locator(catContainer).first().waitFor({ state: "detached", timeout: 12000 }),
          page.waitForSelector(titleSel, { timeout: 12000 }),
        ]).catch(() => {});
        return (
          (await page.locator(titleSel).count()) > 0 ||
          (await page.locator(catContainer).count()) === 0
        );
      };

      // Type page: "for sale by owner" (some flows land straight on categories).
      const fso = page.getByText("for sale by owner", { exact: true }).first();
      if (await fso.count()) {
        await fso.click({ timeout: 8000 });
        await continueBtn().click({ timeout: 8000 }).catch(() => {});
      }

      // Wait for the category page, then select + advance (one retry on flake).
      await page
        .getByText(category, { exact: true })
        .first()
        .waitFor({ timeout: 12000 });
      if (!(await selectCategory())) {
        if (await page.locator(titleSel).count()) return; // already advanced
        if (!(await selectCategory())) {
          throw new Error(`could not advance past category "${category}"`);
        }
      }
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
