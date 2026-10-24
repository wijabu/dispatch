# Drop-and-Push + Automation Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage price-drop task push the new price to live OfferUp/Facebook listings (reprice or relist, one click, all channels), fix Facebook relist recording a price FB never received, and log every emulator action to a file and the Terminal.

**Architecture:** Pure, DB-injected core logic in `src/lib/drop-push-core.ts` (tested against in-memory SQLite with fake emulator "runners"); thin `"use server"` wrappers in `src/lib/automation-actions.ts` take the Android lock, wire real flows in as runners, and log results via a best-effort logger in `src/lib/automation-log.ts`. Failure screenshots get linked to results through the existing step tracker.

**Tech Stack:** Next.js 16.2 App Router (server actions), TypeScript, Drizzle ORM + better-sqlite3, Vitest, React 19 client components, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-24-drop-and-push-design.md`

## Global Constraints

- **DB safety (hard rule):** never run `npm run build`, `npm start`, or `next build`/`next start`. Never read, write, move or reset `data/dispatch.db`. Verify only with `npx tsc --noEmit`, `npx eslint <paths>`, `npx vitest run`.
- **Tests never import `@/db` or `@/lib/automation-actions`** (importing `@/db` opens the real `data/dispatch.db` and runs migrations). Tests use `new Database(":memory:")` + `migrate(...)` exactly as `src/lib/__tests__/task-actions.test.ts` does.
- **Never drive the emulator** in any step. Live checks are Wil's.
- `"use server"` files may only **export** async functions (and types). Helpers there stay non-exported.
- Code style: match surrounding files (2-space indent, double quotes, short "why" comments, no em-dashes in new comments).
- Commit after each task. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Work on branch `drop-and-push` (already created off `origin/main`).

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/automation/android/types.ts` | modify | `AndroidResult.failed` + tracker carry optional `screenshot` |
| `src/automation/android/flows/post.ts` | modify | `captureFailureScreenshot` returns path; `step()` records it |
| `src/automation/android/__tests__/tracker.test.ts` | modify | screenshot linking tests |
| `src/lib/automation-log.ts` | create | JSONL + Terminal logger |
| `src/lib/__tests__/automation-log.test.ts` | create | logger tests |
| `src/lib/drop-push-core.ts` | create | runner types, `facebookRenewThenReprice`, `dropAndPushCore` |
| `src/lib/__tests__/drop-push-core.test.ts` | create | core tests (in-memory DB, fake runners) |
| `src/lib/automation-actions.ts` | modify | logging wrappers, `buildRunners`, FB relist fix, `dropAndPush`, `refreshAfterDrop` |
| `src/lib/tasks.ts` | modify | `price_drop.autoChannels` |
| `src/lib/__tests__/tasks.test.ts` | modify | `autoChannels` expectations |
| `src/components/DropTaskActions.tsx` | create | two-button drop UI + result lines |
| `src/components/TaskSection.tsx` | modify | use `DropTaskActions` |
| `src/lib/actions.ts` | modify | delete `applyPriceDrop` |

---

### Task 1: Link failure screenshots to results

**Files:**
- Modify: `src/automation/android/types.ts`
- Modify: `src/automation/android/flows/post.ts:72-99`
- Test: `src/automation/android/__tests__/tracker.test.ts`

**Interfaces:**
- Produces: `AndroidResult` failed variant `{ status: "failed"; step: string; reason: string; screenshot?: string }`; `StepFailure { step; reason; screenshot? }`; `captureFailureScreenshot(adb, step): Promise<string | undefined>`.

- [ ] **Step 1: Write the failing tests**

Replace `src/automation/android/__tests__/tracker.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { newTracker, tryStep, resolveResult } from "../types";
import { step } from "../flows/post";
import type { Adb } from "../adb";

describe("android flow tracker", () => {
  it("returns done when all steps pass", async () => {
    const t = newTracker();
    await tryStep(t, "a", async () => {});
    expect(resolveResult(t)).toEqual({ status: "done" });
  });
  it("returns failed with the first failing step name", async () => {
    const t = newTracker();
    await tryStep(t, "open", async () => {});
    await tryStep(t, "price", async () => { throw new Error("no node"); });
    expect(resolveResult(t)).toEqual({ status: "failed", step: "price", reason: "no node" });
  });
  it("carries the first failure's screenshot into the result", () => {
    const t = newTracker();
    t.failed.push({ step: "save", reason: "timeout", screenshot: "/tmp/shot.png" });
    expect(resolveResult(t)).toEqual({
      status: "failed", step: "save", reason: "timeout", screenshot: "/tmp/shot.png",
    });
  });
});

describe("step()", () => {
  it("records the failure screenshot path on the tracker", async () => {
    const fakeAdb = { screencap: async () => {} } as unknown as Adb;
    const t = newTracker();
    const ok = await step(fakeAdb, t, "set price", async () => { throw new Error("no node"); });
    expect(ok).toBe(false);
    expect(t.failed[0].screenshot).toMatch(/automation-debug[\\/]post-set-price-\d+\.png$/);
    expect(resolveResult(t)).toMatchObject({ status: "failed", step: "set price", reason: "no node" });
  });
  it("leaves screenshot unset when the capture fails", async () => {
    const fakeAdb = { screencap: async () => { throw new Error("adb gone"); } } as unknown as Adb;
    const t = newTracker();
    await step(fakeAdb, t, "save", async () => { throw new Error("boom"); });
    expect(resolveResult(t)).toEqual({ status: "failed", step: "save", reason: "boom" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/automation/android/__tests__/tracker.test.ts`
Expected: FAIL. The "carries the first failure's screenshot" test fails (screenshot dropped), "records the failure screenshot path" fails (`screenshot` undefined). TypeScript-level `screenshot` field errors may also appear.

- [ ] **Step 3: Implement**

In `src/automation/android/types.ts`, replace the `AndroidResult` type and the tracker section with:

```ts
export type AndroidResult =
  | { status: "posted_review" }   // new listing filled, awaiting Wil's Post tap
  | { status: "done" }            // hands-off flow completed
  | { status: "login_required" }
  | { status: "failed"; step: string; reason: string; screenshot?: string };
```

```ts
export interface StepFailure { step: string; reason: string; screenshot?: string; }
export interface StepTracker { failed: StepFailure[]; }
export function newTracker(): StepTracker { return { failed: [] }; }
export async function tryStep(t: StepTracker, step: string, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; }
  catch (e) { t.failed.push({ step, reason: e instanceof Error ? e.message : "unknown" }); return false; }
}
export function resolveResult(t: StepTracker): AndroidResult {
  if (t.failed.length === 0) return { status: "done" };
  const { step, reason, screenshot } = t.failed[0];
  return screenshot
    ? { status: "failed", step, reason, screenshot }
    : { status: "failed", step, reason };
}
```

