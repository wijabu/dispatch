import type { Listing } from "@/db/schema";
import type { RelistPolicy } from "@/publishers/types";
import { parseDbDate } from "@/lib/tasks";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export type RefreshState = "upcoming" | "due" | "overdue";

export interface RefreshStatus {
  dueAt: Date;
  state: RefreshState;
  token: string;
}

export interface ListingWithPolicy {
  listing: Pick<Listing, "listedAt" | "renewedAt">;
  policy: RelistPolicy;
}

// Magnitude-only formatter for a (non-negative) duration. Largest meaningful
// unit; never "0d". State prefixes ("due now"/"overdue") are added by
// refreshStatus, not here.
export function formatCountdown(ms: number): string {
  const v = Math.max(0, ms);
  if (v >= DAY_MS) return `${Math.floor(v / DAY_MS)}d`;
  if (v >= HOUR_MS) return `${Math.floor(v / HOUR_MS)}h`;
  return `${Math.max(1, Math.floor(v / MINUTE_MS))}m`;
}

// When a listing is next due to refresh, on a pure cadence clock:
//   dueAt = (renewedAt ?? listedAt) + max(intervalDays, minIntervalDays)
// Anchor is the last time the listing was refreshed/listed, uniform across
// channels (intentionally unlike computeTasks, which only uses renewedAt for the
// "renew-then-repost" method — here the meaning is simply "time since you last
// refreshed this").
export function refreshStatus(
  listing: Pick<Listing, "listedAt" | "renewedAt">,
  policy: RelistPolicy,
  now: Date
): RefreshStatus {
  const anchor = parseDbDate(listing.renewedAt ?? listing.listedAt);
  const intervalDays = Math.max(policy.intervalDays, policy.minIntervalDays);
  const dueAt = new Date(anchor.getTime() + intervalDays * DAY_MS);
  const delta = now.getTime() - dueAt.getTime(); // >= 0 means reached/past due

  if (delta < 0) return { dueAt, state: "upcoming", token: formatCountdown(-delta) };
  if (delta < DAY_MS) return { dueAt, state: "due", token: "due now" };
  return { dueAt, state: "overdue", token: `overdue ${formatCountdown(delta)}` };
}

// The soonest-due refresh across an item's active listings (for the tile).
// Earliest dueAt wins, so an overdue channel outranks an upcoming one. Returns
// null when there are no entries.
export function soonestRefresh(
  entries: ListingWithPolicy[],
  now: Date
): RefreshStatus | null {
  let best: RefreshStatus | null = null;
  for (const e of entries) {
    const s = refreshStatus(e.listing, e.policy, now);
    if (!best || s.dueAt < best.dueAt) best = s;
  }
  return best;
}
