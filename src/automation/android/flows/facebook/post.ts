import type { Condition } from "@/db/schema";
import { ANDROID } from "@/config/android";
import { facebookSelectors, CONDITION_MAP, FACEBOOK_LOCATION } from "@/config/facebook";
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
export function findByLabel(nodes: UiNode[], label: string): UiNode | undefined {
  return (
    nodes.find((n) => n.text === label || n.contentDesc === label) ??
    findByTextContains(nodes, label) ??
    findByContentDesc(nodes, label)
  );
}

export async function tapLabel(adb: Adb, label: string, timeoutMs = 15000): Promise<void> {
  const node = await waitForNode(adb, (n) => findByLabel(n, label), timeoutMs, 500, label);
  await adb.tapNode(node);
}

// Set the selling location via the "Add location" map picker. Requires location
// permission + a live GPS fix (pinned to FACEBOOK_LOCATION before launch). Tapping
// the Location field opens the picker; "Refresh your location" snaps the marker to
// the GPS pin and "Apply" sets it (the field then reads "Location, <zip>"). Shared
// by the post and reprice flows (editing a listing re-triggers the location gate).
export async function setFacebookLocation(adb: Adb): Promise<void> {
  await adb.shell(["input", "keyevent", "111"]); // hide keyboard
  await new Promise((r) => setTimeout(r, 400));
  let field: UiNode | undefined;
  for (let a = 0; a < 6 && !field; a++) {
    field = (await adb.dumpUi()).find((x) =>
      x.contentDesc.startsWith(facebookSelectors.locationField)
    );
    if (field) break;
    await adb.shell(["input", "swipe", "540", "1500", "540", "700", "250"]);
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!field) throw new Error("location field not found");
  await adb.tapNode(field);
  await tapLabel(adb, facebookSelectors.locationRefresh, 15000);
  await new Promise((r) => setTimeout(r, 3000));
  await tapLabel(adb, facebookSelectors.locationApply, 10000);
  await waitForNode(
    adb,
    (n) =>
      n.find(
        (x) =>
          x.contentDesc.startsWith(facebookSelectors.locationField) &&
          !x.contentDesc.includes("error")
      ),
    15000,
    500,
    "location resolved"
  );
}

async function fillField(adb: Adb, resourceId: string, value: string): Promise<void> {
  const field = findByTestId(await adb.dumpUi(), resourceId);
  if (!field) throw new Error(`field not found: ${resourceId}`);
  await adb.tapNode(field);
  // Facebook auto-saves the composer as a draft and "One item" silently resumes
  // it, so a field may already hold text from an abandoned post. Clear before
  // typing or the new value concatenates onto the old (e.g. price 40 → 4040).
  await adb.clearText();
  await new Promise((r) => setTimeout(r, 200));
  await adb.typeText(value);
}

