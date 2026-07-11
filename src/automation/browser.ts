import { chromium, type BrowserContext } from "playwright";
import path from "path";

// Singleton persistent context — same pattern as the db singleton.
// Headed: the whole point is a window the user reviews and submits in.
let contextPromise: Promise<BrowserContext> | null = null;

export function getBrowserContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = chromium
      .launchPersistentContext(
        path.join(process.cwd(), "data", "browser-profile"),
        { headless: false, viewport: null }
      )
      .then((ctx) => {
        // User closed the browser window entirely -> allow relaunch next time.
        ctx.on("close", () => {
          contextPromise = null;
        });
        return ctx;
      })
      .catch((err) => {
        contextPromise = null;
        throw err;
      });
  }
  return contextPromise;
}

// One fill at a time — a simple in-process lock.
let fillInProgress = false;

export function acquireFillLock(): boolean {
  if (fillInProgress) return false;
  fillInProgress = true;
  return true;
}

export function releaseFillLock(): void {
  fillInProgress = false;
}
