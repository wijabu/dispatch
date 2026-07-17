import { offerupTestIds } from "@/config/android";
import { Adb, findByTestId, type UiNode } from "../adb";
import {
  ensureAdbKeyboard,
  ensureBooted,
  isOfferupLoggedOut,
  launchOfferup,
} from "../device";
import {
  newTracker,
  resolveResult,
  type AndroidResult,
  type FlowContext,
} from "../types";
import { postOfferup, step, waitForNode } from "./post";

// Relist an OfferUp listing (drop-to-floor lifecycle). OfferUp has no native
// repost, so "relist" = post a fresh copy, confirm it went live, then archive
// the old one. Ordering is POST-FIRST / DELETE-LAST so a failure never leaves
// the item with zero live listings.
//
// The fresh post creates a second listing with the SAME title, which would make
// a title match ambiguous. We sidestep that by capturing the OLD listing's share
// URL at the very START — while it's still the only listing carrying the title —
// and deep-linking back to that exact URL to archive it after the new post is up.
// No ledger storage needed: the anchor is captured live each run, at the one
// moment it's unambiguous.

const PILL_LABEL = "item-dashboard-screen.item-detail.pillStack.label";

const tapId = (adb: Adb) => async (testId: string) => {
  const node = findByTestId(await adb.dumpUi(), testId);
  if (!node) throw new Error(`not found: ${testId}`);
  await adb.tapNode(node);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Navigate Account -> public profile -> listings (newest first).
async function gotoProfileListings(adb: Adb): Promise<void> {
  const tap = tapId(adb);
  await tap(offerupTestIds.accountTab);
  await waitForNode(adb, (n) => findByTestId(n, offerupTestIds.publicProfile), 15000, 500, "account screen");
  await tap(offerupTestIds.publicProfile);
  await waitForNode(
    adb,
    (n) => n.find((x) => x.testId.startsWith("ProfileListingItem.btn.")),
    15000,
    500,
    "profile listings"
  );
}

// Fling the listings list back to the top so scans start from a known position.
async function scrollToTop(adb: Adb): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await adb.shell(["input", "swipe", "540", "800", "540", "1700", "300"]);
    await sleep(400);
  }
}

// Count listing tiles carrying this exact title across the WHOLE list. The list
// is virtualized (only rendered rows appear in a dump), so a single dump only
// sees the viewport — scroll top-to-bottom and take the max seen in any one dump.
// Two same-title listings (old + a fresh post, or a prior aborted relist) sort
// adjacently newest-first, so they co-render and the max reflects the duplicate.
// Assumes the list is already at the top.
async function countTitleTiles(adb: Adb, title: string): Promise<number> {
  const wanted = offerupTestIds.listingByTitle(title);
  let max = 0;
  let prevSig = "";
  let stable = 0;
  for (let i = 0; i < 14; i++) {
    const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
    const count = nodes.filter((n) => n.testId === wanted).length;
    if (count > max) max = count;
    // Stop once the list stops moving (reached the bottom).
    const sig = nodes.map((n) => n.testId).join("|").slice(0, 300);
    if (sig && sig === prevSig) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
    }
    prevSig = sig;
    await adb.shell(["input", "swipe", "540", "1600", "540", "800", "250"]);
    await sleep(600);
  }
  return max;
}

// Find the currently-rendered tiles for this title (scrolls down until at least
// one renders). Assumes the list is at the top.
async function findListingTiles(adb: Adb, title: string): Promise<UiNode[]> {
  const wanted = offerupTestIds.listingByTitle(title);
  let matches = (await adb.dumpUi()).filter((n) => n.testId === wanted);
  for (let i = 0; i < 8 && matches.length === 0; i++) {
    await adb.shell(["input", "swipe", "540", "1600", "540", "800", "250"]);
    await sleep(800);
    matches = (await adb.dumpUi()).filter((n) => n.testId === wanted);
  }
  return matches;
}

