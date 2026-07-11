import { chromium, type BrowserContext } from "playwright";
import path from "path";

// Singleton persistent context + fill lock, stashed on globalThis. Plain
// module state would reset on every Next dev hot-reload while the real
// Chromium keeps running — and relaunching launchPersistentContext on the
// same profile dir throws a profile-lock error, wedging the tool until the
// orphaned window is closed. globalThis survives module re-evaluation.
// Headed: the whole point is a window the user reviews and submits in.
const g = globalThis as unknown as {
  __dispatchContext?: Promise<BrowserContext> | null;
  __dispatchFillInProgress?: boolean;
};

export function getBrowserContext(): Promise<BrowserContext> {
  if (!g.__dispatchContext) {
    g.__dispatchContext = chromium
      .launchPersistentContext(
        path.join(process.cwd(), "data", "browser-profile"),
        { headless: false, viewport: null }
      )
      .then((ctx) => {
        // User closed the browser window entirely -> allow relaunch next time.
        ctx.on("close", () => {
          g.__dispatchContext = null;
        });
        return ctx;
      })
      .catch((err) => {
        g.__dispatchContext = null;
        throw err;
      });
  }
  return g.__dispatchContext;
}

// One fill at a time — a simple in-process lock.
export function acquireFillLock(): boolean {
  if (g.__dispatchFillInProgress) return false;
  g.__dispatchFillInProgress = true;
  return true;
}

export function releaseFillLock(): void {
  g.__dispatchFillInProgress = false;
}
