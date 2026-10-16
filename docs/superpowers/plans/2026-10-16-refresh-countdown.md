# Refresh Countdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, per active listing, a relative countdown to its next refresh — a soonest-due summary on inventory tiles and a per-channel breakdown on the item and publish pages.

**Architecture:** One pure, unit-tested helper (`src/lib/refresh.ts`) computes the cadence clock (`anchor + interval`) and formats the token. A shared presentational `RefreshBadge` renders it. The inventory tiles get a soonest-due summary (via an enriched active-listings query); the publish page and item detail page get a per-channel breakdown from listing rows they already load.

**Tech Stack:** Next.js 16 (React Server Components by default; `ChannelCard` is a `"use client"` component), Drizzle ORM over better-sqlite3, Tailwind, Vitest.

## Global Constraints

- **Verify ONLY with** `npx tsc --noEmit`, `npx eslint <files>`, and `npm test` (vitest). **Never** run `npm run build` or `npm start`, and **never** read, write, or reset `data/dispatch.db` (a prior build-verification wiped it).
- Timestamps are stored in UTC with no marker; parse them only via `parseDbDate` from `src/lib/tasks.ts`.
- The countdown is a **pure cadence clock**, independent of the relist task engine. Do **not** change `computeTasks` or any relist gating.
- Anchor is `renewedAt ?? listedAt`; due is `anchor + max(intervalDays, minIntervalDays)` days (uniform across channels).
- Pure logic (`refresh.ts`) gets vitest unit tests. Queries and components are verified via `tsc`/`eslint` only (this repo does not unit-test those).
- Follow existing file patterns; server components by default, `"use client"` only where already used.

---

### Task 1: Pure refresh helper + tests

**Files:**
- Create: `src/lib/refresh.ts`
- Test: `src/lib/__tests__/refresh.test.ts`

**Interfaces:**
- Consumes: `parseDbDate` from `src/lib/tasks.ts`; `Listing` from `@/db/schema`; `RelistPolicy` from `@/publishers/types`.
- Produces:
  - `type RefreshState = "upcoming" | "due" | "overdue"`
  - `interface RefreshStatus { dueAt: Date; state: RefreshState; token: string }`
  - `interface ListingWithPolicy { listing: Pick<Listing, "listedAt" | "renewedAt">; policy: RelistPolicy }`
  - `formatCountdown(ms: number): string`
  - `refreshStatus(listing: Pick<Listing, "listedAt" | "renewedAt">, policy: RelistPolicy, now: Date): RefreshStatus`
  - `soonestRefresh(entries: ListingWithPolicy[], now: Date): RefreshStatus | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/refresh.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RelistPolicy } from "@/publishers/types";
import { formatCountdown, refreshStatus, soonestRefresh } from "../refresh";

const NOW = new Date("2026-10-16T16:00:00Z");
const weekly: RelistPolicy = { method: "repost", intervalDays: 7, minIntervalDays: 7 };

describe("formatCountdown", () => {
  it("uses the largest meaningful unit", () => {
    expect(formatCountdown(3 * 86_400_000)).toBe("3d");
    expect(formatCountdown(18 * 3_600_000)).toBe("18h");
    expect(formatCountdown(45 * 60_000)).toBe("45m");
  });
  it("never emits 0d and floors to at least 1m", () => {
    expect(formatCountdown(0)).toBe("1m");
    expect(formatCountdown(30_000)).toBe("1m");
    expect(formatCountdown(23 * 3_600_000)).toBe("23h");
  });
});

describe("refreshStatus", () => {
  it("is upcoming before the due mark", () => {
    const s = refreshStatus({ listedAt: "2026-10-14 16:00:00", renewedAt: null }, weekly, NOW);
    expect(s.state).toBe("upcoming");
    expect(s.token).toBe("5d");
  });
  it("is due within 24h of the mark", () => {
    const s = refreshStatus({ listedAt: "2026-10-09 12:00:00", renewedAt: null }, weekly, NOW);
    expect(s.state).toBe("due");
    expect(s.token).toBe("due now");
  });
  it("is overdue past 24h after the mark", () => {
    const s = refreshStatus({ listedAt: "2026-10-01 12:00:00", renewedAt: null }, weekly, NOW);
    expect(s.state).toBe("overdue");
    expect(s.token).toBe("overdue 8d");
  });
  it("anchors on renewedAt when present", () => {
    const s = refreshStatus(
      { listedAt: "2026-09-01 00:00:00", renewedAt: "2026-10-14 16:00:00" },
      weekly,
      NOW
    );
    expect(s.state).toBe("upcoming");
    expect(s.token).toBe("5d");
  });
  it("respects the platform minimum (max of interval and minInterval)", () => {
    const biasedMin: RelistPolicy = { method: "repost", intervalDays: 3, minIntervalDays: 7 };
    const s = refreshStatus({ listedAt: "2026-10-10 16:00:00", renewedAt: null }, biasedMin, NOW);
    // due = Oct 10 + 7d = Oct 17 16:00 → 1 day out, not Oct 13.
    expect(s.state).toBe("upcoming");
    expect(s.token).toBe("1d");
  });
});

describe("soonestRefresh", () => {
  it("returns the earliest-due (most urgent) across listings", () => {
    const s = soonestRefresh(
      [
        { listing: { listedAt: "2026-10-14 16:00:00", renewedAt: null }, policy: weekly }, // upcoming 5d
        { listing: { listedAt: "2026-10-01 12:00:00", renewedAt: null }, policy: weekly }, // overdue 8d
      ],
      NOW
    );
    expect(s?.state).toBe("overdue");
  });
  it("returns null with no listings", () => {
    expect(soonestRefresh([], NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/refresh.test.ts`
