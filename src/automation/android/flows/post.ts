import fs from "fs";
import path from "path";
import type { Condition } from "@/db/schema";
import {
  ANDROID,
  offerupCategoryMap,
  offerupTestIds,
  OFFERUP_CONDITIONS,
} from "@/config/android";
import { Adb, findByTestId, findByTextContains, type UiNode } from "../adb";
import { ensureBooted, foregroundEmulator, isOfferupLoggedOut } from "../device";
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

// `adb shell <cmd...>` reassembles its argv into a single command string that
// the device's shell parses, so unescaped shell metacharacters in typed text
// (&, |, ;, $, backticks, quotes, brackets) can truncate the command or type
// garbage instead of the intended value. `input text` also has no reliable
// way to enter a literal newline. This is a best-effort sanitizer, not a
// fix — text entry is the most fragile step in this flow and is expected to
// need live tuning during Task 12 acceptance if titles/descriptions with
// unusual punctuation render wrong on-device.
function sanitizeForInputText(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[&|;$`<>(){}"']/g, "");
}

async function waitForNode(
  adb: Adb,
  find: (nodes: UiNode[]) => UiNode | undefined,
  timeoutMs = 8000,
  intervalMs = 400
): Promise<UiNode> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const node = find(await adb.dumpUi());
    if (node) return node;
    if (Date.now() >= deadline) throw new Error("timed out waiting for UI element");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function fillField(adb: Adb, testId: string, value: string): Promise<void> {
  const field = findByTestId(await adb.dumpUi(), testId);
  if (!field) throw new Error(`field not found: ${testId}`);
  await adb.tapNode(field);
  await adb.typeText(sanitizeForInputText(value));
}

async function captureFailureScreenshot(adb: Adb, step: string): Promise<void> {
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
async function step(
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
  if (await isOfferupLoggedOut(adb)) return { status: "login_required" };

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
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.titleField));
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

  // 6. Category — matched by decoded label text (see the adb.ts entity-decode
  // prerequisite; labels like "Home & Garden" arrive as raw "&amp;" in the XML).
  if (
    !(await step(adb, t, "select category", async () => {
      const catField = findByTestId(await adb.dumpUi(), offerupTestIds.categoryField);
      if (!catField) throw new Error(`categoryField not found: ${offerupTestIds.categoryField}`);
      await adb.tapNode(catField);
      const label = offerupCategoryMap[ctx.item.category] ?? offerupCategoryMap.general;
      const option = await waitForNode(adb, (nodes) => findByTextContains(nodes, label));
      await adb.tapNode(option);
    }))
  )
    return resolveResult(t);

  // 7. Condition.
  if (
    !(await step(adb, t, "select condition", async () => {
      const condField = findByTestId(await adb.dumpUi(), offerupTestIds.conditionField);
      if (!condField) throw new Error(`conditionField not found: ${offerupTestIds.conditionField}`);
      await adb.tapNode(condField);
      const label = CONDITION_MAP[ctx.item.condition] ?? "Used";
      const option = await waitForNode(adb, (nodes) => findByTextContains(nodes, label));
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
      }))
    )
      return resolveResult(t);
    return resolveResult(t);
  }

  await foregroundEmulator();
  return t.failed.length ? resolveResult(t) : { status: "posted_review" };
}
