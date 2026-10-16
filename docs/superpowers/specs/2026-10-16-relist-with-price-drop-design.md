# Dispatch — "Relist + price drop" button

- **Date:** 2026-10-16
- **Status:** Approved (design), pending implementation plan
- **Branch:** `relist-with-price-drop`

## Problem

After an OfferUp/Facebook listing hits its 7-day refresh mark, the only one-click actions are **Sync price** (push a changed asking price to the existing listing) and **Relist** (repost fresh at the *current* price). There is no single action that **drops the price one step and reposts at the new price** — the common "mark down and bump" move. Today it takes two manual steps (drop the price in Dispatch, then relist), and the drop action doesn't even push to the live listing.

## Goals

- Add a third per-channel button, **Relist + price drop**, that in one click drops the item's price one step and relists that channel at the new price.
- Keep the existing two buttons (Sync price, Relist) so the user has full manual control: refresh *without* dropping (Relist), push a price without reposting (Sync price), or drop-and-repost (the new button).
- Never let the drop go below the item's floor.

## Non-goals (YAGNI)

- **No automatic markdown schedule.** No default-on behavior, no opt-out toggle, no required-step/floor validation, no new task type, no task-engine change. (Deferred; can be revisited if the manual buttons prove too click-heavy.)
- **No schema change / migration.** Reuses existing `dropAmount`, `dropPercent`, `minimumPrice`.
- No new behavior on the manual-post channels (Craigslist/Reddit/Watchuseek), which have no one-click relist to pair with.

## Decisions (locked during brainstorming)

1. **Lean button, not the auto-markdown system.** Just one new button + one server action.
2. **Per-channel button.** It sits next to the existing Sync price / Relist buttons on each channel card that already has a one-click relist — **OfferUp and Facebook** today.
3. **Shared price, per-channel click.** Clicking it drops the shared item price one step and relists that one channel. On a multi-channel item the others then show a stale price (Dispatch's existing stale-price nudge covers that); a second "Relist + drop" click drops again — by design.
4. **Floor-safe.** The button is disabled when no step is configured or the item is already at its floor.

## Design

### Button (ChannelCard)

- New button labelled **`Relist + drop → $X`**, where `$X` is the computed next price (`computeDropTarget(item)`), so the user sees exactly what it will drop to.
- Rendered only for channels with a one-click relist (OfferUp, Facebook) and only when there is an **active** listing.
- **Enabled** iff `computeDropTarget(item) != null` (that helper already returns `null` when no step is set or the drop would not go below the current price, i.e. at/below floor). When disabled, show a hint: `Set a drop amount` (no step) or `At floor price` (can't drop further).
- Sits alongside the unchanged **Sync price** and **Relist** buttons.

### Server action (`src/lib/automation-actions.ts`)

```ts
export async function relistWithDrop(
  itemId: number,
  listingId: number,
  publisherId: string
): Promise<AndroidResult> {
  const dropped = await applyPriceDropCore(db, itemId, new Date());
  if (dropped == null) {
    return { status: "failed", step: "drop", reason: "no price drop available (no step configured or already at floor)" };
  }
  if (publisherId === "offerup") return relistOnOfferup(itemId, listingId);
  if (publisherId === "facebook") return relistOnFacebook(itemId, listingId);
  return { status: "failed", step: "drop", reason: `relist+drop not supported for ${publisherId}` };
}
```

- `applyPriceDropCore` lowers `askingPrice` one step (floored at `minimumPrice`) and logs price history; it returns the new price or `null` if no drop was possible (defensive — the button is already disabled in that case).
- It then delegates to the **existing** `relistOnOfferup` / `relistOnFacebook` actions, which re-read the item (now at the dropped price), generate the listing at the new price, drive the emulator relist, stamp `renewedAt`, and revalidate. No relist logic is duplicated.

### Data flow

- The publish page computes `const dropTarget = computeDropTarget(itemRow)` once and passes `dropTarget` (number | null) to each `ChannelCard`. The card uses it for the button's enabled state and label.
- No new fields, no new query.

## Testing

- `computeDropTarget` is already unit-tested in `src/lib/__tests__/tasks.test.ts`. Add cases only if these paths are not already covered: (a) `dropPercent` path returns the percent-based target; (b) at-floor (`askingPrice == minimumPrice`) returns `null`; (c) no step configured returns `null`.
- `relistWithDrop` is a thin composition over `applyPriceDropCore` + the emulator relist actions; its relist leg is emulator-driven and is **live-verified** (same as the existing OfferUp/Facebook flows), not unit-tested.
- Verify with `npx tsc --noEmit`, `npx eslint <files>`, `npm test`. Never `npm run build`/`npm start`; never touch `data/dispatch.db`.

## Files touched (anticipated)

- `src/lib/automation-actions.ts` — add `relistWithDrop`.
- `src/components/ChannelCard.tsx` — add the button + a `dropTarget` prop; wire `relistWithDrop`.
- `src/app/items/[id]/publish/page.tsx` — compute `computeDropTarget(itemRow)`, pass `dropTarget` to `ChannelCard`.
- `src/lib/__tests__/tasks.test.ts` — extend `computeDropTarget` coverage only if the cases above are missing.