Expected: FAIL — cannot resolve `../refresh` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/lib/refresh.ts`:

```ts
import type { Listing } from "@/db/schema";
import type { RelistPolicy } from "@/publishers/types";
import { parseDbDate } from "@/lib/tasks";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export type RefreshState = "upcoming" | "due" | "overdue";

export interface RefreshStatus {
  dueAt: Date;
  state: RefreshState;
  token: string;
}

export interface ListingWithPolicy {
  listing: Pick<Listing, "listedAt" | "renewedAt">;
  policy: RelistPolicy;
}

// Magnitude-only formatter for a (non-negative) duration. Largest meaningful
// unit; never "0d". State prefixes ("due now"/"overdue") are added by
// refreshStatus, not here.
export function formatCountdown(ms: number): string {
  const v = Math.max(0, ms);
  if (v >= DAY_MS) return `${Math.floor(v / DAY_MS)}d`;
  if (v >= HOUR_MS) return `${Math.floor(v / HOUR_MS)}h`;
  return `${Math.max(1, Math.floor(v / MINUTE_MS))}m`;
}

// When a listing is next due to refresh, on a pure cadence clock:
//   dueAt = (renewedAt ?? listedAt) + max(intervalDays, minIntervalDays)
// Anchor is the last time the listing was refreshed/listed, uniform across
// channels (intentionally unlike computeTasks, which only uses renewedAt for the
// "renew-then-repost" method — here the meaning is simply "time since you last
// refreshed this").
export function refreshStatus(
  listing: Pick<Listing, "listedAt" | "renewedAt">,
  policy: RelistPolicy,
  now: Date
): RefreshStatus {
  const anchor = parseDbDate(listing.renewedAt ?? listing.listedAt);
  const intervalDays = Math.max(policy.intervalDays, policy.minIntervalDays);
  const dueAt = new Date(anchor.getTime() + intervalDays * DAY_MS);
  const delta = now.getTime() - dueAt.getTime(); // >= 0 means reached/past due

  if (delta < 0) return { dueAt, state: "upcoming", token: formatCountdown(-delta) };
  if (delta < DAY_MS) return { dueAt, state: "due", token: "due now" };
  return { dueAt, state: "overdue", token: `overdue ${formatCountdown(delta)}` };
}

