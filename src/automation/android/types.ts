import type { Item } from "@/db/schema";
import type { GeneratedListing } from "@/publishers/types";

export type AndroidResult =
  | { status: "posted_review" }   // new listing filled, awaiting Wil's Post tap
  | { status: "done" }            // hands-off flow completed
  | { status: "login_required" }
  | { status: "failed"; step: string; reason: string };

export interface FlowContext {
  listing: GeneratedListing;
  item: Item;
  photoPaths: string[];
  newPrice?: number;
}

export interface StepTracker { failed: { step: string; reason: string }[]; }
export function newTracker(): StepTracker { return { failed: [] }; }
export async function tryStep(t: StepTracker, step: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; }
  catch (e) { t.failed.push({ step, reason: e instanceof Error ? e.message : "unknown" }); return false; }
}
export function resolveResult(t: StepTracker): AndroidResult {
  if (t.failed.length === 0) return { status: "done" };
  return { status: "failed", step: t.failed[0].step, reason: t.failed[0].reason };
}
