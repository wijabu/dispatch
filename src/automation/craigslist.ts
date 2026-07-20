import type { Page } from "playwright";
import type { FillContext, FillResult, FillScript } from "./types";
import { looksLikeLoginWall, newTracker, resolveResult, tryStep, type StepTracker } from "./helpers";
import { craigslistCategory, craigslistCondition, STAGING } from "@/config/staging";

// Single-page form core — fixture-testable. Navigation lives in fill().
export async function fillCraigslistForm(
  page: Page,
  ctx: FillContext,
  t: StepTracker,
  opts: { postal: string; email: string }
): Promise<void> {
  // CL's json-form tracks each field's value in JS state via change/blur (a
  // field being "touched"); page.fill sets the DOM value + fires only `input`,
  // so the validator still treats every field as empty on submit ("all fields
  // missing" despite visible values). Fill, then dispatch input+change+blur so
  // the framework commits the value. id first (fixture/legacy), then name-based.
  const fillAndCommit = (step: string, selector: string, value: string) =>
    tryStep(t, step, async () => {
      await page.fill(selector, value);
      await page.locator(selector).first().evaluate((el) => {
        for (const type of ["input", "change", "blur"]) {
          el.dispatchEvent(new Event(type, { bubbles: true }));
        }
      });
    });

  await fillAndCommit("title", "#PostingTitle, input[name='PostingTitle']", ctx.listing.title);
  await fillAndCommit("price", "#Ask, input[name='price']", String(ctx.item.askingPrice ?? ""));
  if (opts.postal) {
    await fillAndCommit("postal code", "#postal_code, input[name='postal']", opts.postal);
  }
  await fillAndCommit("description", "#PostingBody, textarea[name='PostingBody']", ctx.listing.body);
  // Condition (required, red until set). CL hides the native <select> behind a
  // jQuery UI selectmenu that its json-form framework actually listens to —
  // setting the hidden <select> is ignored (same trap as the category picker).
  // Drive the widget: open the .ui-selectmenu-button.condition, click the option
  // by label. Fall back to a plain <select> (classic form / test fixture).
  await tryStep(t, "condition", async () => {
    const label = craigslistCondition(ctx.item.condition);
    const widget = page.locator(".ui-selectmenu-button.condition");
    if (await widget.count()) {
      await widget.first().click();
      await page.getByRole("option", { name: label, exact: true }).first().click();
    } else {
      await page.selectOption("select[name='condition'], #condition", { label });
    }
    // Commit to json-form's model (change/blur), same as the text fields.
    await page.locator("select[name='condition'], #condition").first().evaluate((el) => {
      for (const type of ["change", "blur"]) {
        el.dispatchEvent(new Event(type, { bubbles: true }));
      }
    });
  });
  // Reply email (required, red until set). Fill only when configured in
  // .env.local (CRAIGSLIST_EMAIL); otherwise leave it for you to type.
  if (opts.email) {
    await fillAndCommit(
      "email",
      "input[name='FromEMail'], #FromEMail, input[type='email']",
      opts.email
    );
  }
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

        // Only the json-form variant has the category container. Capture its
        // presence BEFORE advancing so its absence isn't read as "advanced" on
        // the classic form (where it never exists and count() is always 0).
        const hadCatContainer = (await page.locator(catContainer).count()) > 0;

        await continueBtn().click({ timeout: 8000 }).catch(() => {});
        // "Advanced" = the title field appeared, or (json-form only) the
        // category list detached.
        const advanced: Promise<unknown>[] = [
          page.waitForSelector(titleSel, { timeout: 12000 }),
        ];
        if (hadCatContainer) {
          advanced.push(
            page.locator(catContainer).first().waitFor({ state: "detached", timeout: 12000 })
          );
        }
        await Promise.race(advanced).catch(() => {});
        return (
          (await page.locator(titleSel).count()) > 0 ||
          (hadCatContainer && (await page.locator(catContainer).count()) === 0)
        );
      };

      // Type page: "for sale by owner" (some flows land straight on categories).
      // CL's json-form renders after `load`, so wait for the page to paint
      // before inspecting — an instant count() races the hydration and would
      // skip the type page, stranding the fill. Race the type-page text against
      // the category text; whichever we actually landed on resolves first.
      const fso = page.getByText("for sale by owner", { exact: true }).first();
      await Promise.race([
        fso.waitFor({ timeout: 12000 }),
        page.getByText(category, { exact: true }).first().waitFor({ timeout: 12000 }),
      ]).catch(() => {});
      if (await fso.count()) {
        await fso.click({ timeout: 8000 });
        await continueBtn().click({ timeout: 8000 }).catch(() => {});
      }

      // Ensure the category page is present, then select + advance.
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
      // Fill the details-page text fields.
      await fillCraigslistForm(page, ctx, t, {
        postal: STAGING.craigslistPostal,
        email: STAGING.craigslistEmail,
      });

      // Then advance through the remaining pages and upload the photos, stopping
      // BEFORE "done with images"/publish — you review the photos and post. Each
      // "continue" is a full-page form submit; wait for the next page to load.
      // Best-effort like the rest of the CL flow; a failure records and leaves
      // the window wherever it got to.
      const continueAndWait = async () => {
        await page
          .locator('button:has-text("continue"), button[type="submit"], input[name="go"]')
          .first()
          .click({ timeout: 8000 });
        await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
      };

      // details -> location (city/ZIP prefill from the ZIP we set).
      await tryStep(t, "continue to location", () => continueAndWait());
      // location -> images.
      await tryStep(t, "continue to images", async () => {
        await continueAndWait();
        await page.waitForSelector(
          'input[type="file"][accept*="image"], input[type="file"]',
          { timeout: 15000 }
        );
      });
      // Upload the item's photos to the image page (the file input is hidden
      // behind CL's "Add Images" button; setInputFiles drives it directly).
      if (ctx.photoPaths.length > 0) {
        await tryStep(t, "upload images", async () => {
          await page.setInputFiles(
            'input[type="file"][accept*="image"], input[type="file"]',
            ctx.photoPaths
          );
          // Uploads are async ("stay on this page while uploading"); wait for the
          // count to reflect them before handing off. Don't fail the step if the
          // text signal is missed — the upload has still been initiated.
          await page
            .waitForFunction(
              () => /posting has [1-9]\d* image/i.test(document.body.innerText),
              { timeout: 30000 }
            )
            .catch(() => {});
        });
      }
    }

    return resolveResult(t);
  },
};
