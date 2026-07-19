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
import { fillField, setFacebookLocation, tapLabel } from "./post";

// Reprice a live Facebook listing, hands-off: Seller Hub → Your listings → the
// listing's "⋯" management menu → Edit listing → replace price → (re-set
// location, since editing re-triggers the required-location gate) → Save.
// Selectors captured live 2026-07-19. Match the listing by its per-card menu
// content-desc ("Open management menu for <title>") and refuse an ambiguous
// (duplicate-title) match, mirroring flows/reprice.ts (OfferUp).
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
    !(await step(adb, t, "open edit", async () => {
      const menus = (await adb.dumpUi()).filter((n) => n.contentDesc === menuLabel);
      if (menus.length === 0) throw new Error(`listing not found: ${title}`);
      if (menus.length > 1) {
        throw new Error(`ambiguous title: ${menus.length} listings named "${title}" — resolve on Facebook first`);
      }
      await adb.tapNode(menus[0]);
      await tapLabel(adb, facebookSelectors.editListing);
      await waitForNode(adb, (n) => findByTestId(n, facebookSelectors.priceField), 15000, 500, "edit price field");
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "set price", () =>
      // Required-field verify: retries until the price field clears its "error"
      // content-desc, so a dropped keystroke can't silently leave the old price.
      fillField(adb, facebookSelectors.priceField, String(ctx.newPrice), true)
    ))
  )
    return resolveResult(t);

  // Editing re-triggers Facebook's required-location gate; re-set it before save.
  if (!(await step(adb, t, "set location", () => setFacebookLocation(adb))))
    return resolveResult(t);

  if (
    !(await step(adb, t, "save", async () => {
      await tapLabel(adb, facebookSelectors.saveEdit);
      // Completion: the edit composer closed (its price field is gone).
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
