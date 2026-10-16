# Dispatch — Refresh Countdown (relist-due indicator)

- **Date:** 2026-10-16
- **Status:** Approved (design), pending implementation plan
- **Branch:** `refresh-countdown`

## Problem

A listing's refresh/relist cadence is already computed inside `computeTasks`, but it's only exposed as a *gated task* in Today's Tasks. There's no at-a-glance way to see **when each posting is due to be refreshed**. The user hit this directly: to answer "when can I refresh my OfferUp posts?" they had to ask, and the answer came from a manual DB query. This feature surfaces that timing in the UI.

## Goals

- Show, per **active** listing, a relative countdown to its next refresh.
- **Tile (inventory grid):** one summary token = the soonest-due channel for that item.
- **Item detail + publish pages:** a per-channel breakdown with the exact date.
- A single, testable source of truth for the timing math.

## Non-goals (YAGNI)

- No new auto-actions, no notifications, no background jobs.
- **No change to the relist task engine or its floor-gating.** This indicator is informational only.
- No per-viewer settings or configurable cadences.

## Decisions (locked during brainstorming)

1. **Placement:** summary on the tile + per-channel breakdown on item/publish pages (option C).
2. **Format:** relative countdown that steps the unit down as it closes in; never a flat `0d`.
3. **Semantics:** a **pure cadence clock** (`anchor + interval`), independent of the engine's floor-gate (option A). The tile answers "when *can* I refresh?"; Today's Tasks still answers "what does the engine *recommend*?" These can legitimately differ for OfferUp/Facebook (the tile may read `due now` while the task list is quiet because the engine is still walking price down to floor).

## Design

### Core helper — `src/lib/refresh.ts` (pure, no I/O)

```ts
export type RefreshState = "upcoming" | "due" | "overdue";

export interface RefreshStatus {
  dueAt: Date;          // anchor + interval
  state: RefreshState;
  token: string;        // compact label, e.g. "3d", "5h", "due now", "overdue 2d"
}

// listing carries: listedAt, renewedAt; publisher carries relistPolicy.
export function refreshStatus(
  listing: { listedAt: string; renewedAt: string | null },
  publisher: { relistPolicy: RelistPolicy },
  now: Date
): RefreshStatus;

// Soonest-due across an item's active listings (for the tile). Returns null
// when the item has no active listings.
export function soonestRefresh(
  entries: { listing; publisher }[],
  now: Date
): RefreshStatus | null;

export function formatCountdown(ms: number): string; // signed; negative => overdue
```

- **Anchor:** `renewedAt ?? listedAt` for every channel — the clock measures *time since last refreshed/listed*. (This intentionally differs from `computeTasks`, which only uses `renewedAt` for the `renew-then-repost` method; here the meaning is uniform: "when did you last refresh this.") Document this divergence in the code.
- **dueAt:** `anchor + max(policy.intervalDays, policy.minIntervalDays)` days — using the max so the clock never reads `due` before a platform's hard minimum (e.g. Reddit's 7-day floor).
- **state** (precise, no overlap):
  - `upcoming`: `now < dueAt`
  - `due`: `dueAt <= now < dueAt + 24h` (a one-day "due now" window)
  - `overdue`: `now >= dueAt + 24h`
- **token** is composed by `refreshStatus` from the state:
  - `upcoming` → `formatCountdown(dueAt - now)` → `3d` / `5h` / `45m`
  - `due` → `due now`
  - `overdue` → `overdue ` + `formatCountdown(now - dueAt)` → `overdue 2d` (always `>= 1d` since overdue starts at 24h)
- Reuse `parseDbDate` from `tasks.ts` for the UTC-aware parse.

### Formatting (`formatCountdown`)

A **magnitude-only** formatter for a positive duration (the state prefixes `due now` / `overdue` are added by `refreshStatus`, not here). Largest meaningful unit only:
- `>= 1 day`: `Nd`
- `< 24h, >= 1h`: `Nh`
- `< 1h`: `Nm` (floor to the minute, min `1m`)

Never emits `0d`; a sub-day countdown is always hours or minutes.

### Data / queries

- Extend the home query (`getActiveListingsByItem` or a sibling) so each item carries its active listings as `{ publisher, listedAt, renewedAt }`, not just publisher IDs. The tile badges already iterate this list; the only change is enriching each entry.
- Item detail and publish pages already load full listing rows (publish page shows "listed at $X on …"), so no new query there, just render the per-channel status.

### UI

- **`RefreshBadge`** (presentational): renders a `RefreshStatus.token` with a `↻` glyph and a state color — `upcoming` neutral (zinc), `due` amber, `overdue` subtle red. One component, reused in all three places.
- **Tile** (`src/app/page.tsx`): render `soonestRefresh(...)` as a single `RefreshBadge` beside the existing channel badges. Hidden when the item has no active listings.
- **Item detail + publish pages:** a per-channel row: channel name · `RefreshBadge` · exact due date/time (e.g. `OfferUp · due now · due Oct 16, 12:07`). The publish page already lists channels, so this slots into each channel block.

### Edge cases

- Only **active** listings get a clock; sold/ended/draft/ready render nothing.
- Multiple channels → tile shows the minimum `dueAt`.
- **Snoozed** items still show the clock (it's factual "when you could refresh"); the existing 💤 already signals the user is holding.
- **Craigslist** uses its 3-day interval for the clock; the 30-day "fresh relist" note lives only on the detail page, not the tile.

## Testing

Vitest unit tests for the pure helpers (no DB):
- `formatCountdown`: day/hour/minute boundaries, exactly-zero → `due now`, negative → `overdue …`, no `0d`.
- `refreshStatus`: `upcoming`/`due`/`overdue` states; anchor falls back `renewedAt ?? listedAt`; `dueAt` honors `max(interval, minInterval)`.
- `soonestRefresh`: picks the minimum `dueAt`; returns `null` for no active listings.

## Files touched (anticipated)

- `src/lib/refresh.ts` (new) + `src/lib/__tests__/refresh.test.ts` (new)
- `src/lib/queries.ts` (enrich active-listings query)
- `src/components/RefreshBadge.tsx` (new)
- `src/app/page.tsx` (tile summary)
- item detail page + `src/components/ChannelCard.tsx` / publish page (per-channel rows)
