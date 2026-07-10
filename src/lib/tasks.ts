import type { Item, Listing } from "@/db/schema";
import type { Publisher } from "@/publishers/types";

const DAY_MS = 86_400_000;

// SQLite stores "YYYY-MM-DD HH:MM:SS" in UTC with no marker.
export function parseDbDate(value: string): Date {
  if (value.includes("T")) return new Date(value);
  if (value.includes(" ")) return new Date(value.replace(" ", "T") + "Z");
  return new Date(value + "T00:00:00Z");
}

export function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

export function computeDropTarget(item: Item): number | null {
  if (item.askingPrice == null) return null;
  const step =
    item.dropAmount ??
    (item.dropPercent != null ? (item.askingPrice * item.dropPercent) / 100 : null);
  if (step == null) return null;
  let target = Math.round(item.askingPrice - step);
  if (item.minimumPrice != null) target = Math.max(target, item.minimumPrice);
  return target < item.askingPrice ? target : null;
}

export type Task =
  | { type: "price_drop"; itemId: number; itemName: string; currentPrice: number; targetPrice: number }
  | { type: "relist"; itemId: number; itemName: string; listingId: number; publisherId: string; publisherName: string; action: "renew" | "relist"; ageDays: number }
  | { type: "stale_price"; itemId: number; itemName: string; listingId: number; publisherId: string; publisherName: string; listedPrice: number | null; askingPrice: number }
  | { type: "ready_to_publish"; itemId: number; itemName: string };

export interface TaskInputs {
  items: Item[];
  activeListings: Listing[];
  lastPriceChange: Map<number, string>;
  publishers: Publisher[];
  now: Date;
}

function isSnoozed(item: Item, now: Date): boolean {
  return item.snoozedUntil != null && parseDbDate(item.snoozedUntil) > now;
}

export function computeTasks(inputs: TaskInputs): Task[] {
  const { items, now, lastPriceChange } = inputs;
  const drops: Task[] = [];
  const stale: Task[] = [];
  const relists: Task[] = [];
  const ready: Task[] = [];

  const itemById = new Map(items.map((i) => [i.id, i]));
  const publisherById = new Map(inputs.publishers.map((p) => [p.id, p]));
  const activeByItem = new Map<number, number>();
  for (const l of inputs.activeListings) {
    activeByItem.set(l.itemId, (activeByItem.get(l.itemId) ?? 0) + 1);
  }

  for (const item of items) {
    if (isSnoozed(item, now)) continue;

    if (item.status === "ready" && !activeByItem.has(item.id)) {
      ready.push({ type: "ready_to_publish", itemId: item.id, itemName: item.name });
      continue;
    }
    if (item.status !== "published") continue;

    if (item.dropIntervalDays != null) {
      const target = computeDropTarget(item);
      if (target != null && item.askingPrice != null) {
        const anchor = parseDbDate(lastPriceChange.get(item.id) ?? item.createdAt);
        if (daysBetween(anchor, now) >= item.dropIntervalDays) {
          drops.push({
            type: "price_drop", itemId: item.id, itemName: item.name,
            currentPrice: item.askingPrice, targetPrice: target,
          });
        }
      }
    }
  }

  for (const listing of inputs.activeListings) {
    const item = itemById.get(listing.itemId);
    if (!item || item.status !== "published" || isSnoozed(item, now)) continue;
    const pub = publisherById.get(listing.publisher);
    if (!pub) continue;

    if (item.askingPrice != null && listing.listedPrice !== item.askingPrice) {
      stale.push({
        type: "stale_price", itemId: item.id, itemName: item.name,
        listingId: listing.id, publisherId: pub.id, publisherName: pub.name,
        listedPrice: listing.listedPrice, askingPrice: item.askingPrice,
      });
    }

    const policy = pub.relistPolicy;
    const listedAge = daysBetween(parseDbDate(listing.listedAt), now);
    const anchorAge = daysBetween(parseDbDate(listing.renewedAt ?? listing.listedAt), now);
    const freshDue =
      policy.freshRelistAfterDays != null && listedAge >= policy.freshRelistAfterDays;
    const due = anchorAge >= Math.max(policy.intervalDays, policy.minIntervalDays);
    if ((due || freshDue) && anchorAge >= policy.minIntervalDays) {
      relists.push({
        type: "relist", itemId: item.id, itemName: item.name,
        listingId: listing.id, publisherId: pub.id, publisherName: pub.name,
        action: policy.method === "renew-then-repost" && !freshDue ? "renew" : "relist",
        ageDays: anchorAge,
      });
    }
  }

  return [...drops, ...stale, ...relists, ...ready];
}
