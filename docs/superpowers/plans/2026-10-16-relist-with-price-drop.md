# Relist + Price Drop Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-channel "Relist + drop → $X" button (OfferUp + Facebook) that drops the item's price one step and relists that channel at the new price in one click.

**Architecture:** A thin server action composes two existing pieces — `applyPriceDropCore` (drop one step, floored at minimum) then the channel's existing relist action. A new button in `ChannelCard` calls it, gated/labelled by `computeDropTarget(item)` (which already returns the next price, or `null` when no step is set or the item is at its floor). No schema, validation, or task-engine changes.

**Tech Stack:** Next.js 16 (`ChannelCard` is a `"use client"` component; the publish page is a server component), Drizzle/better-sqlite3, Tailwind, Vitest.

## Global Constraints

- Verify ONLY with `npx tsc --noEmit`, `npx eslint <files>`, and `npm test` (vitest). **NEVER** run `npm run build` or `npm start`, and **NEVER** read, write, move, or reset `data/dispatch.db`.
- Reuse existing fields/logic: `dropAmount`/`dropPercent`/`minimumPrice`, `applyPriceDropCore`, `computeDropTarget`, `relistOnOfferup`, `relistOnFacebook`. No new DB columns, no migration, no validation changes, no new task type.
- The button must be floor-safe: enabled only when `computeDropTarget(item) != null` (that helper already floors at `minimumPrice` and returns `null` at/below floor or with no step).
- Scope is OfferUp + Facebook only (the channels with a one-click relist). Do not add it to Craigslist/Reddit/Watchuseek.
- The relist leg drives the Android emulator and is **live-verified**, not unit-tested. `computeDropTarget` is already fully unit-tested (`src/lib/__tests__/tasks.test.ts:55-75`); do not duplicate those tests.

---

### Task 1: `relistWithDrop` server action

**Files:**
- Modify: `src/lib/automation-actions.ts` (import line ~22; add the action after `relistOnFacebook`, which ends around line ~300)

**Interfaces:**
- Consumes: `applyPriceDropCore(db, itemId, now) => Promise<number | null>` from `@/lib/task-actions`; `relistOnOfferup(itemId, listingId) => Promise<AndroidResult>` and `relistOnFacebook(itemId, listingId) => Promise<AndroidResult>` (same file); `db` from `@/db`; `AndroidResult` type (already imported).
- Produces: `relistWithDrop(itemId: number, listingId: number, publisherId: string) => Promise<AndroidResult>` — consumed by Task 2.

- [ ] **Step 1: Add `applyPriceDropCore` to the task-actions import**

In `src/lib/automation-actions.ts`, change the existing import (line ~22):

```ts
import { markListingRenewedCore, syncListingPriceCore, markSoldCore, endListingCore } from "@/lib/task-actions";
```

to:

```ts
import { applyPriceDropCore, markListingRenewedCore, syncListingPriceCore, markSoldCore, endListingCore } from "@/lib/task-actions";
```

- [ ] **Step 2: Add the `relistWithDrop` action**

Append to `src/lib/automation-actions.ts` (after the `relistOnFacebook` function):

```ts
// Drop the item's price one step (floored at its minimum via applyPriceDropCore),
// then relist the given channel at the new price by delegating to that channel's
// existing relist action. The UI button is disabled unless computeDropTarget(item)
// != null, so a null drop here is defensive only.
export async function relistWithDrop(
  itemId: number,
  listingId: number,
  publisherId: string
): Promise<AndroidResult> {
  const dropped = await applyPriceDropCore(db, itemId, new Date());
  if (dropped == null) {
    return {
      status: "failed",
      step: "drop",
      reason: "no price drop available (no step configured or already at floor)",
    };
  }
  if (publisherId === "offerup") return relistOnOfferup(itemId, listingId);
  if (publisherId === "facebook") return relistOnFacebook(itemId, listingId);
  return {
    status: "failed",
    step: "drop",
    reason: `relist+drop not supported for ${publisherId}`,
  };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → Expected: clean.
Run: `npx eslint src/lib/automation-actions.ts` → Expected: clean.
Run: `npm test` → Expected: all pass, unchanged count (this action has no unit test; nothing else changed).

- [ ] **Step 4: Commit**

```bash
git add src/lib/automation-actions.ts
git commit -m "feat(actions): relistWithDrop — drop one step then relist a channel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: "Relist + drop" button (ChannelCard) + publish-page wiring

