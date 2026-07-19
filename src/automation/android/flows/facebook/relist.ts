import { facebookSelectors } from "@/config/facebook";
import { Adb, findByTextContains, type UiNode } from "../../adb";
import {
  ensureAdbKeyboard,
  ensureBooted,
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
import { postFacebook, tapLabel } from "./post";

// Relist a Facebook listing (drop-to-floor lifecycle). Facebook has native
// renew, so the engine's renew-then-repost policy maps cleanly:
//   - action "renew" (7-day): tap the listing's Renew — hands-off, no repost.
//   - action "relist" (42-day fresh cycle): post a fresh copy (auto-submit),
//     confirm it's live, then delete the old one (post-first / delete-last, so a
//     failure never leaves zero live listings). Mirrors flows/relist.ts (OfferUp).
// Maintenance nav (management menu → Edit/Delete, delete confirm) captured live
// 2026-07-19. NOTE: "Renew" only appears on aging listings, so the renew tap is
// still UNVERIFIED — capture it against a listing near expiry during acceptance.
export async function relistFacebook(
  ctx: FlowContext,
  opts: { action: "renew" | "relist" }
): Promise<AndroidResult> {
  const title = ctx.item.name;
  const menuLabel = facebookSelectors.manageMenuPrefix + title;
  const openYourListings = async (adb: Adb) => {
    await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
    const tapText = async (label: string) => {
      const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
      await adb.tapNode(node);
    };
    await tapText(facebookSelectors.sellTab);
    await tapText(facebookSelectors.yourListings);
  };

  if (opts.action === "renew") {
    const adb = await ensureBooted();
    await launchFacebook(adb);
    if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
    await ensureAdbKeyboard(adb);
    const t = newTracker();
    if (
      !(await step(adb, t, "renew listing", async () => {
        await openYourListings(adb);
        const menus = (await adb.dumpUi()).filter((n) => n.contentDesc === menuLabel);
        if (menus.length === 0) throw new Error(`listing not found: ${title}`);
        if (menus.length > 1) {
          throw new Error(`ambiguous title: ${menus.length} listings named "${title}" — resolve on Facebook first`);
        }
        await adb.tapNode(menus[0]);
        // "Renew" only shows on aging listings — UNVERIFIED selector/placement.
        await tapLabel(adb, facebookSelectors.renewListing);
      }))
    )
      return resolveResult(t);
    return resolveResult(t);
  }

  // action === "relist": post-first / delete-last.
  const post = await postFacebook(ctx, { autoSubmit: true });
  if (post.status !== "done") {
    return post.status === "posted_review"
      ? { status: "failed", step: "post fresh", reason: "auto-submit did not complete" }
      : post;
  }

  const adb = await ensureBooted();
  const t = newTracker();
  if (
    !(await step(adb, t, "delete old listing", async () => {
      // The fresh post is live; remove the OLD listing. After the repost there are
      // two cards with this title (old + fresh); delete one via its "⋯" menu →
      // Delete listing → Delete. Which card is the OLD one still needs a captured
      // identity (mirror OfferUp's reload-verify) — finalized during live
      // acceptance; here we require both to be present and delete the last-listed.
      await openYourListings(adb);
      const menus = (await adb.dumpUi()).filter((n) => n.contentDesc === menuLabel);
      if (menus.length < 2) {
        throw new Error(`expected 2 listings named "${title}" (old + fresh) before delete; found ${menus.length}`);
      }
      await adb.tapNode(menus[menus.length - 1]);
      await tapLabel(adb, facebookSelectors.deleteListing);
      await tapLabel(adb, facebookSelectors.deleteConfirm);
    }))
  )
    return resolveResult(t);
  return resolveResult(t);
}