// The soonest-due refresh across an item's active listings (for the tile).
// Earliest dueAt wins, so an overdue channel outranks an upcoming one. Returns
// null when there are no entries.
export function soonestRefresh(
  entries: ListingWithPolicy[],
  now: Date
): RefreshStatus | null {
  let best: RefreshStatus | null = null;
  for (const e of entries) {
    const s = refreshStatus(e.listing, e.policy, now);
    if (!best || s.dueAt < best.dueAt) best = s;
  }
  return best;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/refresh.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck, then commit**

Run: `npx tsc --noEmit` → Expected: clean.

```bash
git add src/lib/refresh.ts src/lib/__tests__/refresh.test.ts
git commit -m "feat(refresh): pure cadence-clock helper for listing refresh timing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Tile summary (enriched query + RefreshBadge + inventory grid)

**Files:**
- Modify: `src/lib/queries.ts` (add one query, after `getActiveListingsByItem`, ~line 61)
- Create: `src/components/RefreshBadge.tsx`
- Modify: `src/app/page.tsx` (swap the active-listings query; render the summary badge)

**Interfaces:**
- Consumes: `refreshStatus`, `soonestRefresh`, `RefreshState`, `ListingWithPolicy` from `src/lib/refresh.ts` (Task 1); `getPublisher` from `@/publishers`.
- Produces:
  - `interface ActiveListingTiming { publisher: string; listedAt: string; renewedAt: string | null }`
  - `getActiveListingsWithTimingByItem(): Promise<Map<number, ActiveListingTiming[]>>`
  - `RefreshBadge({ state, token, title? })` React component.

- [ ] **Step 1: Add the enriched query**

In `src/lib/queries.ts`, add after the existing `getActiveListingsByItem` function:

```ts
export interface ActiveListingTiming {
  publisher: string;
  listedAt: string;
  renewedAt: string | null;
}

export async function getActiveListingsWithTimingByItem(): Promise<
  Map<number, ActiveListingTiming[]>
> {
  const rows = await db.select().from(listings).where(eq(listings.status, "active"));
  const map = new Map<number, ActiveListingTiming[]>();
  for (const row of rows) {
    const arr = map.get(row.itemId) ?? [];
    arr.push({ publisher: row.publisher, listedAt: row.listedAt, renewedAt: row.renewedAt });
    map.set(row.itemId, arr);
  }
  return map;
}
```

- [ ] **Step 2: Create the RefreshBadge component**

Create `src/components/RefreshBadge.tsx`:

```tsx
import type { RefreshState } from "@/lib/refresh";

const STATE_CLASSES: Record<RefreshState, string> = {
  upcoming: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  due: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  overdue: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
};

export function RefreshBadge({
  state,
  token,
  title,
}: {
  state: RefreshState;
  token: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_CLASSES[state]}`}
    >
      ↻ {token}
    </span>
  );
}
```

- [ ] **Step 3: Wire the summary into the inventory tiles**

In `src/app/page.tsx`:

1. Update imports — replace the `getActiveListingsByItem` import with the new query, and add the helper + component:

```ts
import {
  getItems,
  getFirstPhotos,
  getActiveListingsWithTimingByItem,
  getTaskData,
} from "@/lib/queries";
import { soonestRefresh, type ListingWithPolicy } from "@/lib/refresh";
import { RefreshBadge } from "@/components/RefreshBadge";
```

2. Replace the data line (currently `const listedWhere = await getActiveListingsByItem();`) and add a shared `now`:

```ts
const listedTiming = await getActiveListingsWithTimingByItem();
const now = new Date();
```

3. Use that same `now` for tasks (replace `now: new Date()` in the `computeTasks` call):

```ts
const tasks = computeTasks({ ...taskData, publishers, now });
```

4. Inside the `.map((item) => ...)`, before the returned `<Link>`, compute the summary:

```tsx
const timing = listedTiming.get(item.id) ?? [];
const refreshEntries: ListingWithPolicy[] = timing.flatMap((e) => {
  const pub = getPublisher(e.publisher);
  return pub ? [{ listing: e, policy: pub.relistPolicy }] : [];
});
const soon = soonestRefresh(refreshEntries, now);
```

5. Replace the existing channel-badge block (the `{(listedWhere.get(item.id) ?? []).length > 0 && (...)}` section) with one that reads `timing` and appends the summary badge:

```tsx
{timing.length > 0 && (
  <div className="flex flex-wrap items-center gap-1">
    {timing.map((e) => (
      <span
        key={e.publisher}
        className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:text-green-400"
      >
        {getPublisher(e.publisher)?.name ?? e.publisher}
      </span>
    ))}
    {soon && <RefreshBadge state={soon.state} token={soon.token} title={`Next refresh due ${soon.dueAt.toLocaleString()}`} />}
  </div>
)}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → Expected: clean (no remaining references to `getActiveListingsByItem` or `listedWhere` in `page.tsx`).
Run: `npx eslint src/app/page.tsx src/components/RefreshBadge.tsx src/lib/queries.ts` → Expected: clean.
Run: `npm test` → Expected: all pass (unchanged count).

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts src/components/RefreshBadge.tsx src/app/page.tsx
git commit -m "feat(refresh): soonest-due refresh badge on inventory tiles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Per-channel breakdown (publish page + item detail page)

**Files:**
- Modify: `src/components/ChannelCard.tsx` (add a `refresh` prop + render it near the policy label)
- Modify: `src/app/items/[id]/publish/page.tsx` (compute per-channel refresh, pass it in)
- Modify: `src/app/items/[id]/page.tsx` (add an "Active listings" section with per-channel refresh)

**Interfaces:**
- Consumes: `refreshStatus` from `src/lib/refresh.ts` (Task 1); `RefreshBadge` from `src/components/RefreshBadge.tsx` (Task 2); `getPublisher` from `@/publishers`.
- Produces: `ChannelCard` gains an optional prop `refresh?: { state: RefreshState; token: string; dueLabel: string } | null` (a plain serializable object — no `Date` crosses the server→client boundary).

- [ ] **Step 1: Add the `refresh` prop to ChannelCard**

In `src/components/ChannelCard.tsx`:

1. Add imports near the other imports:

```ts
import { RefreshBadge } from "@/components/RefreshBadge";
import type { RefreshState } from "@/lib/refresh";
```

2. Add the prop to the destructured params and the props type (alongside `policyLabel`):

```ts
  policyLabel,
  refresh,
```

and in the type block:

```ts
  policyLabel: string;
  refresh?: { state: RefreshState; token: string; dueLabel: string } | null;
```

3. Render it right after wherever `policyLabel` is shown. Find the element that renders `{policyLabel}` and append, immediately after that element:

```tsx
{refresh && (
  <span className="ml-2 inline-flex items-center gap-1 align-middle">
    <RefreshBadge state={refresh.state} token={refresh.token} />
    <span className="text-[10px] text-zinc-500">refresh {refresh.dueLabel}</span>
  </span>
)}
```

- [ ] **Step 2: Compute + pass refresh from the publish page**

In `src/app/items/[id]/publish/page.tsx`:

1. Add imports:

```ts
import { refreshStatus } from "@/lib/refresh";
```

2. After `const { photos, listings, prices: _prices, ...itemRow } = item;`, add:

```ts
const now = new Date();
```

3. Inside the `publishers.map((pub) => { ... })`, after `const activeListing = ...`, compute the serializable refresh object:

```ts
const r = activeListing ? refreshStatus(activeListing, pub.relistPolicy, now) : null;
const refresh = r
  ? {
      state: r.state,
      token: r.token,
      dueLabel: r.dueAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    }
  : null;
```

4. Pass it into the `<ChannelCard ... />` (add the prop alongside `policyLabel`):

```tsx
            refresh={refresh}
```

- [ ] **Step 3: Add the per-channel section to the item detail page**

In `src/app/items/[id]/page.tsx`:

1. Add imports:

```ts
import { getPublisher } from "@/publishers";
import { refreshStatus } from "@/lib/refresh";
import { RefreshBadge } from "@/components/RefreshBadge";
```

2. After `if (!item) notFound();`, add:

```ts
const now = new Date();
const activeListings = item.listings.filter((l) => l.status === "active");
```

3. Insert this section immediately after the closing `</section>` of the status/mark-sold block (the `<section className="flex flex-wrap items-end gap-4 ...">`), before the dates `<section className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">`:

```tsx
{activeListings.length > 0 && (
  <section>
    <h2 className="mb-2 text-sm font-medium text-zinc-500">Active listings</h2>
    <ul className="space-y-1 text-sm">
      {activeListings.map((l) => {
        const pub = getPublisher(l.publisher);
        const r = pub ? refreshStatus(l, pub.relistPolicy, now) : null;
        return (
          <li key={l.id} className="flex items-center gap-2">
            <span className="font-medium">{pub?.name ?? l.publisher}</span>
            {r && <RefreshBadge state={r.state} token={r.token} />}
            {r && (
              <span className="text-xs text-zinc-500">
                refresh{" "}
                {r.dueAt.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  </section>
)}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → Expected: clean.
Run: `npx eslint src/components/ChannelCard.tsx "src/app/items/[id]/publish/page.tsx" "src/app/items/[id]/page.tsx"` → Expected: clean.
Run: `npm test` → Expected: all pass (unchanged count).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChannelCard.tsx "src/app/items/[id]/publish/page.tsx" "src/app/items/[id]/page.tsx"
git commit -m "feat(refresh): per-channel refresh breakdown on item + publish pages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Live verification (after all tasks, optional, with Wil)

The server already runs on :3000 against real data (OfferUp listings were recorded Oct 9). Load `/` and an item/publish page in the Browser pane and confirm: tiles show a soonest-due token (the Oct-9 OfferUp items read `overdue` on a 7-day clock as of Oct 16), and the publish/detail pages show the per-channel breakdown. This is a visual confirmation only — all logic is covered by the Task 1 unit tests.
