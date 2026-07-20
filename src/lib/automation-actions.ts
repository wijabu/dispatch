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
  postOfferup, repriceOfferup, relistOfferup,
  postFacebook, repriceFacebook, relistFacebook,
  type AndroidResult,
} from "@/automation/android";
import { acquireAndroidLock, releaseAndroidLock } from "@/automation/android/device";
import { AUTOFILL_CHANNELS, STAGING } from "@/config/staging";
import { OFFERUP_AUTOMATION_ENABLED } from "@/config/android";
import { FACEBOOK_AUTOMATION_ENABLED } from "@/config/facebook";
import { stagePhotosCore } from "@/lib/staging-core";
import { markListingRenewedCore, syncListingPriceCore } from "@/lib/task-actions";

const run = promisify(execFile);
const STAGING_ROOT = path.join(process.cwd(), "data", "staging");

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

// Mirrors openAndPrefill's lock/load/generate/finally shape, but drives the
// Android emulator (via postOfferup) instead of the Playwright browser.
export async function postToOfferup(itemId: number): Promise<AndroidResult> {
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

// Pushes the item's current asking price (already dropped in Dispatch) out to
// the live OfferUp listing, then reconciles the listing's recorded price.
export async function dropOfferupPrice(
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

// Relist an item on OfferUp: post a fresh copy (auto-submit) then archive the
// old listing (hands-off, post-first/delete-last). On success stamps the
// ledger's renewedAt so the engine's relist cadence resets. Only fires once the
// item is at its floor (the engine suppresses relist tasks until asking <= min).
export async function relistOnOfferup(
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
      await markListingRenewedCore(db, listingId, new Date());
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

// ---- Facebook Marketplace (emulator FB app) — mirrors the OfferUp actions ----

export async function postToFacebook(itemId: number): Promise<AndroidResult> {
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

export async function dropFacebookPrice(
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

export async function relistOnFacebook(
  itemId: number,
  listingId: number
): Promise<AndroidResult> {
  if (!FACEBOOK_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "Facebook automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };

  // Facebook policy is renew-only: native Renew keeps the listing fresh, and a
  // fresh repost is impossible (FB blocks a duplicate main photo while the old
  // listing is live). Always renew; never repost.
  const action: "renew" | "relist" = "renew";

  const { photos, listings: _l, prices: _p, ...itemRow } = item;
  const listing = getPublisher("facebook")!.generate(itemRow, photos);
  const photoPaths = photos.map((p) => path.join(PHOTOS_DIR, p.path));

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another automation is running" };
  }
  let result: AndroidResult;
  try {
    result = await relistFacebook({ listing, item: itemRow, photoPaths }, { action });
    if (result.status === "done") await markListingRenewedCore(db, listingId, new Date());
  } catch (err) {
    result = { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    releaseAndroidLock();
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}/publish`);
  return result;
}
