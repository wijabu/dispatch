import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { items, listings } from "@/db/schema";
import type { AndroidResult } from "@/automation/android/types";
import { computeDropTarget } from "./tasks";
import {
  applyPriceDropCore,
  markListingRelistedCore,
  markListingRenewedCore,
  syncListingPriceCore,
} from "./task-actions";

type DB = BetterSQLite3Database<typeof schema>;

// One emulator operation on one item. Runs AFTER any price change and re-reads
// the item itself, so it always pushes the current asking price. The server
// action supplies real flows; tests supply fakes. Runners never take the
// Android lock: the caller holds it for the whole pass.
export type ChannelRunner = (itemId: number) => Promise<AndroidResult>;

export interface PushRunners {
  repriceOfferup: ChannelRunner;
  relistOfferup: ChannelRunner;
  repriceFacebook: ChannelRunner;
  renewFacebook: ChannelRunner;
}

export function describeFailure(result: AndroidResult): string {
  return result.status === "failed" ? `${result.step}: ${result.reason}` : result.status;
}

export async function safeRun(runner: ChannelRunner, itemId: number): Promise<AndroidResult> {
  try {
    return await runner(itemId);
  } catch (err) {
    return { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

// Facebook is renew-only (FB blocks a duplicate-photo repost), and renew never
// touches the price. So: renew, stamp renewedAt, then reprice if the live price
// is behind the asking price. listedPrice syncs ONLY on a successful reprice, so
// a failed reprice still shows up as a stale-price task.
export async function facebookRenewThenReprice(
  db: DB,
  itemId: number,
  listingId: number,
  runners: Pick<PushRunners, "renewFacebook" | "repriceFacebook">,
  now: Date
): Promise<AndroidResult> {
  const renew = await safeRun(runners.renewFacebook, itemId);
  if (renew.status !== "done") return renew;
  await markListingRenewedCore(db, listingId, now);

  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!listing || !item || item.askingPrice == null || listing.listedPrice === item.askingPrice) {
    return { status: "done" };
  }

  const reprice = await safeRun(runners.repriceFacebook, itemId);
  if (reprice.status === "done") {
    await syncListingPriceCore(db, listingId);
    return { status: "done" };
  }
  const screenshot = reprice.status === "failed" ? reprice.screenshot : undefined;
  return {
    status: "failed",
    step: "reprice",
    reason: `renewed; reprice failed: ${describeFailure(reprice)}`,
    ...(screenshot ? { screenshot } : {}),
  };
}

export type PushMode = "reprice" | "relist";

export interface ChannelOutcome {
  channel: string;
  outcome: "repriced" | "relisted" | "failed" | "manual";
  detail?: string;
  result?: AndroidResult; // the emulator result, kept for the log
}

export interface DropPushResult {
  newPrice: number | null;
  channels: ChannelOutcome[];
}

const CHANNEL_ORDER: Record<string, number> = { offerup: 0, facebook: 1 };

// The homepage drop task's one click: drop the price ONCE, then push it to
// every active listing Dispatch can drive (OfferUp, then Facebook). Other
// channels are reported as manual; their stale-price task is the cue. A failed
// channel keeps its old listedPrice, so it also surfaces as a stale-price task.
export async function dropAndPushCore(
  db: DB,
  itemId: number,
  mode: PushMode,
  runners: PushRunners,
  now: Date
): Promise<DropPushResult> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) {
    return { newPrice: null, channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }] };
  }
  if (computeDropTarget(item) == null) {
    return { newPrice: null, channels: [{ channel: "item", outcome: "failed", detail: "no price drop available" }] };
  }

  const newPrice = await applyPriceDropCore(db, itemId, now);

  const active = (
    await db
      .select()
      .from(listings)
      .where(and(eq(listings.itemId, itemId), eq(listings.status, "active")))
  ).sort((a, b) => (CHANNEL_ORDER[a.publisher] ?? 2) - (CHANNEL_ORDER[b.publisher] ?? 2));

  const done = mode === "reprice" ? "repriced" : "relisted";
  const channels: ChannelOutcome[] = [];
  for (const l of active) {
    let result: AndroidResult;
    if (l.publisher === "offerup") {
      result = await safeRun(mode === "reprice" ? runners.repriceOfferup : runners.relistOfferup, itemId);
      if (result.status === "done") {
        if (mode === "reprice") await syncListingPriceCore(db, l.id);
        else await markListingRelistedCore(db, l.id, now); // fresh post: new listedAt + price
      }
    } else if (l.publisher === "facebook") {
      if (mode === "reprice") {
        result = await safeRun(runners.repriceFacebook, itemId);
        if (result.status === "done") await syncListingPriceCore(db, l.id);
      } else {
        result = await facebookRenewThenReprice(db, itemId, l.id, runners, now);
      }
    } else {
      channels.push({ channel: l.publisher, outcome: "manual", detail: "update by hand" });
      continue;
    }
    channels.push(
      result.status === "done"
        ? { channel: l.publisher, outcome: done, result }
        : { channel: l.publisher, outcome: "failed", detail: describeFailure(result), result }
    );
  }
  return { newPrice, channels };
}
