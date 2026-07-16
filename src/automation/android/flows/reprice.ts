import { offerupTestIds } from "@/config/android";
import { findByTestId } from "../adb";
import { ensureAdbKeyboard, ensureBooted, isOfferupLoggedOut } from "../device";
import { newTracker, resolveResult, type AndroidResult, type FlowContext } from "../types";
import { step, waitForNode } from "./post";

// Reprice an existing OfferUp listing, hands-off: navigate to the listing's
// Edit-post screen (which reuses the post composer), replace the price, save.
// Captured live 2026-07-15: Account -> public profile -> listing (testId
// ProfileListingItem.btn.<title>) -> Manage this item -> Edit post -> composer.
export async function repriceOfferup(ctx: FlowContext): Promise<AndroidResult> {
  if (ctx.newPrice == null) {
    return { status: "failed", step: "reprice", reason: "no newPrice provided" };
  }
  const adb = await ensureBooted();
  if (await isOfferupLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  const title = ctx.item.name;
  const tap = async (testId: string) => {
    const node = findByTestId(await adb.dumpUi(), testId);
    if (!node) throw new Error(`not found: ${testId}`);
    await adb.tapNode(node);
  };

  if (
    !(await step(adb, t, "open account", async () => {
      await tap(offerupTestIds.accountTab);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.publicProfile));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open listings", async () => {
      await tap(offerupTestIds.publicProfile);
      await waitForNode(adb, (nodes) =>
        nodes.find((n) => n.testId.startsWith("ProfileListingItem.btn."))
      );
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open listing", async () => {
      const wanted = offerupTestIds.listingByTitle(title);
      let node = findByTestId(await adb.dumpUi(), wanted);
      for (let i = 0; i < 6 && !node; i++) {
        await adb.shell(["input", "swipe", "540", "1600", "540", "800", "250"]);
        await new Promise((r) => setTimeout(r, 800));
        node = findByTestId(await adb.dumpUi(), wanted);
      }
      if (!node) throw new Error(`listing not found: ${title}`);
      await adb.tapNode(node);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.manageOwnItem));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open edit", async () => {
      await tap(offerupTestIds.manageOwnItem);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.editPostLink));
      await tap(offerupTestIds.editPostLink);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.priceField));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "set price", async () => {
      await tap(offerupTestIds.priceField);
      await adb.clearText();
      await adb.typeText(String(ctx.newPrice));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "save", async () => {
      await tap(offerupTestIds.submitAction);
    }))
  )
    return resolveResult(t);

  return resolveResult(t);
}