In `src/automation/android/flows/post.ts`, replace `captureFailureScreenshot` and `step` (currently lines 72-99) with:

```ts
// Returns the path written, or undefined if the capture failed.
export async function captureFailureScreenshot(adb: Adb, step: string): Promise<string | undefined> {
  try {
    await fs.promises.mkdir(ANDROID.debugDir, { recursive: true });
    const dest = path.join(
      ANDROID.debugDir,
      `post-${step.replace(/\s+/g, "-")}-${Date.now()}.png`
    );
    await adb.screencap(dest);
    return dest;
  } catch {
    // Best-effort debug artifact; a failed capture must never mask the real failure.
    return undefined;
  }
}

// Runs `fn` under tryStep and, if it fails, captures a debug screenshot before
// the caller bails out via resolveResult. Every step in this flow stops the
// whole run on failure — once the on-device UI state is unknown, blindly
// continuing to tap through the rest of the form risks fat-fingering the wrong
// control, so we degrade to resolveResult(t) instead. The screenshot path rides
// on the failure so the automation log can point at it.
export async function step(
  adb: Adb,
  t: StepTracker,
  name: string,
  fn: () => Promise<void>
): Promise<boolean> {
  const ok = await tryStep(t, name, fn);
  if (!ok) {
    const shot = await captureFailureScreenshot(adb, name);
    if (shot) t.failed[t.failed.length - 1].screenshot = shot;
  }
  return ok;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/automation/android/__tests__/tracker.test.ts`
Expected: PASS (5 tests).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/automation/android/types.ts src/automation/android/flows/post.ts src/automation/android/__tests__/tracker.test.ts
git commit -m "feat(android): link failure screenshots to flow results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Automation logger

**Files:**
- Create: `src/lib/automation-log.ts`
- Test: `src/lib/__tests__/automation-log.test.ts`

**Interfaces:**
- Consumes: `AndroidResult` (Task 1).
- Produces:
  ```ts
  type AutomationAction = "post" | "reprice" | "relist" | "mark_sold" | "drop_reprice" | "drop_relist";
  interface AutomationLogEntry { at: string; action: AutomationAction; itemId: number; itemName?: string; channel: string; outcome: string; step?: string; reason?: string; screenshot?: string; }
  resultFields(result: AndroidResult): Pick<AutomationLogEntry, "outcome" | "step" | "reason" | "screenshot">
  formatLogLine(e: AutomationLogEntry): string
  logAutomation(entry: AutomationLogEntry, file?: string): Promise<void>
  AUTOMATION_LOG_PATH: string  // <cwd>/data/automation-log.jsonl
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/automation-log.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  formatLogLine,
  logAutomation,
  resultFields,
  type AutomationLogEntry,
} from "../automation-log";

const AT = "2026-10-24T13:42:01.000Z";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-log-"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resultFields", () => {
  it("maps a success to its status", () => {
    expect(resultFields({ status: "done" })).toEqual({ outcome: "done" });
    expect(resultFields({ status: "login_required" })).toEqual({ outcome: "login_required" });
  });
  it("maps a failure with step, reason and screenshot", () => {
    expect(
      resultFields({ status: "failed", step: "save", reason: "timeout", screenshot: "/x.png" })
    ).toEqual({ outcome: "failed", step: "save", reason: "timeout", screenshot: "/x.png" });
  });
  it("omits screenshot when the failure has none", () => {
    expect(resultFields({ status: "failed", step: "lock", reason: "busy" })).toEqual({
      outcome: "failed", step: "lock", reason: "busy",
    });
  });
});

describe("formatLogLine", () => {
  it("formats a full failure", () => {
    const e: AutomationLogEntry = {
      at: AT, action: "relist", itemId: 16, itemName: "Jumperoo", channel: "offerup",
      outcome: "failed", step: "archive old listing", reason: "not confirmed", screenshot: "/d/a.png",
    };
    expect(formatLogLine(e)).toBe(
      '[automation] 2026-10-24T13:42:01.000Z relist offerup #16 "Jumperoo" failed archive old listing: not confirmed (screenshot: /d/a.png)'
    );
  });
  it("formats a minimal success", () => {
    expect(
      formatLogLine({ at: AT, action: "reprice", itemId: 3, channel: "facebook", outcome: "done" })
    ).toBe("[automation] 2026-10-24T13:42:01.000Z reprice facebook #3 done");
  });
  it("formats a reason without a step", () => {
    expect(
      formatLogLine({ at: AT, action: "drop_reprice", itemId: 3, channel: "craigslist", outcome: "manual", reason: "update by hand" })
    ).toBe("[automation] 2026-10-24T13:42:01.000Z drop_reprice craigslist #3 manual update by hand");
  });
});

describe("logAutomation", () => {
  it("appends one JSON line per entry and prints the readable line", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const file = path.join(tmpDir(), "nested", "automation-log.jsonl");
    const a: AutomationLogEntry = { at: AT, action: "post", itemId: 1, channel: "offerup", outcome: "posted_review" };
    const b: AutomationLogEntry = { at: AT, action: "reprice", itemId: 2, channel: "facebook", outcome: "failed", step: "lock", reason: "busy" };
    await logAutomation(a, file);
    await logAutomation(b, file);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([a, b]);
    expect(spy).toHaveBeenCalledWith(formatLogLine(a));
  });
  it("swallows write errors", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = tmpDir(); // appending to a directory fails with EISDIR
    await expect(
      logAutomation({ at: AT, action: "post", itemId: 1, channel: "offerup", outcome: "done" }, dir)
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/automation-log.test.ts`
Expected: FAIL with "Failed to resolve import ../automation-log" (module doesn't exist).

- [ ] **Step 3: Implement**

Create `src/lib/automation-log.ts`:

```ts
import fs from "fs";
import path from "path";
import type { AndroidResult } from "@/automation/android/types";

// Durable record of every emulator action. Server actions otherwise return
// their result to the page only, so a failure's reason is gone once the page
// refreshes. One JSON object per line; gitignored via data/.
export const AUTOMATION_LOG_PATH = path.join(process.cwd(), "data", "automation-log.jsonl");

export type AutomationAction =
  | "post"
  | "reprice"
  | "relist"
  | "mark_sold"
  | "drop_reprice"
  | "drop_relist";

export interface AutomationLogEntry {
  at: string; // ISO timestamp
  action: AutomationAction;
  itemId: number;
  itemName?: string;
  channel: string;
  outcome: string;
  step?: string;
  reason?: string;
  screenshot?: string; // under data/automation-debug/
}

export function resultFields(
  result: AndroidResult
): Pick<AutomationLogEntry, "outcome" | "step" | "reason" | "screenshot"> {
  if (result.status !== "failed") return { outcome: result.status };
  return {
    outcome: "failed",
    step: result.step,
    reason: result.reason,
    ...(result.screenshot ? { screenshot: result.screenshot } : {}),
  };
}

export function formatLogLine(e: AutomationLogEntry): string {
  let line = `[automation] ${e.at} ${e.action} ${e.channel} #${e.itemId}`;
  if (e.itemName) line += ` "${e.itemName}"`;
  line += ` ${e.outcome}`;
  if (e.reason) line += e.step ? ` ${e.step}: ${e.reason}` : ` ${e.reason}`;
  if (e.screenshot) line += ` (screenshot: ${e.screenshot})`;
  return line;
}

