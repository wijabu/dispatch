# Dispatch: price drops that reach the live listing, plus an automation log

- **Date:** 2026-10-24
- **Status:** Approved (design), pending implementation plan
- **Branch:** `drop-and-push`

## Problem

1. **Apply is a dead end.** The homepage price-drop task's **✓ Apply $X** button (`applyPriceDrop` → `applyPriceDropCore`) lowers the asking price in Dispatch only. The live OfferUp/Facebook listings keep the old price until a separate Sync price or Relist click. A Dispatch-only drop has no use on its own.
2. **Facebook Relist + drop records a price FB never got.** FB relist is renew-only, and the renew flow does not touch the price (`flows/facebook/relist.ts`: "Reprice handles price drops separately"). `relistOnFacebook` still calls `syncListingPriceCore` after the renew, so Dispatch shows the dropped price as live while FB shows the old one, and the stale-price task that should flag the gap never fires. (Introduced in #25.)
3. **Emulator failures leave no record.** Server actions catch flow errors and return them to the page. Nothing is printed to the Dispatch Terminal window or written to disk. On 2026-10-24 a Sync price failure's reason was lost once the page refreshed; only step failures leave a screenshot in `data/automation-debug/`, and nothing links the screenshot to the action that produced it.

## Goals

- When the drop cadence comes due, one click drops the price **and** pushes it to every channel Dispatch can drive, with the user choosing between **reprice in place** and **relist**.
- FB relist (with or without a drop) leaves the live FB price and Dispatch's recorded price in agreement.
- Every emulator action leaves a durable, readable record of what happened.

## Non-goals

- No automatic (unattended) markdown scheduler. The task still waits for a click.
- No change to the drop cadence, `computeDropTarget`, or floor rules.
- No automation for Craigslist / Reddit / Watchuseek. They keep the existing stale-price nudge.
- No schema change or migration.
- No log viewer UI. The log is a file.

## Decisions (locked during brainstorming)

1. **Drop-only goes away.** The bare Apply button is removed; `applyPriceDrop` is deleted (no other callers).
2. **Two buttons on the drop task:** **Drop to $X + reprice** and **Drop to $X + relist**.
3. **One click covers all channels.** The price drops **once**, then every active OfferUp/FB listing is updated in turn. A failure on one channel does not stop the other.
4. **Per-channel Relist + drop buttons on the publish card stay** as they are (with the FB fix below).
5. **Automation log is in scope** and covers every emulator action, not just the new ones.

## Design

### 1. Drop task UI (`TaskSection` → new client component `DropTaskActions`)

- The `price_drop` row replaces **✓ Apply $X** with:
  - **Drop to $X + reprice**
  - **Drop to $X + relist**
- If the item has **no** active OfferUp/FB listing, show a single **Drop to $X** button instead. Its manual channels then surface as stale-price tasks, which is the correct cue for a hand update.
- To know which case applies, the `price_drop` task gains `autoChannels: ("offerup" | "facebook")[]`, the publishers of the item's active OfferUp/FB listings, computed in `computeTasks` from the active listings it already receives.
- While running, buttons are disabled and the row shows "Working… (emulator)". A relist across both channels can take several minutes.
- On completion, one line per channel, same style as `MarkSoldForm`: `✓ OfferUp repriced`, `⚠️ Facebook failed: set price: <reason>`, `○ Craigslist: update by hand`.
- **Snooze** stays.
- **Keeping the result on screen.** Once the price drops, the `price_drop` task is no longer due, so any page refresh removes the row and its result lines with it. `dropAndPush` therefore calls **no** `revalidatePath`. The result lines stay until the user clicks **OK**, which calls a small server action `refreshAfterDrop(itemId)` that revalidates `/`, `/items/<id>` and `/items/<id>/publish`. That's when the row disappears and any stale-price tasks show up. The log records the result regardless.

### 2. Fan-out (`dropAndPushCore` + server action `dropAndPush`)

New pure core in `src/lib/drop-push-core.ts`:

```ts
type PushMode = "reprice" | "relist";
type ChannelOutcome = {
  channel: string;
  outcome: "repriced" | "relisted" | "failed" | "manual";
  detail?: string;
};
type DropPushResult = { newPrice: number | null; channels: ChannelOutcome[] };

dropAndPushCore(db, itemId, mode, runners, now): Promise<DropPushResult>
```

`runners` injects the emulator work as four functions returning `AndroidResult`: `repriceOfferup`, `relistOfferup`, `repriceFacebook`, `renewFacebook` (the server action wires `renewFacebook` to `relistFacebook(ctx, {action: "renew"})`). Tests run against an in-memory DB with fakes. The core never imports `@/db` or `automation-actions.ts`.

Steps:

1. If `computeDropTarget(item)` is null, return `{ newPrice: null, channels: [{ channel: "item", outcome: "failed", detail: "no price drop available" }] }`. Nothing is written and no runner is called.
2. `applyPriceDropCore` **once**.
3. For each active listing, OfferUp first, then Facebook, then manual channels:

| Channel | `reprice` | `relist` |
|---|---|---|
| OfferUp | reprice → on done `syncListingPriceCore` → `repriced` | relist (delete-repost) → on done `markListingRelistedCore` → `relisted` |
| Facebook | reprice → on done `syncListingPriceCore` → `repriced` | `facebookRenewThenReprice` (section 3) → `relisted` |
| Craigslist / Reddit / Watchuseek | `manual` ("update by hand") | `manual` |

- Facebook relist where the renew succeeds but the reprice fails: `renewedAt` is stamped, the price is **not** synced, outcome `failed` with detail `renewed; reprice failed: <step>: <reason>`. The stale-price task then flags the gap.
- Any failed channel keeps its old `listedPrice`, so the stale-price task is the retry cue. No task is written by this action.
- Automation disabled for a channel → `failed`, `automation disabled`.

Server action `dropAndPush(itemId, mode)` in `automation-actions.ts`:

- If the item has an active OfferUp/FB listing, acquires the Android lock **once** for the whole pass (the per-channel server actions each take the lock, so chaining them would fail with "another automation is running"). If the lock is busy, it returns `{ newPrice: null, channels: [{ channel: "emulator", outcome: "failed", detail: "another automation is running" }] }` **before** dropping the price.
- If the item has no OfferUp/FB listing (the single **Drop to $X** button), it skips the lock entirely, so a manual-only drop never fails because the emulator is busy.
- Builds the real runners from the existing flows, calls the core, releases the lock, logs each channel. No revalidation (see section 1).

### 3. Facebook relist fix (`relistOnFacebook`)

- After a successful renew, stamp `renewedAt`. Then, **if** `listing.listedPrice !== item.askingPrice`, run `repriceFacebook` in the same lock and sync `listedPrice` only on a successful reprice.
- If the prices already match, no reprice runs and nothing about the price is written.
- The sequence is one helper, `facebookRenewThenReprice(db, listingId, runners, now)`, exported from `drop-push-core.ts` and used by both `relistOnFacebook` and the core's FB relist branch, so the two paths can't drift. After a drop the prices normally differ, so the reprice runs; the equality check only skips it when the live price already matches.
- This also fixes the publish card's per-channel **Relist + drop** on Facebook.

### 4. Automation log

New module `src/lib/automation-log.ts`:

```ts
type AutomationLogEntry = {
  at: string;            // ISO timestamp
  action: "post" | "reprice" | "relist" | "mark_sold" | "drop_reprice" | "drop_relist";
  itemId: number;
  itemName?: string;
  channel: string;
  outcome: string;       // AndroidResult status, or ChannelOutcome outcome
  step?: string;
  reason?: string;
  screenshot?: string;   // path under data/automation-debug/
};

logAutomation(entry, file = data/automation-log.jsonl): Promise<void>
```

- Appends one JSON line to `data/automation-log.jsonl` (already gitignored via `data/`) and prints the same entry as one readable line to stdout, which shows in the Dispatch Terminal window. Format: `[automation] <at> <action> <channel> #<itemId> "<itemName>" <outcome>[ <step>: <reason>][ (screenshot: <path>)]`.
- Best-effort: a logging error never fails or masks the action.
- Called once per channel result:

| Server action | `action` |
|---|---|
| `postToOfferup`, `postToFacebook` | `post` |
| `dropOfferupPrice`, `dropFacebookPrice` (Sync price) | `reprice` |
| `relistOnOfferup`, `relistOnFacebook` (incl. via publish-card Relist + drop) | `relist` |
| `markSoldAndTakedown` | `mark_sold` |
| `dropAndPush` | `drop_reprice` / `drop_relist` |

- Early failures (lock busy, item not found, automation disabled) are logged too. They were the likely cause of this morning's untraced Sync price failure.
- **Screenshot linking:** `captureFailureScreenshot` returns the path it wrote (or `undefined`); `step()` records it on the tracker's failed entry; `resolveResult` carries it into the result. `AndroidResult`'s `failed` variant gains an optional `screenshot?: string`. Callers that don't care are unaffected.

## Build order

1. Automation log + screenshot linking (independent; everything after uses it).
2. `facebookRenewThenReprice` + `relistOnFacebook` fix.
3. `dropAndPushCore` + `dropAndPush` server action.
4. `price_drop.autoChannels` + `DropTaskActions` UI; delete `applyPriceDrop`.

## Testing

All verification is `npx tsc --noEmit`, `npx eslint`, and `npx vitest run`. **No `npm run build` / `npm start`, and no test or script may open `data/dispatch.db`**; tests use `:memory:` databases (as `task-actions.test.ts` does) and a scratch file path for the log.

- `drop-push-core.test.ts` (in-memory DB, fake runners):
  - Two channels, price drops **once**, one `price_history` row.
  - OfferUp reprice failure does not stop FB; OfferUp keeps its old `listedPrice`.
  - FB relist calls renew **then** reprice; renew ok + reprice fail stamps `renewedAt` but not `listedPrice`.
  - OfferUp relist calls `markListingRelistedCore` semantics (listedAt reset).
  - Craigslist listing → `manual`, no writes.
  - Null drop target → nothing written, no runner called.
- `computeTasks`: `price_drop` carries `autoChannels` from active OfferUp/FB listings only.
- FB relist helper: no reprice when prices already match; reprice + sync when they differ.
- `automation-log.test.ts`: appends valid JSONL to a temp file; a write error is swallowed.
- `tracker.test.ts`: failed result carries the screenshot path.

Live emulator checks are left to Wil (they post real listings).

## Risks

- **Long server action.** Relist on both channels can run 10+ minutes. Checked in the bundled Next docs: `maxDuration` is "set by deployment platform," and self-hosted `next start` sets none, so no timeout applies. The existing single-channel relist already runs ~7 minutes. The lock prevents overlap. If the page is closed mid-run, the action should still finish server-side, and the log records the outcome either way.
- **FB renew selector is unverified.** `flows/facebook/relist.ts` notes the Renew menu item only appears on aging listings and its selector was never captured live. FB relist (old and new paths) may fail at the renew step until it is. The log will now show exactly where.
- **Drop-before-push seam** (same as Relist + drop today). The Dispatch price drops before the emulator work; any channel that fails shows as a stale-price task until retried.
- **Log growth.** One line per action; at Dispatch's volume this stays small. No rotation for now.
