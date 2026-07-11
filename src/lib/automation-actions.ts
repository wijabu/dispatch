"use server";

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { db, PHOTOS_DIR } from "@/db";
import { getItem } from "@/lib/queries";
import { getPublisher } from "@/publishers";
import { getFillScript, type FillResult } from "@/automation";
import { acquireFillLock, getBrowserContext, releaseFillLock } from "@/automation/browser";
import { AUTOFILL_CHANNELS, STAGING } from "@/config/staging";
import { stagePhotosCore } from "@/lib/staging-core";

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
