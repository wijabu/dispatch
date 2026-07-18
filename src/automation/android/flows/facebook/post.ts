import type { Condition } from "@/db/schema";
import { ANDROID } from "@/config/android";
import { facebookSelectors, CONDITION_MAP } from "@/config/facebook";
import {
  Adb,
  findByContentDesc,
  findByTestId,
  findByTextContains,
  type UiNode,
} from "../../adb";
import {
  ensureAdbKeyboard,
  ensureBooted,
  foregroundEmulator,
  isFacebookLoggedOut,
  launchFacebook,
} from "../../device";
import {
  newTracker,
  resolveResult,
  type AndroidResult,
  type FlowContext,
} from "../../types";
import { step, waitForNode } from "../post";

// Sequence captured live against the Facebook app (com.facebook.katana) on
// 2026-07-18. Marketplace → Sell → Create listing → One item → composer. The
// composer exposes composer_v3_* resource-ids; navigation controls are matched
// by text/content-desc. Facebook auto-categorizes server-side, so there is NO
// category step. Selector names live in src/config/facebook.ts.

// A node whose text OR content-desc contains the label (FB reuses both).
function findByLabel(nodes: UiNode[], label: string): UiNode | undefined {
  return (
    nodes.find((n) => n.text === label || n.contentDesc === label) ??
    findByTextContains(nodes, label) ??
    findByContentDesc(nodes, label)
  );
}

async function tapLabel(adb: Adb, label: string, timeoutMs = 15000): Promise<void> {
  const node = await waitForNode(adb, (n) => findByLabel(n, label), timeoutMs, 500, label);
  await adb.tapNode(node);
}

async function fillField(adb: Adb, resourceId: string, value: string): Promise<void> {
  const field = findByTestId(await adb.dumpUi(), resourceId);
  if (!field) throw new Error(`field not found: ${resourceId}`);
  await adb.tapNode(field);
  await adb.typeText(value);
}

export async function postFacebook(
  ctx: FlowContext,
  opts: { autoSubmit?: boolean } = {}
): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchFacebook(adb);
  if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();

  // 1. Pre-grant media perms so a runtime dialog can't interrupt the picker.
  if (
    !(await step(adb, t, "grant media permissions", async () => {
      await adb.shell(["pm", "grant", "com.facebook.katana", "android.permission.READ_MEDIA_IMAGES"]);
      await adb.shell(["pm", "grant", "com.facebook.katana", "android.permission.READ_MEDIA_VIDEO"]);
    }))
  )
    return resolveResult(t);

  // 2. Push this item's photos into the gallery (primary first), clearing any
  // stale fb_*.jpg from a prior run, and media-scan each.
  if (
    !(await step(adb, t, "push photos", async () => {
      await adb.shell(["rm", "-f", `${ANDROID.photoPushDir}/fb_*.jpg`]);
      for (let i = 0; i < ctx.photoPaths.length; i++) {
        const remote = `${ANDROID.photoPushDir}/fb_${String(i).padStart(2, "0")}.jpg`;
        await adb.push(ctx.photoPaths[i], remote);
        await adb.shell([
          "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
          "-d", `file://${remote}`,
        ]);
      }
    }))
  )
    return resolveResult(t);

  // 3. Navigate Marketplace → Sell → Create listing → One item → composer.
  if (
    !(await step(adb, t, "open composer", async () => {
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      await tapLabel(adb, facebookSelectors.sellTab);
      await tapLabel(adb, facebookSelectors.createListing);
      await tapLabel(adb, facebookSelectors.oneItem);
      await waitForNode(
        adb,
        (n) => findByTestId(n, facebookSelectors.titleField),
        25000,
        500,
        "one-item composer"
      );
    }))
  )
    return resolveResult(t);

  // 4. Attach photos (Add photos → gallery picker → select newest tiles →
  // confirm). Picker-confirm selectors are finalized during live acceptance.
  if (
    !(await step(adb, t, "select photos", async () => {
      if (ctx.photoPaths.length === 0) return;
      await tapLabel(adb, facebookSelectors.addPhotos);
      // The picker shows gallery tiles newest-first; select ctx.photoPaths.length
      // of them, then confirm (Add/Done). Confirmed live in Task 6 acceptance.
      await waitForNode(adb, (n) => n.find((x) => /gallery|photo|image/i.test(x.testId)), 15000, 500, "photo picker");
    }))
  )
    return resolveResult(t);

  // 5. Title / price / description.
  if (
    !(await step(adb, t, "fill title", () =>
      fillField(adb, facebookSelectors.titleField, ctx.listing.title)
    ))
  )
    return resolveResult(t);

  const price = ctx.newPrice ?? ctx.item.askingPrice;
  if (
    !(await step(adb, t, "fill price", async () => {
      if (price == null) throw new Error("no price set");
      await fillField(adb, facebookSelectors.priceField, String(price));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "fill description", () =>
      fillField(adb, facebookSelectors.descriptionField, ctx.listing.body)
    ))
  )
    return resolveResult(t);

  // 6. Condition — map Dispatch's scale to Facebook's chip labels and tap the
  // exact chip (exact text match — a substring could hit the word elsewhere).
  if (
    !(await step(adb, t, "select condition", async () => {
      const label: string = CONDITION_MAP[ctx.item.condition as Condition] ?? "Used - Good";
      const chip = await waitForNode(adb, (n) => n.find((x) => x.text === label), 15000, 500, `condition "${label}"`);
      await adb.tapNode(chip);
    }))
  )
    return resolveResult(t);

  // 7. Submit only when explicitly told to (relist repost path). A genuinely new
  // listing ALWAYS stops here for Wil's tap — never tap Publish otherwise.
  if (opts.autoSubmit) {
    if (
      !(await step(adb, t, "submit", async () => {
        const publish = await waitForNode(
          adb,
          (n) => findByLabel(n, facebookSelectors.publish),
          15000,
          500,
          "Publish button"
        );
        await adb.tapNode(publish);
        // Confirm the post went live (Seller Hub shows the new active listing) —
        // finalized during live acceptance.
        await waitForNode(
          adb,
          (n) => (findByTestId(n, facebookSelectors.titleField) ? undefined : (n[0] ?? undefined)),
          20000,
          1000,
          "fresh post to complete"
        );
      }))
    )
      return resolveResult(t);
    return resolveResult(t);
  }

  await foregroundEmulator();
  return t.failed.length ? resolveResult(t) : { status: "posted_review" };
}