// Prints to stdout (the Dispatch Terminal window) and appends to the JSONL
// file. Best-effort: logging must never fail or mask the action it records.
export async function logAutomation(
  entry: AutomationLogEntry,
  file: string = AUTOMATION_LOG_PATH
): Promise<void> {
  console.log(formatLogLine(entry));
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, JSON.stringify(entry) + "\n");
  } catch {
    // ignore; the Terminal line above is the fallback record
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/automation-log.test.ts`
Expected: PASS (8 tests).

Run: `npx tsc --noEmit && npx eslint src/lib/automation-log.ts src/lib/__tests__/automation-log.test.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/automation-log.ts src/lib/__tests__/automation-log.test.ts
git commit -m "feat(log): add JSONL + Terminal automation logger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Log every existing emulator action

**Files:**
- Modify: `src/lib/automation-actions.ts`

**Interfaces:**
- Consumes: `logAutomation`, `resultFields`, `AutomationAction` (Task 2); `AndroidResult.screenshot` (Task 1).
- Produces (non-exported, used by Tasks 4 and 6): `withLog(action, itemId, channel, run)`, `itemNameFor(itemId)`. `SoldResult.channels[]` gains optional `screenshot?: string`.

No unit test: this file imports `@/db`, which opens the real database (see Global Constraints). Verification is `tsc` + `eslint` + the full suite still passing.

- [ ] **Step 1: Add imports and the logging helpers**

In `src/lib/automation-actions.ts`, add to the imports:

```ts
import { eq } from "drizzle-orm";
import { items } from "@/db/schema";
import { logAutomation, resultFields, type AutomationAction } from "@/lib/automation-log";
```

(`import type { SoldChannel } from "@/db/schema";` stays as is.)

Below `const STAGING_ROOT = ...`, add:

```ts
async function itemNameFor(itemId: number): Promise<string | undefined> {
  try {
    const [row] = await db.select({ name: items.name }).from(items).where(eq(items.id, itemId));
    return row?.name;
  } catch {
    return undefined;
  }
}

// Run an emulator action and record its result in the automation log (file +
// Terminal). Logging never changes the returned result.
async function withLog(
  action: AutomationAction,
  itemId: number,
  channel: string,
  run: () => Promise<AndroidResult>
): Promise<AndroidResult> {
  const result = await run();
  await logAutomation({
    at: new Date().toISOString(),
    action,
    itemId,
    itemName: await itemNameFor(itemId),
    channel,
    ...resultFields(result),
  });
  return result;
}
```

- [ ] **Step 2: Wrap the six single-channel actions**

For each of these six functions, rename the existing implementation to a non-exported `...Run` function (body unchanged) and add an exported wrapper with the original name directly after it:

| Existing export | Rename to | Wrapper `action`, `channel` |
|---|---|---|
| `postToOfferup(itemId)` | `postToOfferupRun` | `"post"`, `"offerup"` |
| `dropOfferupPrice(itemId, listingId)` | `dropOfferupPriceRun` | `"reprice"`, `"offerup"` |
| `relistOnOfferup(itemId, listingId)` | `relistOnOfferupRun` | `"relist"`, `"offerup"` |
| `postToFacebook(itemId)` | `postToFacebookRun` | `"post"`, `"facebook"` |
| `dropFacebookPrice(itemId, listingId)` | `dropFacebookPriceRun` | `"reprice"`, `"facebook"` |
| `relistOnFacebook(itemId, listingId)` | `relistOnFacebookRun` | `"relist"`, `"facebook"` |

Concretely, `export async function postToOfferup(itemId: number): Promise<AndroidResult> {` becomes `async function postToOfferupRun(itemId: number): Promise<AndroidResult> {`, and after that function's closing brace add:

```ts
export async function postToOfferup(itemId: number): Promise<AndroidResult> {
  return withLog("post", itemId, "offerup", () => postToOfferupRun(itemId));
}
```

The other five wrappers:

```ts
export async function dropOfferupPrice(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("reprice", itemId, "offerup", () => dropOfferupPriceRun(itemId, listingId));
}
```

```ts
export async function relistOnOfferup(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("relist", itemId, "offerup", () => relistOnOfferupRun(itemId, listingId));
}
```

```ts
export async function postToFacebook(itemId: number): Promise<AndroidResult> {
  return withLog("post", itemId, "facebook", () => postToFacebookRun(itemId));
}
```

```ts
export async function dropFacebookPrice(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("reprice", itemId, "facebook", () => dropFacebookPriceRun(itemId, listingId));
}
```

```ts
export async function relistOnFacebook(itemId: number, listingId: number): Promise<AndroidResult> {
  return withLog("relist", itemId, "facebook", () => relistOnFacebookRun(itemId, listingId));
}
```

Keep each function's existing leading comment above the `...Run` function. `relistWithDrop` keeps calling the exported `relistOnOfferup` / `relistOnFacebook`, so its relists are logged once.

- [ ] **Step 3: Log mark-sold takedowns**

Change the `SoldResult` type to:

```ts
export type SoldResult = {
  soldPrice: number | null;
  soldChannel: SoldChannel | null;
  channels: { channel: string; outcome: "ended" | "failed" | "manual" | "skipped"; detail?: string; screenshot?: string }[];
};
```

In `markSoldAndTakedown`, replace the emulator failure push:

```ts
        } else {
          const detail = result.status === "failed" ? `${result.step}: ${result.reason}` : result.status;
          channels.push({ channel: l.publisher, outcome: "failed", detail });
        }
```

with:

```ts
        } else {
          const detail = result.status === "failed" ? `${result.step}: ${result.reason}` : result.status;
          const screenshot = result.status === "failed" ? result.screenshot : undefined;
          channels.push({ channel: l.publisher, outcome: "failed", detail, ...(screenshot ? { screenshot } : {}) });
        }
```

Replace the item-not-found early return at the top of `markSoldAndTakedown`:

```ts
  if (!item) {
    return { soldPrice, soldChannel, channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }] };
  }
```

with:

```ts
  if (!item) {
    await logAutomation({
      at: new Date().toISOString(), action: "mark_sold", itemId, channel: "item",
      outcome: "failed", reason: "Item not found",
    });
    return { soldPrice, soldChannel, channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }] };
  }
```

Then, directly before `revalidatePath("/");` at the end of `markSoldAndTakedown`, add:

```ts
  for (const c of channels) {
    await logAutomation({
      at: new Date().toISOString(),
      action: "mark_sold",
      itemId,
      itemName: itemRow.name,
      channel: c.channel,
      outcome: c.outcome,
      ...(c.detail ? { reason: c.detail } : {}),
      ...(c.screenshot ? { screenshot: c.screenshot } : {}),
    });
  }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/lib/automation-actions.ts`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests PASS (nothing here is unit-tested; this guards against regressions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/automation-actions.ts
git commit -m "feat(log): log every emulator action and mark-sold takedown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Facebook relist renews, then reprices

**Files:**
- Create: `src/lib/drop-push-core.ts`
- Test: `src/lib/__tests__/drop-push-core.test.ts`
- Modify: `src/lib/automation-actions.ts` (`relistOnFacebookRun`, new `buildRunners`)

**Interfaces:**
- Consumes: `markListingRenewedCore`, `syncListingPriceCore` (`src/lib/task-actions.ts`); `AndroidResult` (Task 1); `relistOnFacebookRun` (Task 3).
- Produces (exported from `src/lib/drop-push-core.ts`):
  ```ts
  type ChannelRunner = (itemId: number) => Promise<AndroidResult>;
  interface PushRunners { repriceOfferup: ChannelRunner; relistOfferup: ChannelRunner; repriceFacebook: ChannelRunner; renewFacebook: ChannelRunner; }
  describeFailure(result: AndroidResult): string
  safeRun(runner: ChannelRunner, itemId: number): Promise<AndroidResult>
  facebookRenewThenReprice(db, itemId: number, listingId: number, runners: Pick<PushRunners, "renewFacebook" | "repriceFacebook">, now: Date): Promise<AndroidResult>
  ```
- Produces (non-exported in `automation-actions.ts`): `buildRunners(): PushRunners`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/drop-push-core.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "@/db/schema";
import { items, listings } from "@/db/schema";
import type { AndroidResult } from "@/automation/android/types";
import { facebookRenewThenReprice } from "../drop-push-core";

const NOW = new Date("2026-07-10T12:00:00Z");
const DONE: AndroidResult = { status: "done" };
let db: BetterSQLite3Database<typeof schema>;
let itemId: number;

beforeEach(async () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  const [item] = await db
    .insert(items)
    .values({
      name: "Rolex Explorer", status: "published",
      askingPrice: 6596, minimumPrice: 6200, dropPercent: 3, dropIntervalDays: 7,
    })
    .returning();
  itemId = item.id;
});

async function insertListing(publisher: string, listedPrice: number) {
  const [row] = await db
    .insert(listings)
    .values({ itemId, publisher, status: "active", listedPrice, listedAt: "2026-07-01 00:00:00" })
    .returning();
  return row;
}

async function getListing(id: number) {
  const [row] = await db.select().from(listings).where(eq(listings.id, id));
  return row;
}

describe("facebookRenewThenReprice", () => {
  it("stops at a failed renew without touching the row or repricing", async () => {
    const l = await insertListing("facebook", 6800);
    const renewFacebook = vi.fn(async (): Promise<AndroidResult> => ({ status: "failed", step: "renew listing", reason: "no Renew" }));
    const repriceFacebook = vi.fn(async () => DONE);
    const res = await facebookRenewThenReprice(db, itemId, l.id, { renewFacebook, repriceFacebook }, NOW);
    expect(res).toEqual({ status: "failed", step: "renew listing", reason: "no Renew" });
    expect(repriceFacebook).not.toHaveBeenCalled();
    const row = await getListing(l.id);
    expect(row.renewedAt).toBeNull();
    expect(row.listedPrice).toBe(6800);
  });

  it("renews without repricing when the live price already matches", async () => {
    const l = await insertListing("facebook", 6596);
    const repriceFacebook = vi.fn(async () => DONE);
    const res = await facebookRenewThenReprice(db, itemId, l.id, { renewFacebook: async () => DONE, repriceFacebook }, NOW);
    expect(res).toEqual(DONE);
    expect(repriceFacebook).not.toHaveBeenCalled();
    expect((await getListing(l.id)).renewedAt).toBe("2026-07-10 12:00:00");
  });

  it("renews, reprices and syncs the listed price when they differ", async () => {
    const l = await insertListing("facebook", 6800);
    const calls: string[] = [];
    const res = await facebookRenewThenReprice(
      db, itemId, l.id,
      {
        renewFacebook: async () => { calls.push("renew"); return DONE; },
        repriceFacebook: async () => { calls.push("reprice"); return DONE; },
      },
      NOW
    );
    expect(res).toEqual(DONE);
    expect(calls).toEqual(["renew", "reprice"]);
    const row = await getListing(l.id);
    expect(row.renewedAt).toBe("2026-07-10 12:00:00");
    expect(row.listedPrice).toBe(6596);
  });

  it("keeps the renew but not the price when the reprice fails", async () => {
    const l = await insertListing("facebook", 6800);
    const res = await facebookRenewThenReprice(
      db, itemId, l.id,
      {
        renewFacebook: async () => DONE,
        repriceFacebook: async () => ({ status: "failed", step: "set price", reason: "no node", screenshot: "/d/p.png" }),
      },
      NOW
    );
    expect(res).toEqual({
      status: "failed", step: "reprice",
      reason: "renewed; reprice failed: set price: no node", screenshot: "/d/p.png",
    });
    const row = await getListing(l.id);
    expect(row.renewedAt).toBe("2026-07-10 12:00:00");
    expect(row.listedPrice).toBe(6800);
  });

  it("turns a thrown runner error into a failed result", async () => {
    const l = await insertListing("facebook", 6800);
    const res = await facebookRenewThenReprice(
      db, itemId, l.id,
      { renewFacebook: async () => { throw new Error("adb gone"); }, repriceFacebook: async () => DONE },
      NOW
    );
    expect(res).toEqual({ status: "failed", step: "unknown", reason: "adb gone" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/drop-push-core.test.ts`
Expected: FAIL with "Failed to resolve import ../drop-push-core".

- [ ] **Step 3: Implement the core helper**

Create `src/lib/drop-push-core.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/drop-push-core.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add `buildRunners` and fix `relistOnFacebookRun`**

In `src/lib/automation-actions.ts`, add to the imports:

```ts
import { facebookRenewThenReprice, type PushRunners } from "@/lib/drop-push-core";
```

Add this non-exported helper directly above `postToOfferupRun`:

```ts
// Real emulator runners for drop-push-core. Each re-reads the item (so it sees
// a price that was just dropped), generates the channel listing and drives the
// flow. They never take the Android lock; the calling action holds it.
function buildRunners(): PushRunners {
  const load = async (itemId: number, publisherId: "offerup" | "facebook") => {
    const item = await getItem(itemId);
    if (!item) return null;
    const { photos, listings: _l, prices: _p, ...itemRow } = item;
    return {
      item: itemRow,
      listing: getPublisher(publisherId)!.generate(itemRow, photos),
      photoPaths: photos.map((p) => path.join(PHOTOS_DIR, p.path)),
    };
  };
  const notFound: AndroidResult = { status: "failed", step: "load", reason: "Item not found" };
  const disabled = (name: string): AndroidResult => ({
    status: "failed", step: "config", reason: `${name} automation is disabled`,
  });
  return {
    repriceOfferup: async (itemId) => {
      if (!OFFERUP_AUTOMATION_ENABLED) return disabled("OfferUp");
      const ctx = await load(itemId, "offerup");
      if (!ctx) return notFound;
      return repriceOfferup({ ...ctx, photoPaths: [], newPrice: ctx.item.askingPrice ?? undefined });
    },
    relistOfferup: async (itemId) => {
      if (!OFFERUP_AUTOMATION_ENABLED) return disabled("OfferUp");
      const ctx = await load(itemId, "offerup");
      if (!ctx) return notFound;
      return relistOfferup(ctx);
    },
    repriceFacebook: async (itemId) => {
      if (!FACEBOOK_AUTOMATION_ENABLED) return disabled("Facebook");
      const ctx = await load(itemId, "facebook");
      if (!ctx) return notFound;
      return repriceFacebook({ ...ctx, photoPaths: [], newPrice: ctx.item.askingPrice ?? undefined });
    },
    renewFacebook: async (itemId) => {
      if (!FACEBOOK_AUTOMATION_ENABLED) return disabled("Facebook");
      const ctx = await load(itemId, "facebook");
      if (!ctx) return notFound;
      return relistFacebook(ctx, { action: "renew" });
    },
  };
}
```

Replace the whole `relistOnFacebookRun` function (from Task 3) with:

```ts
async function relistOnFacebookRun(
  itemId: number,
  listingId: number
): Promise<AndroidResult> {
  if (!FACEBOOK_AUTOMATION_ENABLED) {
    return { status: "failed", step: "config", reason: "Facebook automation is disabled" };
  }
  const item = await getItem(itemId);
  if (!item) return { status: "failed", step: "load", reason: "Item not found" };

  if (!acquireAndroidLock()) {
    return { status: "failed", step: "lock", reason: "another automation is running" };
  }
  let result: AndroidResult;
  try {
    // Facebook policy is renew-only, and renew leaves the price alone. Renew,
    // then reprice if a drop left the live price behind; listedPrice syncs only
    // when that reprice succeeds.
    result = await facebookRenewThenReprice(db, itemId, listingId, buildRunners(), new Date());
  } catch (err) {
    result = { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
  } finally {
    releaseAndroidLock();
  }
  revalidatePath("/");
  revalidatePath(`/items/${itemId}/publish`);
  return result;
}
```

If `markListingRenewedCore` is no longer used anywhere in `automation-actions.ts`, remove it from the `@/lib/task-actions` import (eslint will flag it).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npx eslint src/lib/automation-actions.ts src/lib/drop-push-core.ts src/lib/__tests__/drop-push-core.test.ts`
Expected: no errors.

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/drop-push-core.ts src/lib/__tests__/drop-push-core.test.ts src/lib/automation-actions.ts
git commit -m "fix(facebook): relist renews then reprices; sync price only on reprice

Facebook renew never changes the price, but relistOnFacebook synced
listedPrice after a renew, recording a dropped price FB never received.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `dropAndPushCore` fan-out

**Files:**
- Modify: `src/lib/drop-push-core.ts`
- Test: `src/lib/__tests__/drop-push-core.test.ts`

**Interfaces:**
- Consumes: `computeDropTarget` (`src/lib/tasks.ts`), `applyPriceDropCore`, `syncListingPriceCore`, `markListingRelistedCore` (`src/lib/task-actions.ts`), `safeRun`, `describeFailure`, `facebookRenewThenReprice` (Task 4).
- Produces:
  ```ts
  type PushMode = "reprice" | "relist";
  interface ChannelOutcome { channel: string; outcome: "repriced" | "relisted" | "failed" | "manual"; detail?: string; result?: AndroidResult; }
  interface DropPushResult { newPrice: number | null; channels: ChannelOutcome[]; }
  dropAndPushCore(db, itemId: number, mode: PushMode, runners: PushRunners, now: Date): Promise<DropPushResult>
  ```

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/drop-push-core.test.ts`, change the drop-push-core import to:

```ts
import { dropAndPushCore, facebookRenewThenReprice, type PushRunners } from "../drop-push-core";
```

add `priceHistory` to the schema import:

```ts
import { items, listings, priceHistory } from "@/db/schema";
```

and append:

```ts
// The item starts at 6800 (beforeEach sets 6596 for the FB helper tests).
async function resetTo6800() {
  await db.update(items).set({ askingPrice: 6800 }).where(eq(items.id, itemId));
}

function fakeRunners(overrides: Partial<PushRunners> = {}) {
  const calls: string[] = [];
  const ok = (name: string) => vi.fn(async (): Promise<AndroidResult> => { calls.push(name); return DONE; });
  const runners: PushRunners = {
    repriceOfferup: ok("repriceOfferup"),
    relistOfferup: ok("relistOfferup"),
    repriceFacebook: ok("repriceFacebook"),
    renewFacebook: ok("renewFacebook"),
    ...overrides,
  };
  return { runners, calls };
}

describe("dropAndPushCore", () => {
  beforeEach(resetTo6800);

  it("drops the price once and reprices every channel", async () => {
    const ou = await insertListing("offerup", 6800);
    const fb = await insertListing("facebook", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.newPrice).toBe(6596);
    expect(res.channels.map((c) => [c.channel, c.outcome])).toEqual([
      ["offerup", "repriced"], ["facebook", "repriced"],
    ]);
    expect(calls).toEqual(["repriceOfferup", "repriceFacebook"]);
    const history = await db.select().from(priceHistory).where(eq(priceHistory.itemId, itemId));
    expect(history).toHaveLength(1);
    expect((await getListing(ou.id)).listedPrice).toBe(6596);
    expect((await getListing(fb.id)).listedPrice).toBe(6596);
  });

  it("orders OfferUp before Facebook regardless of insert order", async () => {
    await insertListing("facebook", 6800);
    await insertListing("offerup", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels.map((c) => c.channel)).toEqual(["offerup", "facebook"]);
    expect(calls).toEqual(["repriceOfferup", "repriceFacebook"]);
  });

  it("keeps going when one channel fails", async () => {
    const ou = await insertListing("offerup", 6800);
    const fb = await insertListing("facebook", 6800);
    const { runners } = fakeRunners({
      repriceOfferup: async () => ({ status: "failed", step: "set price", reason: "no node" }),
    });
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels[0]).toMatchObject({ channel: "offerup", outcome: "failed", detail: "set price: no node" });
    expect(res.channels[1]).toMatchObject({ channel: "facebook", outcome: "repriced" });
    expect((await getListing(ou.id)).listedPrice).toBe(6800);
    expect((await getListing(fb.id)).listedPrice).toBe(6596);
  });

  it("converts a thrown runner error into a failed channel", async () => {
    await insertListing("offerup", 6800);
    const { runners } = fakeRunners({ repriceOfferup: async () => { throw new Error("boom"); } });
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels[0]).toMatchObject({ channel: "offerup", outcome: "failed", detail: "unknown: boom" });
  });

  it("relist mode reposts OfferUp and renews-then-reprices Facebook", async () => {
    const ou = await insertListing("offerup", 6800);
    const fb = await insertListing("facebook", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "relist", runners, NOW);
    expect(res.channels.map((c) => [c.channel, c.outcome])).toEqual([
      ["offerup", "relisted"], ["facebook", "relisted"],
    ]);
    expect(calls).toEqual(["relistOfferup", "renewFacebook", "repriceFacebook"]);
    const ouRow = await getListing(ou.id);
    expect(ouRow.listedAt).toBe("2026-07-10 12:00:00");
    expect(ouRow.listedPrice).toBe(6596);
    const fbRow = await getListing(fb.id);
    expect(fbRow.listedAt).toBe("2026-07-01 00:00:00");
    expect(fbRow.renewedAt).toBe("2026-07-10 12:00:00");
    expect(fbRow.listedPrice).toBe(6596);
  });

  it("marks manual channels without running anything", async () => {
    const cl = await insertListing("craigslist", 6800);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "relist", runners, NOW);
    expect(res.newPrice).toBe(6596);
    expect(res.channels).toEqual([{ channel: "craigslist", outcome: "manual", detail: "update by hand" }]);
    expect(calls).toEqual([]);
    expect((await getListing(cl.id)).listedPrice).toBe(6800);
  });

  it("ignores ended listings", async () => {
    await db.insert(listings).values({ itemId, publisher: "offerup", status: "ended", listedPrice: 6800 });
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res.channels).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("writes nothing when no drop is available", async () => {
    await db.update(items).set({ askingPrice: 6200 }).where(eq(items.id, itemId)); // at floor
    await insertListing("offerup", 6200);
    const { runners, calls } = fakeRunners();
    const res = await dropAndPushCore(db, itemId, "reprice", runners, NOW);
    expect(res).toEqual({
      newPrice: null,
      channels: [{ channel: "item", outcome: "failed", detail: "no price drop available" }],
    });
    expect(calls).toEqual([]);
    const history = await db.select().from(priceHistory).where(eq(priceHistory.itemId, itemId));
    expect(history).toHaveLength(0);
  });

  it("reports a missing item", async () => {
    const { runners } = fakeRunners();
    const res = await dropAndPushCore(db, 9999, "reprice", runners, NOW);
    expect(res).toEqual({
      newPrice: null,
      channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/drop-push-core.test.ts`
Expected: FAIL; `dropAndPushCore` is not exported (the 5 `facebookRenewThenReprice` tests still pass).

- [ ] **Step 3: Implement**

In `src/lib/drop-push-core.ts`, change the drizzle and task-actions imports to:

```ts
import { and, eq } from "drizzle-orm";
```

```ts
import { computeDropTarget } from "./tasks";
import {
  applyPriceDropCore,
  markListingRelistedCore,
  markListingRenewedCore,
  syncListingPriceCore,
} from "./task-actions";
```

Append to the end of the file:

```ts
export type PushMode = "reprice" | "relist";

export interface ChannelOutcome {
  channel: string;
  outcome: "repriced" | "relisted" | "failed" | "manual";
  detail?: string;
  result?: AndroidResult; // the emulator result, kept for the log
}

export interface DropPushResult {
  newPrice: number | null;
  channels: ChannelOutcome[];
}

const CHANNEL_ORDER: Record<string, number> = { offerup: 0, facebook: 1 };

// The homepage drop task's one click: drop the price ONCE, then push it to
// every active listing Dispatch can drive (OfferUp, then Facebook). Other
// channels are reported as manual; their stale-price task is the cue. A failed
// channel keeps its old listedPrice, so it also surfaces as a stale-price task.
export async function dropAndPushCore(
  db: DB,
  itemId: number,
  mode: PushMode,
  runners: PushRunners,
  now: Date
): Promise<DropPushResult> {
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) {
    return { newPrice: null, channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }] };
  }
  if (computeDropTarget(item) == null) {
    return { newPrice: null, channels: [{ channel: "item", outcome: "failed", detail: "no price drop available" }] };
  }

  const newPrice = await applyPriceDropCore(db, itemId, now);

  const active = (
    await db
      .select()
      .from(listings)
      .where(and(eq(listings.itemId, itemId), eq(listings.status, "active")))
  ).sort((a, b) => (CHANNEL_ORDER[a.publisher] ?? 2) - (CHANNEL_ORDER[b.publisher] ?? 2));

  const done = mode === "reprice" ? "repriced" : "relisted";
  const channels: ChannelOutcome[] = [];
  for (const l of active) {
    let result: AndroidResult;
    if (l.publisher === "offerup") {
      result = await safeRun(mode === "reprice" ? runners.repriceOfferup : runners.relistOfferup, itemId);
      if (result.status === "done") {
        if (mode === "reprice") await syncListingPriceCore(db, l.id);
        else await markListingRelistedCore(db, l.id, now); // fresh post: new listedAt + price
      }
    } else if (l.publisher === "facebook") {
      if (mode === "reprice") {
        result = await safeRun(runners.repriceFacebook, itemId);
        if (result.status === "done") await syncListingPriceCore(db, l.id);
      } else {
        result = await facebookRenewThenReprice(db, itemId, l.id, runners, now);
      }
    } else {
      channels.push({ channel: l.publisher, outcome: "manual", detail: "update by hand" });
      continue;
    }
    channels.push(
      result.status === "done"
        ? { channel: l.publisher, outcome: done, result }
        : { channel: l.publisher, outcome: "failed", detail: describeFailure(result), result }
    );
  }
  return { newPrice, channels };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/drop-push-core.test.ts`
Expected: PASS (14 tests).

Run: `npx tsc --noEmit && npx eslint src/lib/drop-push-core.ts src/lib/__tests__/drop-push-core.test.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/drop-push-core.ts src/lib/__tests__/drop-push-core.test.ts
git commit -m "feat(drop): add dropAndPushCore fan-out (drop once, push to all channels)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `dropAndPush` and `refreshAfterDrop` server actions

**Files:**
- Modify: `src/lib/automation-actions.ts`

**Interfaces:**
- Consumes: `dropAndPushCore`, `DropPushResult`, `PushMode` (Task 5); `buildRunners`, `itemNameFor` (Tasks 3-4); `logAutomation` (Task 2).
- Produces (exported server actions, used by Task 8):
  ```ts
  dropAndPush(itemId: number, mode: PushMode): Promise<DropPushResult>
  refreshAfterDrop(itemId: number): Promise<void>
  ```

No unit test (imports `@/db`); the logic is covered by Task 5.

- [ ] **Step 1: Implement**

In `src/lib/automation-actions.ts`, change the drop-push-core import to:

```ts
import {
  dropAndPushCore,
  facebookRenewThenReprice,
  type DropPushResult,
  type PushMode,
  type PushRunners,
} from "@/lib/drop-push-core";
```

Append after `relistWithDrop`:

```ts
async function logDropPush(action: AutomationAction, itemId: number, result: DropPushResult): Promise<void> {
  const itemName = await itemNameFor(itemId);
  for (const c of result.channels) {
    const screenshot = c.result?.status === "failed" ? c.result.screenshot : undefined;
    await logAutomation({
      at: new Date().toISOString(),
      action,
      itemId,
      itemName,
      channel: c.channel,
      outcome: c.outcome,
      ...(c.detail ? { reason: c.detail } : {}),
      ...(screenshot ? { screenshot } : {}),
    });
  }
}

// Homepage drop task: drop the price once, then reprice or relist every active
// OfferUp/Facebook listing in one pass. Takes the Android lock once, and only
// when an emulator channel is involved, so a manual-only drop never waits on
// the emulator. Deliberately does NOT revalidate: the drop task would vanish
// and take its result lines with it. The client calls refreshAfterDrop once the
// user has read them.
export async function dropAndPush(itemId: number, mode: PushMode): Promise<DropPushResult> {
  const action: AutomationAction = mode === "reprice" ? "drop_reprice" : "drop_relist";
  const item = await getItem(itemId);
  const usesEmulator = !!item?.listings.some(
    (l) => l.status === "active" && (l.publisher === "offerup" || l.publisher === "facebook")
  );

  if (usesEmulator && !acquireAndroidLock()) {
    const busy: DropPushResult = {
      newPrice: null,
      channels: [{ channel: "emulator", outcome: "failed", detail: "another automation is running" }],
    };
    await logDropPush(action, itemId, busy);
    return busy;
  }
  let result: DropPushResult;
  try {
    result = await dropAndPushCore(db, itemId, mode, buildRunners(), new Date());
  } catch (err) {
    result = {
      newPrice: null,
      channels: [{ channel: "item", outcome: "failed", detail: err instanceof Error ? err.message : "Unknown error" }],
    };
  } finally {
    if (usesEmulator) releaseAndroidLock();
  }
  await logDropPush(action, itemId, result);
  return result;
}

// Called when the user acknowledges a dropAndPush result.
export async function refreshAfterDrop(itemId: number): Promise<void> {
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/publish`);
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint src/lib/automation-actions.ts`
Expected: no errors.

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/automation-actions.ts
git commit -m "feat(drop): add dropAndPush + refreshAfterDrop server actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `price_drop` task carries `autoChannels`

**Files:**
- Modify: `src/lib/tasks.ts`
- Test: `src/lib/__tests__/tasks.test.ts`

**Interfaces:**
- Produces: `Task` variant `{ type: "price_drop"; itemId: number; itemName: string; currentPrice: number; targetPrice: number; autoChannels: ("offerup" | "facebook")[] }` (OfferUp first). Used by Task 8.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/tasks.test.ts`, update the three existing exact `price_drop` expectations (currently at lines 95, 113 and 404) to include `autoChannels: []`, e.g.:

```ts
      { type: "price_drop", itemId: 1, itemName: item.name, currentPrice: 6800, targetPrice: 6596, autoChannels: [] },
```

(and the same for line 113 with `itemId: 1`, and line 404 with `itemId: 3`).

Add inside `describe("computeTasks — price_drop", ...)`, after the "emits a drop exactly at the interval boundary" test:

```ts
  it("lists the item's active OfferUp/Facebook channels, OfferUp first", () => {
    const item = makeItem(cadence);
    const tasks = computeTasks(
      inputs({
        items: [item],
        activeListings: [
          makeListing({ id: 1, publisher: "facebook" }),
          makeListing({ id: 2, publisher: "craigslist" }),
          makeListing({ id: 3, publisher: "offerup" }),
        ],
        lastPriceChange: new Map([[1, "2026-07-01 12:00:00"]]),
      })
    );
    expect(tasks.find((t) => t.type === "price_drop")).toMatchObject({
      autoChannels: ["offerup", "facebook"],
    });
  });

  it("leaves autoChannels empty for manual-only items", () => {
    const item = makeItem(cadence);
    const tasks = computeTasks(
      inputs({
        items: [item],
        activeListings: [makeListing({ id: 2, publisher: "craigslist" })],
        lastPriceChange: new Map([[1, "2026-07-01 12:00:00"]]),
      })
    );
    expect(tasks.find((t) => t.type === "price_drop")).toMatchObject({ autoChannels: [] });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/tasks.test.ts`
Expected: FAIL; the updated `toEqual` cases and the new test report a missing `autoChannels`.

- [ ] **Step 3: Implement**

In `src/lib/tasks.ts`, above `export type Task`, add:

```ts
// Channels whose live price Dispatch can push on the emulator, in push order.
const AUTO_CHANNELS = ["offerup", "facebook"] as const;
export type AutoChannel = (typeof AUTO_CHANNELS)[number];
```

Change the `price_drop` member of `Task` to:

```ts
  | { type: "price_drop"; itemId: number; itemName: string; currentPrice: number; targetPrice: number; autoChannels: AutoChannel[] }
```

In `computeTasks`, after the `activeByItem` loop, add:

```ts
  const autoByItem = new Map<number, Set<string>>();
  for (const l of inputs.activeListings) {
    if (!(AUTO_CHANNELS as readonly string[]).includes(l.publisher)) continue;
    const set = autoByItem.get(l.itemId) ?? new Set<string>();
    set.add(l.publisher);
    autoByItem.set(l.itemId, set);
  }
```

and change the `drops.push({...})` call to:

```ts
          drops.push({
            type: "price_drop", itemId: item.id, itemName: item.name,
            currentPrice: item.askingPrice, targetPrice: target,
            autoChannels: AUTO_CHANNELS.filter((c) => autoByItem.get(item.id)?.has(c)),
          });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/tasks.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no errors. (`TaskSection.tsx` doesn't read `autoChannels` yet; that's Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks.ts src/lib/__tests__/tasks.test.ts
git commit -m "feat(tasks): price_drop task lists its emulator channels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Drop task UI; remove Apply

**Files:**
- Create: `src/components/DropTaskActions.tsx`
- Modify: `src/components/TaskSection.tsx`
- Modify: `src/lib/actions.ts` (delete `applyPriceDrop`)

**Interfaces:**
- Consumes: `dropAndPush`, `refreshAfterDrop` (Task 6); `DropPushResult`, `PushMode` types (Task 5); `price_drop.autoChannels` (Task 7); `formatPrice(price: number | null)` (`src/lib/format.ts`).

- [ ] **Step 1: Create the client component**

Create `src/components/DropTaskActions.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { dropAndPush, refreshAfterDrop } from "@/lib/automation-actions";
import type { DropPushResult, PushMode } from "@/lib/drop-push-core";
import { formatPrice } from "@/lib/format";

const CHANNEL_LABELS: Record<string, string> = {
  offerup: "OfferUp",
  facebook: "Facebook",
  craigslist: "Craigslist",
  "reddit-watchexchange": "Reddit r/Watchexchange",
  watchuseek: "Watchuseek",
  item: "Item",
  emulator: "Emulator",
};

const OUTCOME_ICON: Record<DropPushResult["channels"][number]["outcome"], string> = {
  repriced: "✓",
  relisted: "✓",
  failed: "⚠️",
  manual: "○",
};

const BUTTON =
  "rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50";

// The homepage drop task's actions. Results stay on screen until OK, because
// refreshing the page removes the (no longer due) drop task and this row.
export function DropTaskActions({
  itemId,
  targetPrice,
  autoChannels,
}: {
  itemId: number;
  targetPrice: number;
  autoChannels: string[];
}) {
  const [result, setResult] = useState<DropPushResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(mode: PushMode) {
    startTransition(async () => {
      setResult(await dropAndPush(itemId, mode));
    });
  }

  function acknowledge() {
    startTransition(async () => {
      await refreshAfterDrop(itemId);
    });
  }

  if (result) {
    return (
      <div className="space-y-1 text-xs">
        {result.newPrice != null && (
          <div className="font-medium">Dropped to {formatPrice(result.newPrice)}</div>
        )}
        {result.channels.length === 0 && (
          <div className="text-zinc-500">No live listings to update.</div>
        )}
        {result.channels.map((c) => (
          <div
            key={c.channel}
            className={c.outcome === "failed" ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}
          >
            {OUTCOME_ICON[c.outcome]} {CHANNEL_LABELS[c.channel] ?? c.channel} {c.outcome}
            {c.detail ? `: ${c.detail}` : ""}
          </div>
        ))}
        <button
          type="button"
          disabled={isPending}
          onClick={acknowledge}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          OK
        </button>
      </div>
    );
  }

  if (isPending) {
    return (
      <span className="text-xs text-zinc-500">
        {autoChannels.length > 0 ? "Working… (emulator)" : "Working…"}
      </span>
    );
  }

  const price = formatPrice(targetPrice);
  return autoChannels.length > 0 ? (
    <>
      <button type="button" onClick={() => run("reprice")} className={BUTTON}>
        Drop to {price} + reprice
      </button>
      <button type="button" onClick={() => run("relist")} className={BUTTON}>
        Drop to {price} + relist
      </button>
    </>
  ) : (
    <button type="button" onClick={() => run("reprice")} className={BUTTON}>
      Drop to {price}
    </button>
  );
}
```

- [ ] **Step 2: Use it in `TaskSection`**

In `src/components/TaskSection.tsx`:

Remove `applyPriceDrop,` from the `@/lib/actions` import, and add:

```ts
import { DropTaskActions } from "@/components/DropTaskActions";
```

Replace the price-drop form:

```tsx
                    <form action={applyPriceDrop.bind(null, task.itemId)}>
                      <button className="rounded-md bg-purple-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-purple-700">
                        ✓ Apply {formatPrice(task.targetPrice)}
                      </button>
                    </form>
```

with:

```tsx
                    <DropTaskActions
                      itemId={task.itemId}
                      targetPrice={task.targetPrice}
                      autoChannels={task.autoChannels}
                    />
```

- [ ] **Step 3: Delete `applyPriceDrop`**

In `src/lib/actions.ts`, delete the whole function:

```ts
export async function applyPriceDrop(itemId: number) {
  await applyPriceDropCore(db, itemId, new Date());
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/publish`);
}
```

and remove `applyPriceDropCore,` from its `./task-actions` (or `@/lib/task-actions`) import, since nothing else in `actions.ts` uses it.

Confirm nothing else references it:

Run: `grep -rn "applyPriceDrop\b" src`
Expected: no output (only `applyPriceDropCore` references remain, in `task-actions.ts`, `drop-push-core.ts`, `automation-actions.ts` and tests).

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src`
Expected: no errors.

Run: `npx vitest run`
Expected: all PASS.

Do NOT run `npm run build` / `npm start`. Live checks are Wil's.

- [ ] **Step 5: Commit**

```bash
git add src/components/DropTaskActions.tsx src/components/TaskSection.tsx src/lib/actions.ts
git commit -m "feat(ui): drop task reprices or relists live listings; remove Apply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Live acceptance (Wil, after merge-ready)

Not part of any task. These drive real listings:

1. Relaunch Dispatch fresh (kill the `:3000` server first, see the launcher stale-build note), so the new build is served.
2. On a due drop task for an item listed on OfferUp only, click **Drop to $X + reprice**. Expect `✓ OfferUp repriced`, the OfferUp app showing the new price, and a line in `data/automation-log.jsonl` plus the Terminal.
3. On a manual-only item (Craigslist), click **Drop to $X**. Expect `○ Craigslist manual: update by hand`, then after **OK** a stale-price task for Craigslist.
4. FB relist depends on the unverified Renew selector (`flows/facebook/relist.ts`); if it fails, the log names the step and screenshot.
