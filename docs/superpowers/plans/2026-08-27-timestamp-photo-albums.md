# Timestamp Photo + Two-Album [WTS] Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Wil mark one photo as the r/WatchExchange timestamp and have the `reddit-watchexchange` post pull two separate imgur links (Photos album + Timestamp) from the item, without those links leaking into other channels.

**Architecture:** A new `photos.is_timestamp` flag (with a toggle action + PhotoGrid button) marks the timestamp photo; the publisher reads two reserved attributes (`Photos Album`, `Timestamp`) for the `[Photos] | [Timestamp]` line; `specLines` skips those reserved keys so Facebook/OfferUp/Craigslist don't render them. The album build itself is a Claude playbook (spec), not code.

**Tech Stack:** Next.js 16, Drizzle ORM + better-sqlite3, vitest, TypeScript, React client components.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (per AGENTS.md). This plan uses only existing patterns (server actions, a client component form).
- `photos.is_timestamp`: at most one per item; the toggle clears it on the item's other photos. Independent of `primary` (which stays first-by-`sortOrder`).
- The two link fields are attributes `Photos Album` and `Timestamp`; the publisher falls back to the literal placeholders `PHOTOS_ALBUM_URL` / `TIMESTAMP_ALBUM_URL` when unset.
- These two keys are RESERVED — `specLines` must never emit them (no leak to Facebook/OfferUp/Craigslist).
- Adding a column changes the inferred `Photo` type, so the `makePhotos` fixture must gain the field or `tsc` breaks (`npm test` does not type-check — run `npx tsc --noEmit`).
- Tests: `npm test` runs `vitest run`. Branch: `watchexchange-timestamp-albums`.

---

### Task 1: `photos.is_timestamp` column + migration

**Files:**
- Modify: `src/db/schema.ts` (photos table)
- Modify: `src/publishers/__tests__/fixtures.ts` (`makePhotos`)
- Create: `drizzle/0004_*.sql` (generated)

**Interfaces:**
- Produces: `photos.isTimestamp: boolean` column; the `Photo` type gains `isTimestamp: boolean`.

- [ ] **Step 1: Add the column to the schema**

In `src/db/schema.ts`, in the `photos` table, add after the `sortOrder` line:

```ts
  isTimestamp: integer("is_timestamp", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 2: Keep the fixture type-valid**

In `src/publishers/__tests__/fixtures.ts`, add `isTimestamp: false,` to the object `makePhotos` returns (after `sortOrder: i,`):

```ts
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    itemId: 1,
    path: `1-photo-${i + 1}.jpg`,
    sortOrder: i,
    isTimestamp: false,
    createdAt: "2026-07-10 12:00:00",
  }));
```

- [ ] **Step 3: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/0004_*.sql` with `ALTER TABLE \`photos\` ADD \`is_timestamp\` integer DEFAULT false NOT NULL;` (only the photos table altered).

- [ ] **Step 4: Verify types + tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 0 errors; all tests pass (in-memory DBs migrate with the new column; existing photos default to false).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/publishers/__tests__/fixtures.ts drizzle/
git commit -m "feat: add photos.is_timestamp column"
```

---

### Task 2: `toggleTimestampPhoto` core + `markTimestampPhoto` action

**Files:**
- Modify: `src/lib/photo-order.ts` (core)
- Modify: `src/lib/actions.ts` (server action)
- Test: `src/lib/__tests__/photo-order.test.ts`

**Interfaces:**
- Consumes: `photos.isTimestamp` (Task 1); `DB`, `and`, `eq` already imported in `photo-order.ts`.
- Produces:
  - `toggleTimestampPhoto(db: DB, photoId: number, itemId: number): Promise<void>` (photo-order.ts)
  - `markTimestampPhoto(photoId: number, itemId: number): Promise<void>` (actions.ts server action)

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/photo-order.test.ts`, add `toggleTimestampPhoto` to the import from `../photo-order`, and append:

```ts
async function timestampPaths(itemId: number) {
  const rows = await db.select().from(photos).where(eq(photos.itemId, itemId));
  return rows.filter((r) => r.isTimestamp).map((r) => r.path);
}

describe("toggleTimestampPhoto", () => {
  it("marks the chosen photo as the timestamp", async () => {
    const [t] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    await toggleTimestampPhoto(db, t.id, t.itemId);
    expect(await timestampPaths(t.itemId)).toEqual(["b.jpg"]);
  });

  it("is one-per-item: marking a second clears the first", async () => {
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    const [c] = await db.select().from(photos).where(eq(photos.path, "c.jpg"));
    await toggleTimestampPhoto(db, b.id, b.itemId);
    await toggleTimestampPhoto(db, c.id, c.itemId);
    expect(await timestampPaths(b.itemId)).toEqual(["c.jpg"]);
  });

  it("toggles off when the same photo is marked again", async () => {
    const [b] = await db.select().from(photos).where(eq(photos.path, "b.jpg"));
    await toggleTimestampPhoto(db, b.id, b.itemId);
    await toggleTimestampPhoto(db, b.id, b.itemId);
    expect(await timestampPaths(b.itemId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- photo-order`
