import fs from "fs";
import path from "path";
import type { Condition } from "@/db/schema";
import {
  ANDROID,
  offerupTestIds,
  OFFERUP_CONDITIONS,
} from "@/config/android";
import { Adb, findByTestId, type UiNode } from "../adb";
import {
  ensureAdbKeyboard,
  ensureBooted,
  foregroundEmulator,
  isOfferupLoggedOut,
  launchOfferup,
} from "../device";
import {
  newTracker,
  resolveResult,
  tryStep,
  type AndroidResult,
  type FlowContext,
  type StepTracker,
} from "../types";

// Sequence captured live against the OfferUp RN app on 2026-07-13. Selector
// names live in src/config/android.ts (offerupTestIds) so an app-update
// selector change is a one-line edit there, not a rewrite here.

// item.condition -> OfferUp's plain-text condition options. OFFERUP_CONDITIONS
// doesn't line up 1:1 with our finer-grained scale, so several of our
// conditions collapse onto "Used"; default to "Used" for anything unmapped.
const CONDITION_MAP: Record<Condition, (typeof OFFERUP_CONDITIONS)[number]> = {
  new: "New",
  like_new: "Open Box",
  excellent: "Used",
  good: "Used",
  fair: "Used",
  for_parts: "Broken",
};

export async function waitForNode(
  adb: Adb,
  find: (nodes: UiNode[]) => UiNode | undefined,
  timeoutMs = 15000,
  intervalMs = 500,
  label = "UI element"
): Promise<UiNode> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // uiautomator can transiently fail ("could not get idle state") on an
    // animating/loading screen — treat that as "not found yet" and keep polling.
    let node: UiNode | undefined;
    try {
      node = find(await adb.dumpUi());
    } catch {
      node = undefined;
    }
    if (node) return node;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function fillField(adb: Adb, testId: string, value: string): Promise<void> {
  const field = findByTestId(await adb.dumpUi(), testId);
  if (!field) throw new Error(`field not found: ${testId}`);
  await adb.tapNode(field);
  await adb.typeText(value);
}

export async function captureFailureScreenshot(adb: Adb, step: string): Promise<void> {
  try {
    await fs.promises.mkdir(ANDROID.debugDir, { recursive: true });
    const dest = path.join(
      ANDROID.debugDir,
      `post-${step.replace(/\s+/g, "-")}-${Date.now()}.png`
    );
    await adb.screencap(dest);
  } catch {
    // Best-effort debug artifact; a failed capture must never mask the real failure.
  }
}

// Runs `fn` under tryStep and, if it fails, captures a debug screenshot before
// the caller bails out via resolveResult. Every step in this flow stops the
// whole run on failure — once the on-device UI state is unknown, blindly
// continuing to tap through the rest of the form risks fat-fingering the wrong
// control, so we degrade to resolveResult(t) instead.
export async function step(
  adb: Adb,
  t: StepTracker,
  name: string,
  fn: () => Promise<void>
): Promise<boolean> {
  const ok = await tryStep(t, name, fn);
  if (!ok) await captureFailureScreenshot(adb, name);
  return ok;
}

