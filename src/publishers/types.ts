import type { Item, Photo } from "@/db/schema";

export interface GeneratedListing {
  title: string;
  body: string;
  structuredFields?: Record<string, string>;
  warnings: string[];
}

export interface RelistPolicy {
  method: "repost" | "delete-repost" | "renew-then-repost" | "bump";
  /** engine suggests action at this age (days) */
  intervalDays: number;
  /** hard platform rule — engine NEVER suggests inside this window */
  minIntervalDays: number;
  /** after this many days since original listing, suggest a fresh relist instead of renew */
  freshRelistAfterDays?: number;
}

export interface Publisher {
  id: string;
  name: string;
  relistPolicy: RelistPolicy;
  generate(item: Item, photos: Photo[]): GeneratedListing;
}