Expected: FAIL — `toggleTimestampPhoto is not a function`.

- [ ] **Step 3: Implement the core**

In `src/lib/photo-order.ts`, append:

```ts
// Mark one photo as the r/WatchExchange timestamp (one per item). Toggling the
// same photo again clears it. Independent of primary/sortOrder.
export async function toggleTimestampPhoto(db: DB, photoId: number, itemId: number) {
  const [target] = await db
    .select({ isTimestamp: photos.isTimestamp })
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
  if (!target) return;
  if (target.isTimestamp) {
    await db
      .update(photos)
      .set({ isTimestamp: false })
      .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
    return;
  }
  await db.update(photos).set({ isTimestamp: false }).where(eq(photos.itemId, itemId));
  await db
    .update(photos)
    .set({ isTimestamp: true })
    .where(and(eq(photos.id, photoId), eq(photos.itemId, itemId)));
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- photo-order`
Expected: PASS.

- [ ] **Step 5: Add the server action**

In `src/lib/actions.ts`, add `toggleTimestampPhoto` to the existing import from `@/lib/photo-order` (the line importing `setPhotoOrder, setPrimaryPhoto`), then add near `makePrimaryPhoto`:

```ts
export async function markTimestampPhoto(photoId: number, itemId: number) {
  await toggleTimestampPhoto(db, photoId, itemId);
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  revalidatePath(`/items/${itemId}/edit`);
}
```

- [ ] **Step 6: Verify types + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/photo-order.ts src/lib/actions.ts src/lib/__tests__/photo-order.test.ts
git commit -m "feat: toggleTimestampPhoto core + markTimestampPhoto action"
```

---

### Task 3: PhotoGrid timestamp toggle + badge

**Files:**
- Modify: `src/components/PhotoGrid.tsx`

**Interfaces:**
- Consumes: `markTimestampPhoto` (Task 2); `photo.isTimestamp` (Task 1).

- [ ] **Step 1: Import the action**

In `src/components/PhotoGrid.tsx`, extend the import from `@/lib/actions`:

```ts
import { deletePhoto, makePrimaryPhoto, markTimestampPhoto, reorderPhotos } from "@/lib/actions";
```

- [ ] **Step 2: Add the timestamp badge**

Right after the existing `{index === 0 && ( … ★ Primary … )}` badge block, add:

```tsx
          {photo.isTimestamp && (
            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
              ⏱ Timestamp
            </span>
          )}