export async function postFacebook(
  ctx: FlowContext,
  opts: { autoSubmit?: boolean } = {}
): Promise<AndroidResult> {
  const adb = await ensureBooted();
  // Grant media permission BEFORE launch so "Add photos" opens Facebook's own
  // in-app gallery (indexed camera_roll_image_* tiles → clean, newest-first)
  // rather than Android's scoped-access grant picker, which only widens FB's
  // media access and never attaches photos to the composer. Grant while stopped
  // (launchFacebook force-stops first) to avoid the running-app restart.
  await adb.shell(["pm", "grant", "com.facebook.katana", "android.permission.READ_MEDIA_IMAGES"]);
  await adb.shell(["pm", "grant", "com.facebook.katana", "android.permission.READ_MEDIA_VIDEO"]);
  // Facebook Marketplace REQUIRES device location to publish (no manual city
  // entry). Grant location permission and pin the emulator's GPS to the selling
  // area so the composer resolves a selling city. Grant while stopped (launch
  // force-stops first); pin geo before launch so it's live when the app reads it.
  await adb.shell(["pm", "grant", "com.facebook.katana", "android.permission.ACCESS_FINE_LOCATION"]);
  await adb.shell(["pm", "grant", "com.facebook.katana", "android.permission.ACCESS_COARSE_LOCATION"]);
  await adb.geoFix(FACEBOOK_LOCATION.lon, FACEBOOK_LOCATION.lat);
  await launchFacebook(adb);
  if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();

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
      // Cold-started FB can swallow the first VIEW intent while still
      // initializing (slow on emulated networks). Fire the marketplace deep link,
      // and if the Sell tab hasn't appeared, re-fire it once before the long wait.
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      const sellUp = await waitForNode(
        adb,
        (n) => findByLabel(n, facebookSelectors.sellTab),
        12000,
        500,
        facebookSelectors.sellTab
      ).catch(() => null);
      if (!sellUp) {
        await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
        await tapLabel(adb, facebookSelectors.sellTab, 30000);
      } else {
        await adb.tapNode(sellUp);
      }
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

  // 4. Attach photos: Add photos → FB in-app gallery → tap the newest N tiles
  // (camera_roll_image_0..N-1, the just-pushed fb_*.jpg) → "Next" → the composer
  // returns with the photos attached. Selectors captured live 2026-07-19.
  if (
    !(await step(adb, t, "select photos", async () => {
      const count = ctx.photoPaths.length;
      if (count === 0) return;
      await tapLabel(adb, facebookSelectors.addPhotos);
      // Wait for the in-app gallery (tile index 0 = newest = our primary photo).
      await waitForNode(
        adb,
        (n) => findByTestId(n, `${facebookSelectors.photoTilePrefix}0`),
        15000,
        500,
        "in-app gallery"
      );
      // The React-Native gallery drops taps issued the instant it renders, so let
      // it settle before selecting.
      await new Promise((r) => setTimeout(r, 1800));
      const nextUp = async () =>
        findByTestId(await adb.dumpUi(), facebookSelectors.photoConfirm) ??
        findByContentDesc(await adb.dumpUi(), "Next");
      // Select the primary tile first and confirm it "took" — the "Next" button
      // only appears once ≥1 photo is selected, so it doubles as the selection
      // signal. Retry the tap (not tapped yet → no toggle-off risk) until Next
      // shows or we give up.
      for (let a = 0; a < 4 && !(await nextUp()); a++) {
        const t0 = findByTestId(await adb.dumpUi(), `${facebookSelectors.photoTilePrefix}0`);
        if (t0) await adb.tapNode(t0);
        await new Promise((r) => setTimeout(r, 900));
      }
      // Add the remaining tiles newest-first. A missing index means the gallery
      // has fewer tiles than photos pushed — attach what's there and stop.
      for (let i = 1; i < count; i++) {
        const tile = findByTestId(await adb.dumpUi(), `${facebookSelectors.photoTilePrefix}${i}`);
        if (!tile) break;
        await adb.tapNode(tile);
        await new Promise((r) => setTimeout(r, 400));
      }
      // "Next" (marketplace_camera_roll_android_next_button, content-desc "Next")
      // confirms the selection and returns to the composer.
      const next = await waitForNode(
        adb,
        (n) => findByTestId(n, facebookSelectors.photoConfirm) ?? findByContentDesc(n, "Next"),
        10000,
        500,
        "photo Next button"
      );
      await adb.tapNode(next);
      // Facebook intermittently shows a "Save time and list with Meta AI" promo
      // sheet after photos attach; it sits over the composer and blocks the wait
      // below. Dismiss it ("Not now") if present.
      await new Promise((r) => setTimeout(r, 1500));
      const notNow = findByLabel(await adb.dumpUi(), "Not now");
      if (notNow) await adb.tapNode(notNow);
      // Confirm we're back on the composer before filling fields.
      await waitForNode(
        adb,
        (n) => findByTestId(n, facebookSelectors.titleField),
        20000,
        500,
        "composer after photos"
      );
      // The composer isn't immediately interactive after the gallery transition;
      // the FIRST field (title) tapped too soon loses its clear+type. Settle.
      await new Promise((r) => setTimeout(r, 1500));
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
  // The chip row sits above the description field, so filling the description
  // scrolls it off the top and RN recycles it; hide the keyboard and scroll the
  // composer back up until the chip renders.
  if (
    !(await step(adb, t, "select condition", async () => {
      const label: string = CONDITION_MAP[ctx.item.condition as Condition] ?? "Used - Good";
      await adb.shell(["input", "keyevent", "111"]); // ESC — hide the soft keyboard
      await new Promise((r) => setTimeout(r, 500));
      let chip: UiNode | undefined;
      for (let a = 0; a < 6 && !chip; a++) {
        // The clickable target is a Button exposing the label via content-desc
        // (its text child is a non-clickable ViewGroup); match either.
        chip = (await adb.dumpUi()).find((x) => x.contentDesc === label || x.text === label);
        if (chip) break;
        // Swipe finger downward → scroll the form up → reveal the chip row above.
        await adb.shell(["input", "swipe", "540", "800", "540", "1500", "250"]);
        await new Promise((r) => setTimeout(r, 600));
      }
      if (!chip) throw new Error(`condition "${label}" not found`);
      // FB's RN chip ignores an instantaneous tap — press with a short hold. FB
      // exposes NO selection state on the chip node (`selected` stays false even
      // when it's visually blue), so the only signal is the reactive "Enter a
      // condition to continue" error, which clears when a chip is selected.
      // The chip TOGGLES (re-pressing a selected chip deselects it), so re-press
      // ONLY while that error still shows — that can never toggle a set chip off.
      const conditionUnset = async () =>
        (await adb.dumpUi()).some((x) => x.text.startsWith("Enter a condition"));
      for (let attempt = 0; attempt < 5; attempt++) {
        const c = (await adb.dumpUi()).find((x) => x.contentDesc === label || x.text === label);
        if (c) {
          const [cx, cy] = c.center;
          await adb.shell(["input", "swipe", String(cx), String(cy), String(cx), String(cy), "150"]);
        }
        await new Promise((r) => setTimeout(r, 1500));
        if (!(await conditionUnset())) break; // selected (or error not tracked yet)
      }
    }))
  )
    return resolveResult(t);

  // 6b. Location — Facebook requires a selling location to publish. Location
  // permission + the pinned GPS (FACEBOOK_LOCATION) are set before launch. Tapping
  // the Location field opens the "Add location" map picker; "Refresh your location"
  // snaps the marker to the pinned GPS and "Apply" sets it (the field then shows
  // the ZIP, e.g. "Location, 32779"). REQUIRES a live GPS fix — if the emulator
  // reports no location the picker can't resolve and this step fails (surfacing
  // the problem rather than silently reaching the gate with location unset).
  if (!(await step(adb, t, "set location", () => setFacebookLocation(adb))))
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
