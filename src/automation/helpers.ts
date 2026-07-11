import type { Page } from "playwright";
import type { FillResult } from "./types";

export interface StepTracker {
  filled: string[];
  failed: string[];
}

export function newTracker(): StepTracker {
  return { filled: [], failed: [] };
}

// Run one named step; a failure is recorded, never thrown — one broken
// selector must not abort the rest of the form.
export async function tryStep(
  t: StepTracker,
  name: string,
  fn: () => Promise<void>
): Promise<boolean> {
  try {
    await fn();
    t.filled.push(name);
    return true;
  } catch {
    t.failed.push(name);
    return false;
  }
}

export function resolveResult(t: StepTracker): FillResult {
  if (t.failed.length === 0) return { status: "ready" };
  if (t.filled.length === 0)
    return { status: "failed", reason: `${t.failed[0]} failed` };
  return { status: "partial", failedAt: t.failed[0], filled: t.filled };
}

// Uniform login-wall heuristic: a password field on the page we landed on.
export async function looksLikeLoginWall(page: Page): Promise<boolean> {
  return (await page.locator('input[type="password"]').count()) > 0;
}
