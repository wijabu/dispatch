import { facebookSelectors } from "@/config/facebook";
import { findByTextContains, type UiNode } from "../../adb";
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

// Mark a live Facebook listing SOLD via its per-card management menu.
// Nav (Seller Hub -> Your listings -> "Open management menu for <title>") is the
// SAME proven path the FB reprice/delete flows use; the "Mark as sold" tap
// itself is UNVERIFIED (the only FB listing was already sold at build time, same
// status as FB Renew). Verify live against the next real FB listing.
export async function markSoldFacebook(ctx: FlowContext): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchFacebook(adb);
  if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  const title = ctx.item.name;
  const menuLabel = facebookSelectors.manageMenuPrefix + title;

  if (
    !(await step(adb, t, "open your listings", async () => {
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      const tapText = async (label: string) => {
        const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
        await adb.tapNode(node);
      };
      await tapText(facebookSelectors.sellTab);
      await tapText(facebookSelectors.yourListings);
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "mark sold", async () => {
      const menus = (await adb.dumpUi()).filter((n) => n.contentDesc === menuLabel);
      if (menus.length === 0) throw new Error(`listing not found: ${title}`);
      if (menus.length > 1) {
        throw new Error(`ambiguous title: ${menus.length} listings named "${title}" — resolve on Facebook first`);
      }
      await adb.tapNode(menus[0]);
      // UNVERIFIED tap: the management sheet exposes "Mark as sold".
      await tapLabel(adb, facebookSelectors.markSold);
      // Completion: the management sheet closed (the menu label is gone).
      let closed = false;
      for (let i = 0; i < 10; i++) {
        const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
        if (nodes.length && !nodes.some((n) => n.contentDesc === menuLabel && n.testId.length === 0)) {
          closed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!closed) throw new Error("management sheet did not close after 'Mark as sold'");
    }))
  )
    return resolveResult(t);

  return resolveResult(t);
}
