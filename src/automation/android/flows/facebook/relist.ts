import { facebookSelectors } from "@/config/facebook";
import { Adb, findByTextContains } from "../../adb";
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
import { postFacebook } from "./post";

// Relist a Facebook listing (drop-to-floor lifecycle). Facebook has native
// renew, so the engine's renew-then-repost policy maps cleanly:
//   - action "renew" (7-day): tap the listing's Renew — hands-off, no repost.
//   - action "relist" (42-day fresh cycle): post a fresh copy (auto-submit),
//     confirm it's live, then delete the old one (post-first / delete-last, so a
//     failure never leaves zero live listings). Mirrors flows/relist.ts (OfferUp).
// Navigation/selectors are confirmed during live acceptance (Task 11).
export async function relistFacebook(
  ctx: FlowContext,
  opts: { action: "renew" | "relist" }
): Promise<AndroidResult> {
  const title = ctx.item.name;

  if (opts.action === "renew") {
    const adb = await ensureBooted();
    await launchFacebook(adb);
    if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
    await ensureAdbKeyboard(adb);
    const t = newTracker();
    const tapText = async (label: string) => {
      const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
      await adb.tapNode(node);
    };
    if (
      !(await step(adb, t, "renew listing", async () => {
        await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
        await tapText(facebookSelectors.sellTab);
        await tapText(facebookSelectors.yourListings);
        const matches = (await adb.dumpUi()).filter((n) => n.text === title);
        if (matches.length === 0) throw new Error(`listing not found: ${title}`);
        if (matches.length > 1) {
          throw new Error(`ambiguous title: ${matches.length} listings named "${title}" — resolve on Facebook first`);
        }
        await adb.tapNode(matches[0]);
        await tapText(facebookSelectors.renewListing);
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
  const tapText = async (label: string) => {
    const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
    await adb.tapNode(node);
  };
  if (
    !(await step(adb, t, "delete old listing", async () => {
      // The fresh post is live; remove the OLD listing. Disambiguation by
      // captured identity is finalized during live acceptance (mirror the
      // OfferUp reload-verify approach — don't trust a single dialog).
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      await tapText(facebookSelectors.sellTab);
      await tapText(facebookSelectors.yourListings);
      const matches = (await adb.dumpUi()).filter((n) => n.text === title);
      if (matches.length < 2) {
        throw new Error(`expected 2 listings named "${title}" (old + fresh) before delete; found ${matches.length}`);
      }
      // Delete the OLDER listing; exact target + confirm finalized live.
      await adb.tapNode(matches[matches.length - 1]);
      await tapText(facebookSelectors.deleteListing);
    }))
  )
    return resolveResult(t);
  return resolveResult(t);
}