// Open the (single) listing with this title and read its share URL from the OS
// share sheet, where OfferUp renders it as plain text
// ("Check out this item on OfferUp. https://offerup.co/XXXX").
async function captureListingUrl(adb: Adb, title: string): Promise<string> {
  const tap = tapId(adb);
  await gotoProfileListings(adb);
  await scrollToTop(adb);
  // Ambiguity guard across the FULL list: before the fresh post exists there
  // must be exactly one listing with this title. Refuse to guess which to retire
  // if a prior aborted run already left a duplicate.
  const count = await countTitleTiles(adb, title);
  if (count === 0) throw new Error(`listing not found: ${title}`);
  if (count > 1) {
    throw new Error(`ambiguous title: ${count} listings named "${title}" — resolve on OfferUp first`);
  }
  // Re-locate and open the single tile (countTitleTiles left us at the bottom).
  await scrollToTop(adb);
  const tiles = await findListingTiles(adb, title);
  if (tiles.length === 0) throw new Error(`listing not found after scroll: ${title}`);
  await adb.tapNode(tiles[0]);
  await waitForNode(adb, (n) => findByTestId(n, offerupTestIds.shareButton), 15000, 500, "listing detail");
  await tap(offerupTestIds.shareButton);
  const shareNode = await waitForNode(
    adb,
    (n) => n.find((x) => /offerup\.co\//.test(x.text)),
    10000,
    500,
    "share sheet with listing URL"
  );
  // OfferUp short links are alphanumeric slugs; bound the match so trailing
  // sentence punctuation ("...offerup.co/abcd.") can't ride along into the URL.
  const m = shareNode.text.match(/https?:\/\/offerup\.co\/[A-Za-z0-9]+/);
  if (!m) throw new Error(`no listing URL in share text: ${shareNode.text}`);
  const url = m[0];
  // Dismiss the share sheet.
  await adb.shell(["input", "keyevent", "4"]);
  await sleep(800);
  return url;
}

// Deep-link straight to a specific listing and archive it: Manage this item ->
// "..." overflow -> Archive -> confirm. The success gate reads THIS item's status
// pill (not any "Archived" text on screen), so a stale label elsewhere can't
// false-positive and a mis-tapped confirm fails safe (times out).
async function archiveByUrl(adb: Adb, url: string): Promise<void> {
  const tap = tapId(adb);
  // A clean force-stop + VIEW intent lands deterministically on the listing.
  await adb.shell(["am", "force-stop", "com.offerup"]);
  await sleep(1000);
  await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
  await waitForNode(adb, (n) => findByTestId(n, offerupTestIds.manageOwnItem), 20000, 1000, "old listing detail (deep link)");
  await tap(offerupTestIds.manageOwnItem);
  await waitForNode(adb, (n) => findByTestId(n, offerupTestIds.dashboardEllipses), 15000, 500, "item dashboard");
  await tap(offerupTestIds.dashboardEllipses);
  // The "..." sheet lists Share / Archive / Cancel.
  const archiveRow = await waitForNode(adb, (n) => n.find((x) => x.text === "Archive"), 10000, 500, "archive option");
  await adb.tapNode(archiveRow);
  // OfferUp confirms a destructive archive with a dialog. Tap the affirmative
  // control (exact label finalized during live acceptance); the anchored regex
  // won't match "Archive this item?". If the guess is wrong the pill gate below
  // times out and nothing is left half-done.
  await sleep(1200);
  const confirm = (await adb.dumpUi()).find(
    (n) => /^(archive|confirm|yes|ok)$/i.test(n.text) || /^(archive|confirm|yes)$/i.test(n.contentDesc)
  );
  if (confirm) await adb.tapNode(confirm);
  // Success gate: THIS listing's status pill now reads Archived (not any stray
  // "Archived" label elsewhere in the tree).
  await waitForNode(
    adb,
    (n) => {
      const pill = findByTestId(n, PILL_LABEL);
      return pill && pill.text === "Archived" ? pill : undefined;
    },
    15000,
    1000,
    "listing to show Archived"
  );
}

export async function relistOfferup(ctx: FlowContext): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchOfferup(adb);
  if (await isOfferupLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  const title = ctx.item.name;

  // 1. Capture the OLD listing's anchor URL while its title is unambiguous.
  let oldUrl = "";
  if (
    !(await step(adb, t, "capture old listing", async () => {
      oldUrl = await captureListingUrl(adb, title);
    }))
  )
    return resolveResult(t);

  // 2. Post a fresh copy, auto-submitting (its content was already reviewed when
  //    the original went live).
  const post = await postOfferup(ctx, { autoSubmit: true });
  if (post.status !== "done") {
    // login_required / failed / (unexpected) posted_review: bail BEFORE archiving
    // so the old listing — still the only live one — is never removed.
    return post.status === "posted_review"
      ? { status: "failed", step: "post fresh", reason: "auto-submit did not complete" }
      : post;
  }

  // 3. Positively confirm the fresh post is LIVE before archiving anything. The
  //    composer closing (post.ts) proves OfferUp accepted the submit, but not
  //    that a public listing exists — an under-review/interstitial/error screen
  //    also dismisses the composer. Verify against OfferUp's own state: the
  //    profile must now show TWO listings with this title (old + new). If it
  //    doesn't, refuse to archive so we never end up with zero live listings.
  if (
    !(await step(adb, t, "confirm fresh post live", async () => {
      await gotoProfileListings(adb);
      await scrollToTop(adb);
      const count = await countTitleTiles(adb, title);
      if (count < 2) {
        throw new Error(
          `fresh post not visible on profile (${count} listing(s) named "${title}") — not archiving the old one`
        );
      }
    }))
  )
    return resolveResult(t);

  // 4. Deep-link to the captured old listing and archive it.
  if (
    !(await step(adb, t, "archive old listing", async () => {
      await archiveByUrl(adb, oldUrl);
    }))
  )
    return resolveResult(t);

  return resolveResult(t);
}
