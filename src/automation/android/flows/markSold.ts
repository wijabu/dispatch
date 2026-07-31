import { offerupTestIds } from "@/config/android";
import { findByContentDesc, findByTestId, type UiNode } from "../adb";
import { ensureAdbKeyboard, ensureBooted, isOfferupLoggedOut, launchOfferup } from "../device";
import { newTracker, resolveResult, type AndroidResult, type FlowContext } from "../types";
import { step, waitForNode } from "./post";

// Mark an existing OfferUp listing SOLD, hands-off. Captured live 2026-07-31:
// Account -> public profile -> listing -> Manage this item -> Mark sold ->
// affirm "can't be undone" -> "Who bought it?" -> "Sold it somewhere else"
// -> Confirm -> dismiss the post-sale donation upsell. Always "sold elsewhere":
// matching a real OfferUp buyer is unreliable, so we never rate one here.
export async function markSoldOfferup(ctx: FlowContext): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchOfferup(adb);
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
      let matches = (await adb.dumpUi()).filter((n) => n.testId === wanted);
      for (let i = 0; i < 6 && matches.length === 0; i++) {
        await adb.shell(["input", "swipe", "540", "1600", "540", "800", "250"]);
        await new Promise((r) => setTimeout(r, 800));
        matches = (await adb.dumpUi()).filter((n) => n.testId === wanted);
      }
      if (matches.length === 0) throw new Error(`listing not found: ${title}`);
      if (matches.length > 1) {
        throw new Error(`ambiguous title: ${matches.length} listings named "${title}" — resolve on OfferUp first`);
      }
      await adb.tapNode(matches[0]);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.manageOwnItem));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open dashboard", async () => {
      await tap(offerupTestIds.manageOwnItem);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.markSold));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "mark sold", async () => {
      await tap(offerupTestIds.markSold);
      // "This can't be undone" affirm dialog.
      const affirm = await waitForNode(adb, (nodes) =>
        findByTestId(nodes, offerupTestIds.markSoldAffirm)
      );
      await adb.tapNode(affirm);
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "sold elsewhere", async () => {
      // "Who bought it?" screen — select the "Sold it somewhere else" radio row
      // (content-desc combines both lines), then Confirm.
      const row = await waitForNode(adb, (nodes) =>
        nodes.find((n) => n.contentDesc.includes(offerupTestIds.soldElsewhereText))
      );
      await adb.tapNode(row);
      await new Promise((r) => setTimeout(r, 800));
      const confirm = findByContentDesc(await adb.dumpUi(), offerupTestIds.soldConfirm);
      if (!confirm) throw new Error("Confirm button not found on 'Who bought it?'");
      await adb.tapNode(confirm);
    }))
  )
    return resolveResult(t);

  // Post-sale ASPCA donation upsell — dismiss if shown; never tap "Donate".
  // Best-effort: absence is fine, so this is not a tracked step.
  for (let i = 0; i < 3; i++) {
    const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
    const dismiss = findByContentDesc(nodes, offerupTestIds.soldDonationDismiss);
    if (!dismiss) break;
    await adb.tapNode(dismiss);
    await new Promise((r) => setTimeout(r, 800));
  }

  return resolveResult(t);
}
