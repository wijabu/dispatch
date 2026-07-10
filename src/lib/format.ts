import type { Condition, ItemStatus } from "@/db/schema";
import type { RelistPolicy } from "@/publishers/types";

export const STATUS_LABELS: Record<ItemStatus, string> = {
  draft: "Draft",
  ready: "Ready to publish",
  published: "Published",
  needs_repricing: "Needs repricing",
  needs_relisting: "Needs relisting",
  sold: "Sold",
  archived: "Archived",
};

export const STATUS_COLORS: Record<ItemStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ready: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  published:
    "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  needs_repricing:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  needs_relisting:
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  sold: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  archived: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  new: "New",
  like_new: "Like new",
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  for_parts: "For parts",
};

export function formatPrice(price: number | null): string {
  if (price == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
}

export function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date.includes("T") ? date : date + "Z").toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" }
  );
}

export function describeRelistPolicy(policy: RelistPolicy): string {
  const every = `every ${policy.intervalDays} days`;
  switch (policy.method) {
    case "repost":
      return `Repost ${every} (no sooner — platform rule)`;
    case "delete-repost":
      return `Delete + fresh post ${every}`;
    case "renew-then-repost":
      return `Renew ${every}${policy.freshRelistAfterDays ? `; fresh relist after ${policy.freshRelistAfterDays} days` : ""}`;
    case "bump":
      return `Bump thread ${every}`;
  }
}
