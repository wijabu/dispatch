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
import { tapLabel } from "./post";

// Relist a Facebook listing. Facebook is RENEW-ONLY: native Renew keeps the
// listing fresh, and a "post fresh copy, then delete old" repost is impossible
// because Facebook hard-blocks publishing a listing whose main photo matches
// another live listing (verified live 2026-07-19). So the engine only ever asks
// for action "renew"; "relist" (repost) is rejected here rather than silently
// doing something broken. Reprice handles price drops separately.
//
// NOTE: "Renew" only appears in a listing's "⋯" management menu once the listing
// is aging (fresh listings don't show it), so the renewListing selector/placement
// is still UNVERIFIED — capture it against a near-expiry listing during acceptance.
export async function relistFacebook(
  ctx: FlowContext,
  opts: { action: "renew" | "relist" }
): Promise<AndroidResult> {
  if (opts.action === "relist") {
    return {
      status: "failed",
      step: "relist",
      reason: "Facebook is renew-only (a duplicate-photo repost is blocked by FB); use action \"renew\"",
    };
  }

  const title = ctx.item.name;
  const menuLabel = facebookSelectors.manageMenuPrefix + title;
  const adb = await ensureBooted();
  await launchFacebook(adb);
  if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  if (
    !(await step(adb, t, "renew listing", async () => {
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      const tapText = async (label: string) => {
        const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
        await adb.tapNode(node);
      };
      await tapText(facebookSelectors.sellTab);
      await tapText(facebookSelectors.yourListings);
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
