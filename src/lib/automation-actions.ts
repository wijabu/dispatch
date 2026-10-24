"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { revalidatePath } from "next/cache";
import { db, PHOTOS_DIR } from "@/db";
import { getItem } from "@/lib/queries";
import { getPublisher } from "@/publishers";
import { getFillScript, type FillResult } from "@/automation";
import { acquireFillLock, getBrowserContext, releaseFillLock } from "@/automation/browser";
import {
  postOfferup, repriceOfferup, relistOfferup, markSoldOfferup,
  postFacebook, repriceFacebook, relistFacebook, markSoldFacebook,
  type AndroidResult,
} from "@/automation/android";
import { acquireAndroidLock, releaseAndroidLock } from "@/automation/android/device";
import { AUTOFILL_CHANNELS, STAGING } from "@/config/staging";
import { OFFERUP_AUTOMATION_ENABLED } from "@/config/android";
import { FACEBOOK_AUTOMATION_ENABLED } from "@/config/facebook";
import { stagePhotosCore } from "@/lib/staging-core";
import {
  dropAndPushCore,
  facebookRenewThenReprice,
  type DropPushResult,
  type PushMode,
  type PushRunners,
} from "@/lib/drop-push-core";
import { applyPriceDropCore, markListingRelistedCore, syncListingPriceCore, markSoldCore, endListingCore } from "@/lib/task-actions";
import type { SoldChannel } from "@/db/schema";
import { eq } from "drizzle-orm";
import { items } from "@/db/schema";
import { logAutomation, resultFields, type AutomationAction } from "@/lib/automation-log";

const run = promisify(execFile);
const STAGING_ROOT = path.join(process.cwd(), "data", "staging");

async function itemNameFor(itemId: number): Promise<string | undefined> {
  try {
    const [row] = await db.select({ name: items.name }).from(items).where(eq(items.id, itemId));
    return row?.name;
  } catch {
    return undefined;
  }
}

// Run an emulator action and record its result in the automation log (file +
// Terminal). Logging never changes the returned result.
async function withLog(
  action: AutomationAction,
  itemId: number,
  channel: string,
  run: () => Promise<AndroidResult>
): Promise<AndroidResult> {
  const result = await run();
  await logAutomation({
    at: new Date().toISOString(),
    action,
    itemId,
    itemName: await itemNameFor(itemId),
    channel,
    ...resultFields(result),
  });
  return result;
}

