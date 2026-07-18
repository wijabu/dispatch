import { facebookSelectors } from "@/config/facebook";
import { Adb, findByTestId, findByTextContains, type UiNode } from "../../adb";
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

// Reprice a live Facebook listing, hands-off: Seller Hub → Your listings →
// the listing → Edit → replace price → save. Navigation selectors are confirmed
// during live acceptance (Task 11). Mirrors flows/reprice.ts (OfferUp): match
// the listing by title, refuse to act on an ambiguous match.
export async function repriceFacebook(ctx: FlowContext): Promise<AndroidResult> {
  if (ctx.newPrice == null) {
    return { status: "failed", step: "reprice", reason: "no newPrice provided" };
  }
  const adb = await ensureBooted();
  await launchFacebook(adb);
  if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  const title = ctx.item.name;
  const tapText = async (label: string) => {
    const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
    await adb.tapNode(node);
  };

  if (
    !(await step(adb, t, "open your listings", async () => {
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      await tapText(facebookSelectors.sellTab);
      await tapText(facebookSelectors.yourListings);
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open listing", async () => {
      const matches = (await adb.dumpUi()).filter((n) => n.text === title);
      if (matches.length === 0) throw new Error(`listing not found: ${title}`);
      if (matches.length > 1) {
        throw new Error(`ambiguous title: ${matches.length} listings named "${title}" — resolve on Facebook first`);
      }
      await adb.tapNode(matches[0]);
      await tapText(facebookSelectors.editListing);
      await waitForNode(adb, (n) => findByTestId(n, facebookSelectors.priceField), 15000, 500, "edit price field");
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "set price", async () => {
      const priceField = findByTestId(await adb.dumpUi(), facebookSelectors.priceField);
      if (!priceField) throw new Error("edit price field not found");
      await adb.tapNode(priceField);
      await adb.clearText();
      await adb.typeText(String(ctx.newPrice));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "save", async () => {
      // The edit screen's save control ("Publish"/"Save"); confirmed live.
      await tapText(facebookSelectors.publish);
      // Completion: the edit screen closed (price field gone).
      let closed = false;
      for (let i = 0; i < 10; i++) {
        const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
        if (nodes.length && !findByTestId(nodes, facebookSelectors.priceField)) {
          closed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!closed) throw new Error("edit screen did not close after save");
    }))
  )
    return resolveResult(t);

  return resolveResult(t);
}