**Files:**
- Modify: `src/components/ChannelCard.tsx` (imports; props; two new buttons after the existing OfferUp/Facebook relist buttons, ~line 231 and ~line 282)
- Modify: `src/app/items/[id]/publish/page.tsx` (compute `dropTarget`, pass it to `ChannelCard`)

**Interfaces:**
- Consumes: `relistWithDrop(itemId, listingId, publisherId) => Promise<AndroidResult>` from `@/lib/automation-actions` (Task 1); `computeDropTarget(item) => number | null` from `@/lib/tasks`; `formatPrice` from `@/lib/format` (already imported in ChannelCard).
- Produces: `ChannelCard` gains a required prop `dropTarget: number | null`.

- [ ] **Step 1: Import `relistWithDrop` in ChannelCard**

In `src/components/ChannelCard.tsx`, add `relistWithDrop,` to the existing import block from `@/lib/automation-actions` (the block that already lists `relistOnOfferup`, `relistOnFacebook`, etc.):

```ts
  relistOnFacebook,
  relistWithDrop,
```

- [ ] **Step 2: Add the `dropTarget` prop**

In the `ChannelCard` destructured params, add `dropTarget` next to `defaultPrice`:

```ts
  defaultPrice,
  dropTarget,
```

and in the props type block, add it next to `defaultPrice: number | null;`:

```ts
  defaultPrice: number | null;
  dropTarget: number | null; // computeDropTarget(item): next price, or null if no step / at floor
```

- [ ] **Step 3: Add the OfferUp "Relist + drop" button**

In `src/components/ChannelCard.tsx`, immediately AFTER the existing OfferUp relist button block (the one whose label is `"Relist on OfferUp"`, closes around line 231), insert:

```tsx
          {offerupAutomation && listing && dropTarget != null && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setStageNote(null);
                  setAndroidResult(null);
                  setOfferupMode("relist");
                  setAndroidResult(await relistWithDrop(itemId, listing.id, publisherId));
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Relisting…" : `Relist + drop → ${formatPrice(dropTarget)}`}
            </button>
          )}
```

- [ ] **Step 4: Add the Facebook "Relist + drop" button**

Immediately AFTER the existing Facebook relist button block (label `"Relist on Facebook"`, closes around line 282), insert:

```tsx
          {facebookAutomation && listing && dropTarget != null && (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setStageNote(null);
                  setAndroidResult(null);
                  setOfferupMode("relist");
                  setAndroidResult(await relistWithDrop(itemId, listing.id, publisherId));
                })
              }
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isPending ? "Relisting…" : `Relist + drop → ${formatPrice(dropTarget)}`}
            </button>
          )}
```

- [ ] **Step 5: Compute and pass `dropTarget` from the publish page**

In `src/app/items/[id]/publish/page.tsx`:

Add the import:

```ts
import { computeDropTarget } from "@/lib/tasks";
```

After `const { photos, listings, prices: _prices, ...itemRow } = item;`, add:

```ts
  const dropTarget = computeDropTarget(itemRow);
```

Then add the prop to the `<ChannelCard ... />` (alongside `defaultPrice={item.askingPrice}`):

```tsx
            dropTarget={dropTarget}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → Expected: clean.
Run: `npx eslint src/components/ChannelCard.tsx "src/app/items/[id]/publish/page.tsx"` → Expected: clean.
Run: `npm test` → Expected: all pass, unchanged count.

- [ ] **Step 7: Commit**

```bash
git add src/components/ChannelCard.tsx "src/app/items/[id]/publish/page.tsx"
git commit -m "feat(ui): Relist + drop button on OfferUp/Facebook channel cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Live verification (after both tasks, with Wil)

On the publish page of a listed OfferUp item that has a drop step configured, confirm the `Relist + drop → $X` button appears next to Relist, shows the correct target price, and is hidden/disabled for an item with no step or at its floor. Clicking it should drop the price one step and relist via the emulator (OfferUp app is re-provisioned). This exercises the emulator leg that isn't unit-tested.
