import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { items, listings } from "@/db/schema";
import type { AndroidResult } from "@/automation/android/types";
import { markListingRenewedCore, syncListingPriceCore } from "./task-actions";

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
