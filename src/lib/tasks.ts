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
  const tasks: Task[] = [];

  for (const item of items) {
    if (item.status !== "published" || isSnoozed(item, now)) continue;
    if (item.dropIntervalDays == null) continue;
    const target = computeDropTarget(item);
    if (target == null || item.askingPrice == null) continue;
    const anchor = parseDbDate(lastPriceChange.get(item.id) ?? item.createdAt);
    if (daysBetween(anchor, now) < item.dropIntervalDays) continue;
    tasks.push({
      type: "price_drop",
      itemId: item.id,
      itemName: item.name,
      currentPrice: item.askingPrice,
      targetPrice: target,
    });
  }

  return tasks;
}