export async function postOfferup(
  ctx: FlowContext,
  opts: { autoSubmit?: boolean } = {}
): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchOfferup(adb);
  if (await isOfferupLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();

  // 1. Pre-grant media perms so a runtime permission dialog can't interrupt
  // the photo-picker step below.
  if (
    !(await step(adb, t, "grant media permissions", async () => {
      await adb.shell(["pm", "grant", "com.offerup", "android.permission.READ_MEDIA_IMAGES"]);
      await adb.shell(["pm", "grant", "com.offerup", "android.permission.READ_MEDIA_VIDEO"]);
    }))
  )
    return resolveResult(t);

  // 2. Push photos into the device gallery (primary first) and media-scan
  // each so OfferUp's CameraRoll picker sees them immediately.
  if (
    !(await step(adb, t, "push photos", async () => {
      // Clear any leftovers from a prior run so the picker's newest tiles are
      // exactly this item's photos (a previous item with more photos would
      // otherwise leave stray dispatch_*.jpg files in the gallery).
      await adb.shell(["rm", "-f", `${ANDROID.photoPushDir}/dispatch_*.jpg`]);
      for (let i = 0; i < ctx.photoPaths.length; i++) {
        const remote = `${ANDROID.photoPushDir}/dispatch_${String(i).padStart(2, "0")}.jpg`;
        await adb.push(ctx.photoPaths[i], remote);
        await adb.shell([
          "am",
          "broadcast",
          "-a",
          "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
          "-d",
          `file://${remote}`,
        ]);
      }
    }))
  )
    return resolveResult(t);

  // 3. Open the Sell composer.
  if (
    !(await step(adb, t, "open sell composer", async () => {
      const postTab = findByTestId(await adb.dumpUi(), offerupTestIds.postTab);
      if (!postTab) throw new Error(`postTab not found: ${offerupTestIds.postTab}`);
      await adb.tapNode(postTab);
      // Composer can be slow to render on a cold app — give it room.
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.titleField), 25000);
    }))
  )
    return resolveResult(t);

  // 4. Attach photos via the CameraRoll bottom sheet (newest-first tiles).
  if (
    !(await step(adb, t, "select photos", async () => {
      if (ctx.photoPaths.length === 0) return;
      const mediaBtn = findByTestId(await adb.dumpUi(), offerupTestIds.mediaSelectorButton);
      if (!mediaBtn) throw new Error(`mediaSelectorButton not found: ${offerupTestIds.mediaSelectorButton}`);
      await adb.tapNode(mediaBtn);
      await waitForNode(adb, (nodes) => nodes.find((n) => n.testId === offerupTestIds.photoTile));
      const tiles = (await adb.dumpUi())
        .filter((n) => n.testId === offerupTestIds.photoTile)
        .slice(0, ctx.photoPaths.length);
      if (tiles.length < ctx.photoPaths.length) {
        throw new Error(`expected ${ctx.photoPaths.length} photo tiles, found ${tiles.length}`);
      }
      for (const tile of tiles) await adb.tapNode(tile);
      const confirm = findByTestId(await adb.dumpUi(), offerupTestIds.photoConfirm);
      if (!confirm) throw new Error(`photoConfirm not found: ${offerupTestIds.photoConfirm}`);
      await adb.tapNode(confirm);
    }))
  )
    return resolveResult(t);

  // 5. Title / description / price text fields.
  if (
    !(await step(adb, t, "fill title", () =>
      fillField(adb, offerupTestIds.titleField, ctx.listing.title)
    ))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "fill description", () =>
      fillField(adb, offerupTestIds.descriptionField, ctx.listing.body)
    ))
  )
    return resolveResult(t);

  const price = ctx.newPrice ?? ctx.item.askingPrice;
  if (
    !(await step(adb, t, "fill price", async () => {
      if (price == null) throw new Error("no price set (newPrice and item.askingPrice are both null)");
      await fillField(adb, offerupTestIds.priceField, String(price));
    }))
  )
    return resolveResult(t);

  // 6. Category — two-level selection from the item's stored OfferUp category +
  // subcategory (set by the user in Dispatch; entity-decoded labels like
  // "Home & Garden" are matched EXACTLY so they can't collide with
  // "Other - Home & Garden"). If the item has no category set, skip: a
  // brand-new post stops at the review gate where the user picks it by hand.
  const catName = ctx.item.offerupCategory;
  const subName = ctx.item.offerupSubcategory;
  if (catName && subName) {
    // OfferUp's category picker is a long virtualized accordion; scrolling to
    // and tapping a below-the-fold row is fragile (rows pinned against the
    // system nav bar don't register a tap — this is what broke bottom-of-list
    // categories like Business equipment > Office equipment & Supplies). Instead
    // use the picker's built-in "Search categories" box: a typed query filters
    // to a leaf row whose content-desc encodes the full path as "<sub>, <cat>",
    // which we tap directly. No scrolling, and the parent path in the desc
    // disambiguates same-named leaves (e.g. "Other - <category>").
    // Both the picker's search-result leaf and the composer's category field
    // render the selected path as an accessibility content-desc. Two-level
    // categories show it as "<sub>, <cat>" exactly; match leniently (starts with
    // the subcategory, contains the category) so a deeper-nested or extra-segment
    // label can't silently miss and time out.
    const matchesPath = (n: UiNode) =>
      n.contentDesc.startsWith(`${subName},`) && n.contentDesc.includes(catName);
    if (
      !(await step(adb, t, "select category", async () => {
        const catField = findByTestId(await adb.dumpUi(), offerupTestIds.categoryField);
        if (!catField) throw new Error(`categoryField not found: ${offerupTestIds.categoryField}`);
        await adb.tapNode(catField);
        // picker opens
        await waitForNode(
          adb,
          (nodes) => nodes.find((n) => n.text === "Select a category"),
          15000,
          500,
          "category picker to open"
        );
        // focus the search box (its hint text is "Search categories") and type
        // the subcategory name — a single-line query, so typeText sends no ENTER.
        const search = await waitForNode(
          adb,
          (nodes) => nodes.find((n) => n.text === "Search categories"),
          15000,
          500,
          "category search box"
        );
        await adb.tapNode(search);
        await adb.typeText(subName);
        // tap the filtered leaf, matched by its full-path content-desc
        const result = await waitForNode(
          adb,
          (nodes) => nodes.find(matchesPath),
          8000,
          500,
          `search result for "${subName}, ${catName}"`
        );
        await adb.tapNode(result);
        // Dismiss the soft keyboard so it can't obscure the condition options
        // below AND so its stale "Select a category" node clears from the tree —
        // but only if the IME is actually showing, else BACK would pop the
        // composer instead of the keyboard.
        if ((await adb.shell(["dumpsys", "input_method"])).includes("mInputShown=true")) {
          await adb.shell(["input", "keyevent", "4"]);
        }
        // Completion: back on the composer (TitleField) with the category field
        // showing the selected path and the picker closed.
        await waitForNode(
          adb,
          (nodes) =>
            findByTestId(nodes, offerupTestIds.titleField) &&
            nodes.some(matchesPath) &&
            !nodes.some((n) => n.text === "Select a category")
              ? nodes[0]
              : undefined,
          8000,
          500,
          "category selection to apply"
        );
      }))
    )
      return resolveResult(t);
  }

  // 7. Condition.
  if (
    !(await step(adb, t, "select condition", async () => {
      const condField = findByTestId(await adb.dumpUi(), offerupTestIds.conditionField);
      if (!condField) throw new Error(`conditionField not found: ${offerupTestIds.conditionField}`);
      await adb.tapNode(condField);
      const label = CONDITION_MAP[ctx.item.condition] ?? "Used";
      // Exact text match — a substring match could hit the word in the
      // description (e.g. "Used once") instead of the condition chip.
      const option = await waitForNode(adb, (nodes) => nodes.find((n) => n.text === label));
      await adb.tapNode(option);
    }))
  )
    return resolveResult(t);

  // 8. Submit only when explicitly told to (relist path). A brand-new listing
  // ALWAYS stops here so Wil taps Post himself — never tap submitAction
  // otherwise.
  if (opts.autoSubmit) {
    if (
      !(await step(adb, t, "submit", async () => {
        const submit = findByTestId(await adb.dumpUi(), offerupTestIds.submitAction);
        if (!submit) throw new Error(`submitAction not found: ${offerupTestIds.submitAction}`);
        await adb.tapNode(submit);
        // Confirm the post actually went through: the composer ("Post an item"
        // form with the title field) disappears once OfferUp accepts the
        // listing. Without this a silent submit failure reads as success — which
        // is dangerous on the relist path, where the NEXT step archives the old
        // listing. If the composer never closes, this times out and the step
        // fails, so relist bails before it can delete the only live listing.
        await waitForNode(
          adb,
          (nodes) => (findByTestId(nodes, offerupTestIds.titleField) ? undefined : (nodes[0] ?? undefined)),
          20000,
          1000,
          "fresh post to complete (composer to close)"
        );
        // OfferUp then shows a paid "Promote"/"Sell faster" upsell — dismiss it
        // with BACK; never touch the paid buttons.
        for (let i = 0; i < 3; i++) {
          const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
          const upsell = nodes.some(
            (n) => n.testId.startsWith("SellFaster") || n.text === "Promote"
          );
          if (!upsell) break;
          await adb.shell(["input", "keyevent", "4"]);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }))
    )
      return resolveResult(t);
    return resolveResult(t);
  }

  await foregroundEmulator();
  return t.failed.length ? resolveResult(t) : { status: "posted_review" };
}