```

- [ ] **Step 3: Add the toggle button**

Inside the `{editable && (` hover controls `<div>`, before the delete `<form>`, add:

```tsx
              <form action={markTimestampPhoto.bind(null, photo.id, itemId)}>
                <button
                  className={`rounded-full px-2 py-0.5 text-xs text-white hover:bg-sky-500 ${photo.isTimestamp ? "bg-sky-600" : "bg-black/70"}`}
                  aria-label="Mark as timestamp photo"
                  title="Mark as timestamp — its own separate link, per r/WatchExchange"
                >
                  ⏱
                </button>
              </form>
```

- [ ] **Step 4: Verify build + lint + tsc**

Run: `npx tsc --noEmit && npx eslint src/components/PhotoGrid.tsx && npm run build`
Expected: tsc clean; eslint shows only the pre-existing `PhotoGrid.tsx` `react-hooks/set-state-in-effect` error (do NOT fix it here — out of scope); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/PhotoGrid.tsx
git commit -m "feat: PhotoGrid timestamp toggle + badge"
```

---

### Task 4: Publisher reads the two links; specLines skips reserved keys

**Files:**
- Modify: `src/publishers/helpers.ts` (`specLines`)
- Modify: `src/publishers/reddit-watchexchange.ts`
- Test: `src/publishers/__tests__/reddit-watchexchange.test.ts`
- Test: `src/publishers/__tests__/helpers.test.ts` (create if absent; otherwise append)

**Interfaces:**
- Consumes: item attributes `Photos Album`, `Timestamp`.
- Produces: `RESERVED_ATTRIBUTE_KEYS` (Set) exported from `helpers.ts`; `specLines` excludes them; the reddit publisher's photos line uses them.

- [ ] **Step 1: Write the failing publisher tests**

In `src/publishers/__tests__/reddit-watchexchange.test.ts`, append:

```ts
describe("redditWatchexchange photo links", () => {
  it("uses the Photos Album and Timestamp attributes when set", () => {
    const item = makeItem({ attributes: { "Photos Album": "https://imgur.com/a/AAA", "Timestamp": "https://i.imgur.com/BBB.jpeg" } });
    const { body } = redditWatchexchange.generate(item, makePhotos(1));
    expect(body).toContain("[Photos](https://imgur.com/a/AAA) | [Timestamp](https://i.imgur.com/BBB.jpeg)");
  });

  it("falls back to placeholders when the links are unset", () => {
    const { body } = redditWatchexchange.generate(makeItem({ attributes: {} }), makePhotos(1));
    expect(body).toContain("[Photos](PHOTOS_ALBUM_URL) | [Timestamp](TIMESTAMP_ALBUM_URL)");
  });

  it("does not render the link attributes as spec/other lines", () => {
    const item = makeItem({ attributes: { "Photos Album": "https://imgur.com/a/AAA", "Timestamp": "https://i.imgur.com/BBB.jpeg" } });
    const { body } = redditWatchexchange.generate(item, makePhotos(1));
    expect(body).not.toContain("Photos Album: https");
    expect(body).not.toContain("Timestamp: https");
  });
});
```

- [ ] **Step 2: Write the failing specLines test**

Create `src/publishers/__tests__/helpers.test.ts` (or append if it exists):

```ts
import { describe, expect, it } from "vitest";
import { specLines } from "../helpers";
import { makeItem } from "./fixtures";

describe("specLines", () => {
  it("skips the reserved album-link keys (no leak to other channels)", () => {
    const item = makeItem({ attributes: { Brand: "Rolex", "Photos Album": "https://imgur.com/a/AAA", "Timestamp": "https://i.imgur.com/BBB.jpeg" } });
    const lines = specLines(item);
    expect(lines).toContain("Brand: Rolex");
    expect(lines.some((l) => l.startsWith("Photos Album:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("Timestamp:"))).toBe(false);
  });
});
```

- [ ] **Step 3: Run both to confirm they fail**

Run: `npm test -- reddit-watchexchange helpers`
Expected: FAIL — placeholders still hardcoded; `specLines` still emits the reserved keys.

- [ ] **Step 4: Filter reserved keys in specLines**

In `src/publishers/helpers.ts`, add above `specLines` and update the function:

```ts
// Attribute keys the reddit-watchexchange publisher consumes directly for the
// [Photos] | [Timestamp] line — never render them as generic spec lines.
export const RESERVED_ATTRIBUTE_KEYS = new Set(["Photos Album", "Timestamp"]);

export function specLines(item: Item): string[] {
  return Object.entries(item.attributes)
    .filter(([key]) => !RESERVED_ATTRIBUTE_KEYS.has(key))
    .map(([key, value]) => `${key}: ${value}`);
}
```

- [ ] **Step 5: Read the links in the reddit publisher**

In `src/publishers/reddit-watchexchange.ts`, inside `generate`, replace the hardcoded photos line. Add near the top of `generate` (after `const a = item.attributes;`):

```ts
    const photosAlbum = a["Photos Album"] ?? "PHOTOS_ALBUM_URL";
    const timestampLink = a["Timestamp"] ?? "TIMESTAMP_ALBUM_URL";
```

Then change the body's photos line from:

```ts
      `[Photos](PHOTOS_ALBUM_URL) | [Timestamp](TIMESTAMP_ALBUM_URL)`,
```

to:

```ts
      `[Photos](${photosAlbum}) | [Timestamp](${timestampLink})`,
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npm test -- reddit-watchexchange helpers`
Expected: PASS.

- [ ] **Step 7: Full suite + types**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all pass (confirms no other publisher test broke from the specLines filter).

- [ ] **Step 8: Commit**

```bash
git add src/publishers/helpers.ts src/publishers/reddit-watchexchange.ts src/publishers/__tests__/reddit-watchexchange.test.ts src/publishers/__tests__/helpers.test.ts
git commit -m "feat: reddit publisher reads Photos Album + Timestamp links; specLines skips reserved keys"
```

---

## Self-Review

**Spec coverage:**
- Timestamp marker (schema + one-per-item action + PhotoGrid toggle/badge) → Tasks 1–3. ✓
- Publisher reads two link fields with placeholder fallback → Task 4. ✓
- Links stored as attributes, no leak to other channels → Task 4 (`specLines` reserved-key filter — realizes the spec's "never leak" intent, which the spec asserted only for the reddit block; the other channels needed this filter). ✓
- Album build = Claude playbook (no code) → correctly absent from this plan; documented in the spec. ✓
- Primary unaffected (independent flag) → `toggleTimestampPhoto` never touches `sortOrder`. ✓
- One-per-item + unmark toggle → Task 2 tests cover mark, replace, and toggle-off. ✓

**Placeholder scan:** No TBD/TODO. The literal strings `PHOTOS_ALBUM_URL` / `TIMESTAMP_ALBUM_URL` are intentional fallback placeholders (matching v1.6), not plan placeholders.

**Type consistency:** `isTimestamp` (Task 1) is read in Tasks 2 (core), 3 (PhotoGrid). Core `toggleTimestampPhoto(db, photoId, itemId)` (Task 2) is wrapped by action `markTimestampPhoto(photoId, itemId)` (Task 2) and consumed by PhotoGrid (Task 3). Reserved keys `"Photos Album"` / `"Timestamp"` are consistent across `specLines` (helpers) and the publisher (Task 4). `makePhotos` fixture (Task 1) gains `isTimestamp` so `Photo` literals stay valid.