export async function openAndPrefill(
  itemId: number,
  publisherId: string
): Promise<FillResult> {
  if (!AUTOFILL_CHANNELS[publisherId]) {
    return { status: "failed", reason: "Auto-fill is disabled for this channel" };
  }
  const script = getFillScript(publisherId);
  const publisher = getPublisher(publisherId);
  if (!script || !publisher) {
    return { status: "failed", reason: `No fill script for ${publisherId}` };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", reason: "Item not found" };

  if (!acquireFillLock()) {
    return { status: "failed", reason: "Another fill is already running — wait for it to finish" };
  }
  try {
    const { photos: itemPhotos, listings: _l, prices: _p, ...itemRow } = item;
    const listing = publisher.generate(itemRow, itemPhotos);
    const photoPaths = itemPhotos.map((p) => path.join(PHOTOS_DIR, p.path));

    const context = await getBrowserContext();
    const page = await context.newPage();
    await page.goto(script.startUrl, { timeout: 30000 });

    if (await script.isLoginWall(page)) {
      return { status: "login_required" }; // window stays open for the login
    }
    return await script.fill(page, { listing, item: itemRow, photoPaths });
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    releaseFillLock();
  }
}

// Open the channel's login/home page in Dispatch's browser so the user can
// authenticate once; the session then persists in the profile. Separate from
// openAndPrefill because the form page itself often won't render a login form
// when logged out (it just blanks). No fill lock — the user needs time here.
export async function openForLogin(
  publisherId: string
): Promise<{ ok: boolean; reason?: string }> {
  const script = getFillScript(publisherId);
  if (!script) return { ok: false, reason: `No fill script for ${publisherId}` };
  const loginUrl = script.loginUrl ?? new URL(script.startUrl).origin;
  try {
    const context = await getBrowserContext();
    const page = await context.newPage();
    await page.goto(loginUrl, { timeout: 30000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function stageForFacebook(
  itemId: number
): Promise<{ stagedPhotos: number }> {
  const staged = await stagePhotosCore(db, itemId, PHOTOS_DIR, STAGING_ROOT);
  if (staged.length > 0) {
    await run("open", [path.dirname(staged[0])]); // Finder window on the staged photos
  }
  await run("open", ["-a", STAGING.dedicatedBrowser, STAGING.facebookCreateUrl]);
  return { stagedPhotos: staged.length };
}

export async function openListingInDedicatedBrowser(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) throw new Error("Invalid listing URL");
  await run("open", ["-a", STAGING.dedicatedBrowser, url]);
}

// Real emulator runners for drop-push-core. Each re-reads the item (so it sees
// a price that was just dropped), generates the channel listing and drives the
// flow. They never take the Android lock; the calling action holds it.
function buildRunners(): PushRunners {
  const load = async (itemId: number, publisherId: "offerup" | "facebook") => {
    const item = await getItem(itemId);
    if (!item) return null;
    const { photos, listings: _l, prices: _p, ...itemRow } = item;
    return {
      item: itemRow,
      listing: getPublisher(publisherId)!.generate(itemRow, photos),
      photoPaths: photos.map((p) => path.join(PHOTOS_DIR, p.path)),
    };
  };
  const notFound: AndroidResult = { status: "failed", step: "load", reason: "Item not found" };
  const disabled = (name: string): AndroidResult => ({
    status: "failed", step: "config", reason: `${name} automation is disabled`,
  });
  return {
    repriceOfferup: async (itemId) => {
      if (!OFFERUP_AUTOMATION_ENABLED) return disabled("OfferUp");
      const ctx = await load(itemId, "offerup");
      if (!ctx) return notFound;
      return repriceOfferup({ ...ctx, photoPaths: [], newPrice: ctx.item.askingPrice ?? undefined });
    },
    relistOfferup: async (itemId) => {
      if (!OFFERUP_AUTOMATION_ENABLED) return disabled("OfferUp");
      const ctx = await load(itemId, "offerup");
      if (!ctx) return notFound;
      return relistOfferup(ctx);
    },
    repriceFacebook: async (itemId) => {
      if (!FACEBOOK_AUTOMATION_ENABLED) return disabled("Facebook");
      const ctx = await load(itemId, "facebook");
      if (!ctx) return notFound;
      return repriceFacebook({ ...ctx, photoPaths: [], newPrice: ctx.item.askingPrice ?? undefined });
    },
    renewFacebook: async (itemId) => {
      if (!FACEBOOK_AUTOMATION_ENABLED) return disabled("Facebook");
      const ctx = await load(itemId, "facebook");
      if (!ctx) return notFound;
      return relistFacebook(ctx, { action: "renew" });
    },
  };
}

// Mirrors openAndPrefill's lock/load/generate/finally shape, but drives the
// Android emulator (via postOfferup) instead of the Playwright browser.
async function postToOfferupRun(itemId: number): Promise<AndroidResult> {
  if (!OFFERUP_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "OfferUp automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };

  const { photos, listings: _l, prices: _p, ...itemRow } = item;
  const listing = getPublisher("offerup")!.generate(itemRow, photos);
  const photoPaths = photos.map((p) => path.join(PHOTOS_DIR, p.path));

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another OfferUp automation is running" };
  }
  try {
    return await postOfferup({ listing, item: itemRow, photoPaths });
  } catch (err) {
    return {
      status: "failed",
      step: "unknown",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    releaseAndroidLock();
  }
}

export async function postToOfferup(itemId: number): Promise<AndroidResult> {
  return withLog("post", itemId, "offerup", () => postToOfferupRun(itemId));
}

// Pushes the item's current asking price (already dropped in Dispatch) out to
// the live OfferUp listing, then reconciles the listing's recorded price.
async function dropOfferupPriceRun(
  itemId: number,
  listingId: number
): Promise<AndroidResult> {
  if (!OFFERUP_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "OfferUp automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };
  if (item.askingPrice == null) {
    return { status: "failed", step: "load", reason: "Item has no asking price" };
  }
  const newPrice = item.askingPrice;

  const { photos, listings: _l, prices: _p, ...itemRow } = item;
  const listing = getPublisher("offerup")!.generate(itemRow, photos);

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another OfferUp automation is running" };
  }
  let result: AndroidResult;
  try {
    result = await repriceOfferup({
      item: itemRow,
      listing,
      photoPaths: [],
      newPrice,
    });
    if (result.status === "done") {
      await syncListingPriceCore(db, listingId);
    }
  } catch (err) {
    result = {
      status: "failed",
      step: "unknown",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    releaseAndroidLock();
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}/publish`);
  return result;
}

export async function dropOfferupPrice(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("reprice", itemId, "offerup", () => dropOfferupPriceRun(itemId, listingId));
}

// Relist an item on OfferUp: post a fresh copy (auto-submit) then archive the
// old listing (hands-off, post-first/delete-last). On success stamps the
// ledger's renewedAt so the engine's relist cadence resets. Only fires once the
// item is at its floor (the engine suppresses relist tasks until asking <= min).
async function relistOnOfferupRun(
  itemId: number,
  listingId: number
): Promise<AndroidResult> {
  if (!OFFERUP_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "OfferUp automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };

  const { photos, listings: _l, prices: _p, ...itemRow } = item;
  const listing = getPublisher("offerup")!.generate(itemRow, photos);
  const photoPaths = photos.map((p) => path.join(PHOTOS_DIR, p.path));

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another OfferUp automation is running" };
  }
  let result: AndroidResult;
  try {
    result = await relistOfferup({ listing, item: itemRow, photoPaths });
    if (result.status === "done") {
      // Delete-repost = a fresh post at the current (possibly dropped) price.
      await markListingRelistedCore(db, listingId, new Date());
    }
  } catch (err) {
    result = {
      status: "failed",
      step: "unknown",
      reason: err instanceof Error ? err.message : "Unknown error",
    };
  } finally {
    releaseAndroidLock();
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}/publish`);
  return result;
}

export async function relistOnOfferup(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("relist", itemId, "offerup", () => relistOnOfferupRun(itemId, listingId));
}

// ---- Facebook Marketplace (emulator FB app) — mirrors the OfferUp actions ----


async function postToFacebookRun(itemId: number): Promise<AndroidResult> {
  if (!FACEBOOK_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "Facebook automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };
  const { photos, listings: _l, prices: _p, ...itemRow } = item;
  const listing = getPublisher("facebook")!.generate(itemRow, photos);
  const photoPaths = photos.map((p) => path.join(PHOTOS_DIR, p.path));

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another automation is running" };
  }
  try {
    return await postFacebook({ listing, item: itemRow, photoPaths });
  } catch (err) {
    return { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    releaseAndroidLock();
  }
}

export async function postToFacebook(itemId: number): Promise<AndroidResult> {
  return withLog("post", itemId, "facebook", () => postToFacebookRun(itemId));
}

async function dropFacebookPriceRun(
  itemId: number,
  listingId: number
): Promise<AndroidResult> {
  if (!FACEBOOK_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "Facebook automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };
  if (item.askingPrice == null) {
    return { status: "failed", step: "load", reason: "Item has no asking price" };
  }
  const { photos, listings: _l, prices: _p, ...itemRow } = item;
  const listing = getPublisher("facebook")!.generate(itemRow, photos);

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another automation is running" };
  }
  let result: AndroidResult;
  try {
    result = await repriceFacebook({ item: itemRow, listing, photoPaths: [], newPrice: item.askingPrice });
    if (result.status === "done") await syncListingPriceCore(db, listingId);
  } catch (err) {
    result = { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    releaseAndroidLock();
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}/publish`);
  return result;
}

export async function dropFacebookPrice(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("reprice", itemId, "facebook", () => dropFacebookPriceRun(itemId, listingId));
}

async function relistOnFacebookRun(
  itemId: number,
  listingId: number
): Promise<AndroidResult> {
  if (!FACEBOOK_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "Facebook automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another automation is running" };
  }
  let result: AndroidResult;
  try {
    // Facebook policy is renew-only, and renew leaves the price alone. Renew,
    // then reprice if a drop left the live price behind; listedPrice syncs only
    // when that reprice succeeds.
    result = await facebookRenewThenReprice(db, itemId, listingId, buildRunners(), new Date());
  } catch (err) {
    result = { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    releaseAndroidLock();
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}/publish`);
  return result;
}

export async function relistOnFacebook(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("relist", itemId, "facebook", () => relistOnFacebookRun(itemId, listingId));
}

// Drop the item's price one step (floored at its minimum via applyPriceDropCore),
// then relist the given channel at the new price by delegating to that channel's
// existing relist action. The UI button is disabled unless computeDropTarget(item)
// != null, so a null drop here is defensive only.
export async function relistWithDrop(
  itemId: number,
  listingId: number,
  publisherId: string
): Promise<AndroidResult> {
  // Guard the channel BEFORE dropping, so an unsupported publisher never lowers
  // the price and then fails.
  if (publisherId !== "offerup" && publisherId !== "facebook") {
    return {
      status: "failed",
      step: "drop",
      reason: `relist+drop not supported for ${publisherId}`,
    };
  }
  const dropped = await applyPriceDropCore(db, itemId, new Date());
  if (dropped == null) {
    return {
      status: "failed",
      step: "drop",
      reason: "no price drop available (no step configured or already at floor)",
    };
  }
  return publisherId === "offerup"
    ? relistOnOfferup(itemId, listingId)
    : relistOnFacebook(itemId, listingId);
}

async function logDropPush(action: AutomationAction, itemId: number, result: DropPushResult): Promise<void> {
  const itemName = await itemNameFor(itemId);
  for (const c of result.channels) {
    const screenshot = c.result?.status === "failed" ? c.result.screenshot : undefined;
    await logAutomation({
      at: new Date().toISOString(),
      action,
      itemId,
      itemName,
      channel: c.channel,
      outcome: c.outcome,
      ...(c.detail ? { reason: c.detail } : {}),
      ...(screenshot ? { screenshot } : {}),
    });
  }
}

// Homepage drop task: drop the price once, then reprice or relist every active
// OfferUp/Facebook listing in one pass. Takes the Android lock once, and only
// when an emulator channel is involved, so a manual-only drop never waits on
// the emulator. Deliberately does NOT revalidate: the drop task would vanish
// and take its result lines with it. The client calls refreshAfterDrop once the
// user has read them.
export async function dropAndPush(itemId: number, mode: PushMode): Promise<DropPushResult> {
  const action: AutomationAction = mode === "reprice" ? "drop_reprice" : "drop_relist";
  const item = await getItem(itemId);
  const usesEmulator = !!item?.listings.some(
    (l) => l.status === "active" && (l.publisher === "offerup" || l.publisher === "facebook")
  );

  if (usesEmulator && !acquireAndroidLock()) {
    const busy: DropPushResult = {
      newPrice: null,
      channels: [{ channel: "emulator", outcome: "failed", detail: "another automation is running" }],
    };
    await logDropPush(action, itemId, busy);
    return busy;
  }
  let result: DropPushResult;
  try {
    result = await dropAndPushCore(db, itemId, mode, buildRunners(), new Date());
  } catch (err) {
    result = {
      newPrice: null,
      channels: [{ channel: "item", outcome: "failed", detail: err instanceof Error ? err.message : "Unknown error" }],
    };
  } finally {
    if (usesEmulator) releaseAndroidLock();
  }
  await logDropPush(action, itemId, result);
  return result;
}

// Called when the user acknowledges a dropAndPush result.
export async function refreshAfterDrop(itemId: number): Promise<void> {
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/publish`);
}

export type SoldResult = {
  soldPrice: number | null;
  soldChannel: SoldChannel | null;
  channels: { channel: string; outcome: "ended" | "failed" | "manual" | "skipped"; detail?: string; screenshot?: string }[];
};

// One-click sale reconciliation. Records the sale, then takes the item down on
// every ACTIVE channel: OfferUp + Facebook via the emulator, Craigslist left for
// manual takedown. Any row still active afterward (Craigslist, or a failed
// emulator takedown) surfaces as a computed manual_takedown task — this action
// writes no task itself. The sale is recorded even if every takedown fails.
export async function markSoldAndTakedown(
  itemId: number,
  soldPrice: number | null,
  soldChannel: SoldChannel | null
): Promise<SoldResult> {
  const item = await getItem(itemId);
  if (!item) {
    await logAutomation({
      at: new Date().toISOString(), action: "mark_sold", itemId, channel: "item",
      outcome: "failed", reason: "Item not found",
    });
    return { soldPrice, soldChannel, channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }] };
  }
  const { photos, listings: itemListings, prices: _p, ...itemRow } = item;

  // 1. Record the sale first — independent of any takedown.
  await markSoldCore(db, itemId, soldPrice, soldChannel, new Date());

  const active = itemListings.filter((l) => l.status === "active");
  const channels: SoldResult["channels"] = [];

  // 2. Per-channel takedown. Emulator channels share the android lock; take it
  // once for the whole pass so OfferUp and Facebook don't contend.
  const hasEmulatorChannel = active.some((l) => l.publisher === "offerup" || l.publisher === "facebook");
  let androidLocked = false;
  if (hasEmulatorChannel) androidLocked = acquireAndroidLock();

  try {
    for (const l of active) {
      if (l.publisher === "craigslist") {
        channels.push({ channel: "craigslist", outcome: "manual", detail: "Delete the post yourself" });
        continue;
      }
      if (l.publisher === "offerup" || l.publisher === "facebook") {
        const enabled = l.publisher === "offerup" ? OFFERUP_AUTOMATION_ENABLED : FACEBOOK_AUTOMATION_ENABLED;
        if (!enabled) {
          channels.push({ channel: l.publisher, outcome: "failed", detail: "automation disabled" });
          continue;
        }
        if (!androidLocked) {
          channels.push({ channel: l.publisher, outcome: "failed", detail: "another automation is running" });
          continue;
        }
        let result: AndroidResult;
        try {
          result = l.publisher === "offerup"
            ? await markSoldOfferup({ item: itemRow, listing: getPublisher("offerup")!.generate(itemRow, photos), photoPaths: [] })
            : await markSoldFacebook({ item: itemRow, listing: getPublisher("facebook")!.generate(itemRow, photos), photoPaths: [] });
        } catch (err) {
          result = { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
        }
        if (result.status === "done") {
          await endListingCore(db, l.id, new Date());
          channels.push({ channel: l.publisher, outcome: "ended" });
        } else {
          const detail = result.status === "failed" ? `${result.step}: ${result.reason}` : result.status;
          const screenshot = result.status === "failed" ? result.screenshot : undefined;
          channels.push({ channel: l.publisher, outcome: "failed", detail, ...(screenshot ? { screenshot } : {}) });
        }
        continue;
      }
      // Any other channel (reddit/watchuseek) has no takedown automation.
      channels.push({ channel: l.publisher, outcome: "manual", detail: "take down manually" });
    }
  } finally {
    if (androidLocked) releaseAndroidLock();
  }

  for (const c of channels) {
    await logAutomation({
      at: new Date().toISOString(),
      action: "mark_sold",
      itemId,
      itemName: itemRow.name,
      channel: c.channel,
      outcome: c.outcome,
      ...(c.detail ? { reason: c.detail } : {}),
      ...(c.screenshot ? { screenshot: c.screenshot } : {}),
    });
  }

  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  return { soldPrice, soldChannel, channels };
}
