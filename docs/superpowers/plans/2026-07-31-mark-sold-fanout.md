# Mark-Sold Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on a sold item records the sale (price + channel) and takes it down everywhere — OfferUp + Facebook via the emulator, Craigslist and any failed takedown surfaced as a computed "take it down" task.

**Architecture:** A pure `markSoldCore` DB write, a new computed `manual_takedown` task derived from state, two new emulator flows modeled on the existing reprice flows, and a `markSoldAndTakedown` server action that orchestrates them and returns a per-channel result rendered by a client component.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle ORM + better-sqlite3, vitest, ADB/uiautomator emulator automation, React client components with `useTransition`.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (per AGENTS.md — this Next.js has breaking changes vs. training data).
- SQLite datetimes are stored as `"YYYY-MM-DD HH:MM:SS"` (UTC, no marker); use the existing `toDbDate(date)` helper in `task-actions.ts` for all timestamp writes.
- Core functions take `db: DB` as their first param and are pure (no `revalidatePath`, no `redirect`); server actions in `actions.ts` / `automation-actions.ts` wrap them and handle revalidation.
- Emulator flows return `AndroidResult` (`{status:"done"} | {status:"failed",step,reason} | {status:"login_required"} | {status:"posted_review"}`) and never throw past their `step()` wrappers.
- OfferUp takedown always selects **"Sold it somewhere else"** — never match a buyer.
- Facebook's "Mark as sold" tap is UNVERIFIED — build it, comment it as such, do not claim live verification.
- Tests: `npm test` runs `vitest run`.

---

### Task 1: Schema — `sold_channel` column + migration

**Files:**
- Modify: `src/db/schema.ts` (items table + new `SOLD_CHANNELS` const)
- Create: `drizzle/0003_*.sql` (generated)

**Interfaces:**
- Produces: `SOLD_CHANNELS` (readonly string tuple), `SoldChannel` type, `items.soldChannel` column (nullable text).

- [ ] **Step 1: Add the const + type + column to the schema**

In `src/db/schema.ts`, after the `CONDITIONS` block (before `export const items`), add:

```ts
export const SOLD_CHANNELS = [
  "offerup",
  "facebook",
  "craigslist",
  "other",
] as const;

export type SoldChannel = (typeof SOLD_CHANNELS)[number];
```

Then inside the `items` table definition, immediately after the `soldPrice: real("sold_price"),` line, add:

```ts
  soldChannel: text("sold_channel", { enum: SOLD_CHANNELS }),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new file `drizzle/0003_<random>.sql` containing `ALTER TABLE \`items\` ADD \`sold_channel\` text;`. Confirm no other tables were altered.

- [ ] **Step 3: Verify it compiles and existing tests still pass**

Run: `npm test`
Expected: PASS (the in-memory test DBs migrate cleanly with the new column present).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add items.sold_channel column + SOLD_CHANNELS"
```

---

### Task 2: Core DB writes — `markSoldCore` + `endListingCore`

**Files:**
- Modify: `src/lib/task-actions.ts`
- Test: `src/lib/__tests__/task-actions.test.ts`

**Interfaces:**
- Consumes: `toDbDate` (private, same file), `DB` type (same file), `SoldChannel` (Task 1).
- Produces:
  - `markSoldCore(db: DB, itemId: number, soldPrice: number | null, soldChannel: SoldChannel | null, now: Date): Promise<void>`
  - `endListingCore(db: DB, listingId: number, now: Date): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/task-actions.test.ts`, add `markSoldCore, endListingCore` to the import from `../task-actions`, and append these describe blocks:

```ts
describe("markSoldCore", () => {
  it("sets status=sold, price, channel, soldAt", async () => {
    await markSoldCore(db, itemId, 35, "facebook", NOW);
    const [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.status).toBe("sold");
    expect(item.soldPrice).toBe(35);
    expect(item.soldChannel).toBe("facebook");
    expect(item.soldAt).toBe("2026-07-10 12:00:00");
  });

  it("accepts a null price and null channel", async () => {
    await markSoldCore(db, itemId, null, null, NOW);
    const [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.status).toBe("sold");
    expect(item.soldPrice).toBeNull();
    expect(item.soldChannel).toBeNull();
  });
});

describe("endListingCore", () => {
  it("ends the row and stamps endedAt", async () => {
    const [listing] = await db
      .insert(listings)
      .values({ itemId, publisher: "craigslist", listedPrice: 40 })
      .returning();
    await endListingCore(db, listing.id, NOW);
    const [row] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(row.status).toBe("ended");
    expect(row.endedAt).toBe("2026-07-10 12:00:00");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- task-actions`
Expected: FAIL — `markSoldCore is not a function` / `endListingCore is not a function`.

- [ ] **Step 3: Implement the cores**

In `src/lib/task-actions.ts`, add `SoldChannel` to the schema type import:

```ts
import type { SoldChannel } from "@/db/schema";
```

Append these functions at the end of the file:

```ts
// Mark-sold fan-out: record the sale on the item. Pure write; the fan-out
// server action wraps this and drives the per-channel takedowns.
export async function markSoldCore(
  db: DB,
  itemId: number,
  soldPrice: number | null,
  soldChannel: SoldChannel | null,
  now: Date
): Promise<void> {
  await db
    .update(items)
    .set({
      status: "sold",
      soldPrice,
      soldChannel,
      soldAt: toDbDate(now),
      updatedAt: toDbDate(now),
    })
    .where(eq(items.id, itemId));
}

// End a single listing row (status=ended, endedAt=now). Shared by the fan-out
// (on a successful takedown) and completeTakedown (manual "Mark done").
export async function endListingCore(
  db: DB,
  listingId: number,
  now: Date
): Promise<void> {
  await db
    .update(listings)
    .set({ status: "ended", endedAt: toDbDate(now) })
    .where(eq(listings.id, listingId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- task-actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-actions.ts src/lib/__tests__/task-actions.test.ts
git commit -m "feat: markSoldCore + endListingCore"
```

---

### Task 3: Computed `manual_takedown` task

**Files:**
- Modify: `src/lib/tasks.ts` (Task union + `computeTasks`)
- Test: `src/lib/__tests__/tasks.test.ts`

**Interfaces:**
- Consumes: `Item`, `Listing`, `Publisher`, existing `computeTasks(inputs)` and its `TaskInputs`.
- Produces: `Task` union gains `{ type: "manual_takedown"; itemId; itemName; listingId; publisherId; publisherName; listingUrl }`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/tasks.test.ts`, append:

```ts
describe("manual_takedown", () => {
  const soldItem = () => makeItem({ id: 1, name: "Bestier Desk", status: "sold" });

  it("emits a takedown task for an active listing on a sold item", () => {
    const tasks = computeTasks(
      inputs({
        items: [soldItem()],
        activeListings: [makeListing({ id: 9, itemId: 1, publisher: "craigslist", url: "https://cl/x" })],
      })
    );
    const takedowns = tasks.filter((t) => t.type === "manual_takedown");
    expect(takedowns).toHaveLength(1);
    expect(takedowns[0]).toMatchObject({
      type: "manual_takedown",
      itemId: 1,
      itemName: "Bestier Desk",
      listingId: 9,
      publisherId: "craigslist",
      listingUrl: "https://cl/x",
    });
  });

  it("does NOT emit for an ended listing (already taken down)", () => {
    const tasks = computeTasks(
      inputs({
        items: [soldItem()],
        activeListings: [], // ended rows are excluded from activeListings by the query
      })
    );
    expect(tasks.some((t) => t.type === "manual_takedown")).toBe(false);
  });

  it("does NOT emit for an active listing on a still-published item", () => {
    const tasks = computeTasks(
      inputs({
        items: [makeItem({ id: 1, name: "Live", status: "published" })],
        activeListings: [makeListing({ id: 9, itemId: 1, publisher: "craigslist" })],
      })
    );
    expect(tasks.some((t) => t.type === "manual_takedown")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tasks`
Expected: FAIL — no `manual_takedown` tasks produced.

- [ ] **Step 3: Add the task type**

In `src/lib/tasks.ts`, add to the `Task` union (after the `stale_price` member):

```ts
  | { type: "manual_takedown"; itemId: number; itemName: string; listingId: number; publisherId: string; publisherName: string; listingUrl: string | null }
```

- [ ] **Step 4: Emit the task in `computeTasks`**

In `src/lib/tasks.ts`, inside `computeTasks`, add a `takedowns` accumulator next to the others:

```ts
  const takedowns: Task[] = [];
```

Then, after the existing `for (const listing of inputs.activeListings)` loop closes (just before `return [...drops, ...stale, ...relists, ...ready];`), add a dedicated pass:

```ts
  // A sold item with a still-active listing row hasn't actually been taken
  // down there — Craigslist always (no automation), or OfferUp/Facebook when
  // their auto-takedown failed. Surface each as a manual task until the row
  // ends. (Not snooze-gated: a sold item shouldn't linger live.)
  for (const listing of inputs.activeListings) {
    const item = itemById.get(listing.itemId);
    if (!item || item.status !== "sold") continue;
    const pub = publisherById.get(listing.publisher);
    if (!pub) continue;
    takedowns.push({
      type: "manual_takedown",
      itemId: item.id,
      itemName: item.name,
      listingId: listing.id,
      publisherId: pub.id,
      publisherName: pub.name,
      listingUrl: listing.url,
    });
  }
```

Update the return to include them:

```ts
  return [...takedowns, ...drops, ...stale, ...relists, ...ready];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- tasks`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tasks.ts src/lib/__tests__/tasks.test.ts
git commit -m "feat: manual_takedown task for sold items with live listings"
```

---

### Task 4: `completeTakedown` action + Today's Tasks render

**Files:**
- Modify: `src/lib/actions.ts` (new server action)
- Modify: `src/components/TaskSection.tsx` (render the new task type)

**Interfaces:**
- Consumes: `endListingCore` (Task 2), `manual_takedown` task (Task 3), existing `OpenListingButton`.
- Produces: `completeTakedown(listingId: number, itemId: number): Promise<void>` server action.

- [ ] **Step 1: Add the server action**

In `src/lib/actions.ts`, confirm `endListingCore` is importable from `./task-actions` (add it to the existing import from `@/lib/task-actions` if that import exists, else add `import { endListingCore } from "@/lib/task-actions";`). Then add:

```ts
export async function completeTakedown(listingId: number, itemId: number) {
  await endListingCore(db, listingId, new Date());
  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
}
```

- [ ] **Step 2: Render the task**

In `src/components/TaskSection.tsx`, add `completeTakedown` to the import from `@/lib/actions`. Then add a new `case` inside the `switch (task.type)` (place it first, above `case "price_drop"`):

```tsx
            case "manual_takedown":
              return (
                <TaskRow key={i}>
                  <span className="text-sm">
                    📕 <strong>Take down on {task.publisherName}:</strong>{" "}
                    <Link href={`/items/${task.itemId}`} className="underline">
                      {task.itemName}
                    </Link>{" "}
                    <span className="text-zinc-500">(sold — still live here)</span>
                  </span>
                  <span className="flex gap-1.5">
                    {task.listingUrl && <OpenListingButton url={task.listingUrl} />}
                    <form action={completeTakedown.bind(null, task.listingId, task.itemId)}>
                      <button className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                        ✓ Marked done
                      </button>
                    </form>
                  </span>
                </TaskRow>
              );
```

- [ ] **Step 3: Verify build + lint + tests**

Run: `npm run lint && npm test`
Expected: PASS (the switch now handles the new type; no unhandled-case warning).

- [ ] **Step 4: Commit**

```bash
git add src/lib/actions.ts src/components/TaskSection.tsx
git commit -m "feat: completeTakedown action + manual_takedown task row"
```

---

### Task 5: OfferUp `markSoldOfferup` flow

**Files:**
- Modify: `src/config/android.ts` (add selectors to `offerupTestIds`)
- Create: `src/automation/android/flows/markSold.ts`
- Modify: `src/automation/android/index.ts` (export)

**Interfaces:**
- Consumes: `offerupTestIds`, adb helpers `findByTestId` / `findByContentDesc`, `ensureBooted` / `launchOfferup` / `isOfferupLoggedOut` / `ensureAdbKeyboard`, `step` / `waitForNode` from `./post`, `newTracker` / `resolveResult`.
- Produces: `markSoldOfferup(ctx: FlowContext): Promise<AndroidResult>`.

Selectors captured live 2026-07-31 (verified end state: item-dashboard pill = "Sold"):
`mark-sold-button` (exists) → affirm dialog `ucl.affirm-reject-dialog.affirm.button` → "Who bought it?" radio row with content-desc containing `"Sold it somewhere else"` → `Confirm` button (content-desc "Confirm") → optional ASPCA modal dismissed via content-desc `"No Thanks"`.

- [ ] **Step 1: Add selectors**

In `src/config/android.ts`, inside `offerupTestIds` (after the `markSold:` line), add:

```ts
  // Mark-sold flow (captured live 2026-07-31)
  markSoldAffirm: "ucl.affirm-reject-dialog.affirm.button", // "This can't be undone" confirm
  soldElsewhereText: "Sold it somewhere else",              // "Who bought it?" radio row (match by content-desc contains)
  soldConfirm: "Confirm",                                   // "Who bought it?" confirm (content-desc)
  soldDonationDismiss: "No Thanks",                         // post-sale ASPCA upsell (content-desc; optional)
```

- [ ] **Step 2: Write the flow**

Create `src/automation/android/flows/markSold.ts`:

```ts
import { offerupTestIds } from "@/config/android";
import { findByContentDesc, findByTestId, type UiNode } from "../adb";
import { ensureAdbKeyboard, ensureBooted, isOfferupLoggedOut, launchOfferup } from "../device";
import { newTracker, resolveResult, type AndroidResult, type FlowContext } from "../types";
import { step, waitForNode } from "./post";

// Mark an existing OfferUp listing SOLD, hands-off. Captured live 2026-07-31:
// Account -> public profile -> listing -> Manage this item -> Mark sold ->
// affirm "can't be undone" -> "Who bought it?" -> "Sold it somewhere else"
// -> Confirm -> dismiss the post-sale donation upsell. Always "sold elsewhere":
// matching a real OfferUp buyer is unreliable, so we never rate one here.
export async function markSoldOfferup(ctx: FlowContext): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchOfferup(adb);
  if (await isOfferupLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  const title = ctx.item.name;
  const tap = async (testId: string) => {
    const node = findByTestId(await adb.dumpUi(), testId);
    if (!node) throw new Error(`not found: ${testId}`);
    await adb.tapNode(node);
  };

  if (
    !(await step(adb, t, "open account", async () => {
      await tap(offerupTestIds.accountTab);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.publicProfile));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open listings", async () => {
      await tap(offerupTestIds.publicProfile);
      await waitForNode(adb, (nodes) =>
        nodes.find((n) => n.testId.startsWith("ProfileListingItem.btn."))
      );
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open listing", async () => {
      const wanted = offerupTestIds.listingByTitle(title);
      let matches = (await adb.dumpUi()).filter((n) => n.testId === wanted);
      for (let i = 0; i < 6 && matches.length === 0; i++) {
        await adb.shell(["input", "swipe", "540", "1600", "540", "800", "250"]);
        await new Promise((r) => setTimeout(r, 800));
        matches = (await adb.dumpUi()).filter((n) => n.testId === wanted);
      }
      if (matches.length === 0) throw new Error(`listing not found: ${title}`);
      if (matches.length > 1) {
        throw new Error(`ambiguous title: ${matches.length} listings named "${title}" — resolve on OfferUp first`);
      }
      await adb.tapNode(matches[0]);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.manageOwnItem));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "open dashboard", async () => {
      await tap(offerupTestIds.manageOwnItem);
      await waitForNode(adb, (nodes) => findByTestId(nodes, offerupTestIds.markSold));
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "mark sold", async () => {
      await tap(offerupTestIds.markSold);
      // "This can't be undone" affirm dialog.
      const affirm = await waitForNode(adb, (nodes) =>
        findByTestId(nodes, offerupTestIds.markSoldAffirm)
      );
      await adb.tapNode(affirm);
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "sold elsewhere", async () => {
      // "Who bought it?" screen — select the "Sold it somewhere else" radio row
      // (content-desc combines both lines), then Confirm.
      const row = await waitForNode(adb, (nodes) =>
        nodes.find((n) => n.contentDesc.includes(offerupTestIds.soldElsewhereText))
      );
      await adb.tapNode(row);
      await new Promise((r) => setTimeout(r, 800));
      const confirm = findByContentDesc(await adb.dumpUi(), offerupTestIds.soldConfirm);
      if (!confirm) throw new Error("Confirm button not found on 'Who bought it?'");
      await adb.tapNode(confirm);
    }))
  )
    return resolveResult(t);

  // Post-sale ASPCA donation upsell — dismiss if shown; never tap "Donate".
  // Best-effort: absence is fine, so this is not a tracked step.
  for (let i = 0; i < 3; i++) {
    const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
    const dismiss = findByContentDesc(nodes, offerupTestIds.soldDonationDismiss);
    if (!dismiss) break;
    await adb.tapNode(dismiss);
    await new Promise((r) => setTimeout(r, 800));
  }

  return resolveResult(t);
}
```

- [ ] **Step 3: Export it**

In `src/automation/android/index.ts`, add:

```ts
export { markSoldOfferup } from "./flows/markSold";
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`
Expected: PASS (no type errors; flow is live-verified separately, no unit test — consistent with the other android flows).

- [ ] **Step 5: Commit**

```bash
git add src/config/android.ts src/automation/android/flows/markSold.ts src/automation/android/index.ts
git commit -m "feat: markSoldOfferup emulator flow (captured live 2026-07-31)"
```

---

### Task 6: Facebook `markSoldFacebook` flow (UNVERIFIED)

**Files:**
- Create: `src/automation/android/flows/facebook/markSold.ts`
- Modify: `src/automation/android/index.ts` (export)

**Interfaces:**
- Consumes: `facebookSelectors` (`manageMenuPrefix`, `sellTab`, `yourListings`, `markSold` all already defined), adb helpers, `ensureBooted` / `launchFacebook` / `isFacebookLoggedOut`, `step` / `waitForNode`, `tapLabel` from `./post`.
- Produces: `markSoldFacebook(ctx: FlowContext): Promise<AndroidResult>`.

- [ ] **Step 1: Write the flow**

Create `src/automation/android/flows/facebook/markSold.ts`:

```ts
import { facebookSelectors } from "@/config/facebook";
import { findByTextContains, type UiNode } from "../../adb";
import {
  ensureAdbKeyboard,
  ensureBooted,
  isFacebookLoggedOut,
  launchFacebook,
} from "../../device";
import {
  newTracker,
  resolveResult,
  type AndroidResult,
  type FlowContext,
} from "../../types";
import { step, waitForNode } from "../post";
import { tapLabel } from "./post";

// Mark a live Facebook listing SOLD via its per-card management menu.
// Nav (Seller Hub -> Your listings -> "Open management menu for <title>") is the
// SAME proven path the FB reprice/delete flows use; the "Mark as sold" tap
// itself is UNVERIFIED (the only FB listing was already sold at build time, same
// status as FB Renew). Verify live against the next real FB listing.
export async function markSoldFacebook(ctx: FlowContext): Promise<AndroidResult> {
  const adb = await ensureBooted();
  await launchFacebook(adb);
  if (await isFacebookLoggedOut(adb)) return { status: "login_required" };
  await ensureAdbKeyboard(adb);

  const t = newTracker();
  const title = ctx.item.name;
  const menuLabel = facebookSelectors.manageMenuPrefix + title;

  if (
    !(await step(adb, t, "open your listings", async () => {
      await adb.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", "fb://marketplace"]);
      const tapText = async (label: string) => {
        const node = await waitForNode(adb, (n) => findByTextContains(n, label), 15000, 500, label);
        await adb.tapNode(node);
      };
      await tapText(facebookSelectors.sellTab);
      await tapText(facebookSelectors.yourListings);
    }))
  )
    return resolveResult(t);

  if (
    !(await step(adb, t, "mark sold", async () => {
      const menus = (await adb.dumpUi()).filter((n) => n.contentDesc === menuLabel);
      if (menus.length === 0) throw new Error(`listing not found: ${title}`);
      if (menus.length > 1) {
        throw new Error(`ambiguous title: ${menus.length} listings named "${title}" — resolve on Facebook first`);
      }
      await adb.tapNode(menus[0]);
      // UNVERIFIED tap: the management sheet exposes "Mark as sold".
      await tapLabel(adb, facebookSelectors.markSold);
      // Completion: the management sheet closed (the menu label is gone).
      let closed = false;
      for (let i = 0; i < 10; i++) {
        const nodes = await adb.dumpUi().catch(() => [] as UiNode[]);
        if (nodes.length && !nodes.some((n) => n.contentDesc === menuLabel && n.testId.length === 0)) {
          closed = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!closed) throw new Error("management sheet did not close after 'Mark as sold'");
    }))
  )
    return resolveResult(t);

  return resolveResult(t);
}
```

- [ ] **Step 2: Export it**

In `src/automation/android/index.ts`, add:

```ts
export { markSoldFacebook } from "./flows/facebook/markSold";
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/automation/android/flows/facebook/markSold.ts src/automation/android/index.ts
git commit -m "feat: markSoldFacebook flow (built from selector, UNVERIFIED)"
```

---

### Task 7: `markSoldAndTakedown` fan-out action + Mark-sold UI

**Files:**
- Modify: `src/lib/automation-actions.ts` (new action + `SoldResult` type)
- Create: `src/components/MarkSoldForm.tsx`
- Modify: `src/app/items/[id]/page.tsx` (replace the inline sold form with the client component)

**Interfaces:**
- Consumes: `markSoldCore` / `endListingCore` (Task 2), `markSoldOfferup` (Task 5), `markSoldFacebook` (Task 6), existing `getItem`, `acquireAndroidLock` / `releaseAndroidLock`, `OFFERUP_AUTOMATION_ENABLED` / `FACEBOOK_AUTOMATION_ENABLED`, `SoldChannel` / `SOLD_CHANNELS`.
- Produces:
  - `type SoldResult = { soldPrice: number | null; soldChannel: SoldChannel | null; channels: { channel: string; outcome: "ended" | "failed" | "manual" | "skipped"; detail?: string }[] }`
  - `markSoldAndTakedown(itemId: number, soldPrice: number | null, soldChannel: SoldChannel | null): Promise<SoldResult>`

- [ ] **Step 1: Write the fan-out action**

In `src/lib/automation-actions.ts`, add to the android import block:

```ts
  markSoldOfferup, markSoldFacebook,
```

Add near the other imports:

```ts
import { markSoldCore, endListingCore } from "@/lib/task-actions";
import { listings as listingsTable } from "@/db/schema";
import type { SoldChannel } from "@/db/schema";
import { eq } from "drizzle-orm";
```

(If any of these are already imported in the file, merge rather than duplicate.)

Then append:

```ts
export type SoldResult = {
  soldPrice: number | null;
  soldChannel: SoldChannel | null;
  channels: { channel: string; outcome: "ended" | "failed" | "manual" | "skipped"; detail?: string }[];
};

// One-click sale reconciliation. Records the sale, then takes the item down on
// every ACTIVE channel: OfferUp + Facebook via the emulator, Craigslist left for
// manual takedown. Any row still active afterward (Craigslist, or a failed
// emulator takedown) surfaces as a computed manual_takedown task — this action
// writes no task itself. The sale is recorded even if every takedown fails.
export async function markSoldAndTakedown(
  itemId: number,
  soldPrice: number | null,
  soldChannel: SoldChannel | null
): Promise<SoldResult> {
  const item = await getItem(itemId);
  if (!item) {
    return { soldPrice, soldChannel, channels: [{ channel: "item", outcome: "failed", detail: "Item not found" }] };
  }
  const { photos, listings: itemListings, prices: _p, ...itemRow } = item;

  // 1. Record the sale first — independent of any takedown.
  await markSoldCore(db, itemId, soldPrice, soldChannel, new Date());

  const active = itemListings.filter((l) => l.status === "active");
  const channels: SoldResult["channels"] = [];

  // 2. Per-channel takedown. Emulator channels share the android lock; take it
  // once for the whole pass so OfferUp and Facebook don't contend.
  const hasEmulatorChannel = active.some((l) => l.publisher === "offerup" || l.publisher === "facebook");
  let androidLocked = false;
  if (hasEmulatorChannel) androidLocked = acquireAndroidLock();

  try {
    for (const l of active) {
      if (l.publisher === "craigslist") {
        channels.push({ channel: "craigslist", outcome: "manual", detail: "Delete the post yourself" });
        continue;
      }
      if (l.publisher === "offerup" || l.publisher === "facebook") {
        const enabled = l.publisher === "offerup" ? OFFERUP_AUTOMATION_ENABLED : FACEBOOK_AUTOMATION_ENABLED;
        if (!enabled) {
          channels.push({ channel: l.publisher, outcome: "failed", detail: "automation disabled" });
          continue;
        }
        if (!androidLocked) {
          channels.push({ channel: l.publisher, outcome: "failed", detail: "another automation is running" });
          continue;
        }
        let result: AndroidResult;
        try {
          result = l.publisher === "offerup"
            ? await markSoldOfferup({ item: itemRow, listing: getPublisher("offerup")!.generate(itemRow, photos), photoPaths: [] })
            : await markSoldFacebook({ item: itemRow, listing: getPublisher("facebook")!.generate(itemRow, photos), photoPaths: [] });
        } catch (err) {
          result = { status: "failed", step: "unknown", reason: err instanceof Error ? err.message : "Unknown error" };
        }
        if (result.status === "done") {
          await endListingCore(db, l.id, new Date());
          channels.push({ channel: l.publisher, outcome: "ended" });
        } else {
          const detail = result.status === "failed" ? `${result.step}: ${result.reason}` : result.status;
          channels.push({ channel: l.publisher, outcome: "failed", detail });
        }
        continue;
      }
      // Any other channel (reddit/watchuseek) has no takedown automation.
      channels.push({ channel: l.publisher, outcome: "manual", detail: "take down manually" });
    }
  } finally {
    if (androidLocked) releaseAndroidLock();
  }

  revalidatePath("/");
  revalidatePath(`/items/${itemId}`);
  return { soldPrice, soldChannel, channels };
}
```

Note: `listingsTable` / `eq` imports are only needed if you query listings directly; the item already carries `listings`, so drop the unused imports if lint flags them.

- [ ] **Step 2: Verify the action compiles**

Run: `npm run lint`
Expected: PASS. Fix any unused-import warnings by removing the unused symbols.

- [ ] **Step 3: Commit the action**

```bash
git add src/lib/automation-actions.ts
git commit -m "feat: markSoldAndTakedown fan-out action + SoldResult"
```

- [ ] **Step 4: Build the client component**

Create `src/components/MarkSoldForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { SOLD_CHANNELS, type SoldChannel } from "@/db/schema";
import { markSoldAndTakedown, type SoldResult } from "@/lib/automation-actions";

const CHANNEL_LABELS: Record<SoldChannel, string> = {
  offerup: "OfferUp",
  facebook: "Facebook",
  craigslist: "Craigslist",
  other: "Other",
};

const OUTCOME_ICON: Record<SoldResult["channels"][number]["outcome"], string> = {
  ended: "✓",
  failed: "⚠️",
  manual: "○",
  skipped: "–",
};

export function MarkSoldForm({
  itemId,
  defaultPrice,
  activePublishers,
}: {
  itemId: number;
  defaultPrice: number | null;
  activePublishers: string[]; // active listing channels, for the confirm summary
}) {
  const [price, setPrice] = useState(defaultPrice != null ? String(defaultPrice) : "");
  const [channel, setChannel] = useState<SoldChannel>("facebook");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<SoldResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const auto = activePublishers.filter((p) => p === "offerup" || p === "facebook");
  const manual = activePublishers.filter((p) => p === "craigslist");
  const summary =
    (auto.length ? `Takes down ${auto.map((p) => CHANNEL_LABELS[p as SoldChannel]).join(" + ")} on the emulator. ` : "") +
    (manual.length ? "Flags Craigslist for manual delete." : "");

  function run() {
    startTransition(async () => {
      setResult(null);
      const parsed = price.trim() === "" ? null : Number(price);
      const res = await markSoldAndTakedown(itemId, Number.isFinite(parsed ?? NaN) ? parsed : null, channel);
      setResult(res);
      setConfirming(false);
    });
  }

  if (result) {
    return (
      <div className="space-y-1 text-sm">
        <div className="font-medium">
          Sold at {result.soldPrice != null ? `$${result.soldPrice}` : "—"}
          {result.soldChannel ? ` on ${CHANNEL_LABELS[result.soldChannel]}` : ""}
        </div>
        {result.channels.length === 0 && <div className="text-zinc-500">No live listings to take down.</div>}
        {result.channels.map((c) => (
          <div key={c.channel} className={c.outcome === "failed" ? "text-red-600" : "text-zinc-600 dark:text-zinc-400"}>
            {OUTCOME_ICON[c.outcome]} {CHANNEL_LABELS[c.channel as SoldChannel] ?? c.channel} — {c.outcome}
            {c.detail ? ` (${c.detail})` : ""}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="soldPrice" className="mb-1 block text-xs text-zinc-500">Sold price ($)</label>
        <input
          id="soldPrice" type="number" step="0.01" min="0" value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={defaultPrice?.toString() ?? ""}
          className="w-28 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      <div>
        <label htmlFor="soldChannel" className="mb-1 block text-xs text-zinc-500">Sold on</label>
        <select
          id="soldChannel" value={channel}
          onChange={(e) => setChannel(e.target.value as SoldChannel)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {SOLD_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
        </select>
      </div>
      {confirming ? (
        <div className="flex items-end gap-2">
          <button
            type="button" disabled={isPending} onClick={run}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {isPending ? "Working…" : "Confirm sold"}
          </button>
          <button
            type="button" disabled={isPending} onClick={() => setConfirming(false)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          {summary && <span className="max-w-xs text-xs text-zinc-500">{summary}</span>}
        </div>
      ) : (
        <button
          type="button" onClick={() => setConfirming(true)}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700"
        >
          Mark sold
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire it into the item page**

In `src/app/items/[id]/page.tsx`:
- Add `import { MarkSoldForm } from "@/components/MarkSoldForm";` at the top.
- Delete the `soldAction` server function (lines defining `async function soldAction`) — it's replaced.
- Replace the `{item.status !== "sold" && ( <form action={soldAction} ...>...</form> )}` block with:

```tsx
        {item.status !== "sold" && (
          <MarkSoldForm
            itemId={item.id}
            defaultPrice={item.askingPrice}
            activePublishers={item.listings.filter((l) => l.status === "active").map((l) => l.publisher)}
          />
        )}
```

(Confirm `item.listings` is available on the `getItem` result — it is; the page already destructures listings elsewhere via `item`. If the property is named differently, use that name.)

- [ ] **Step 6: Verify build, lint, tests**

Run: `npm run lint && npm test`
Expected: PASS. `markSold` (the old action in `actions.ts`) may now be unused — if lint flags it, leave it (still exported for API stability) or remove its import from the page; do not delete the action itself in this task.

- [ ] **Step 7: Commit**

```bash
git add src/components/MarkSoldForm.tsx "src/app/items/[id]/page.tsx"
git commit -m "feat: Mark-sold fan-out UI (channel picker, confirm, per-channel result)"
```

---

### Task 8: Live verification (Wil-driven)

**Files:** none (manual acceptance).

- [ ] **Step 1: OfferUp** — already proven live 2026-07-31 (desk marked sold). On the next real sale, click Mark sold with `Sold on = Facebook`, confirm the emulator drives OfferUp to Sold and the result row shows `✓ OfferUp — ended`.
- [ ] **Step 2: Facebook** — the FIRST verification of `markSoldFacebook`. Against a live FB listing, confirm the management sheet's "Mark as sold" tap lands and the row ends. If the selector/label differs, update `facebookSelectors.markSold` (one-line edit) and re-run. Until this passes, treat FB takedown as best-effort.
- [ ] **Step 3: Craigslist** — confirm a `📕 Take down on Craigslist` task appears in Today's Tasks for the sold item, the deep link opens the post, and "✓ Marked done" ends the row and clears the task.

---

## Self-Review

**Spec coverage:**
- `sold_channel` column + enum → Task 1. ✓
- `markSoldAndTakedown` action + `markSoldCore` → Tasks 2, 7. ✓
- OfferUp/Facebook takedown flows → Tasks 5, 6. ✓
- Computed `manual_takedown` (Craigslist by design + failed emulator rows) → Task 3. ✓
- `completeTakedown` + TaskSection render → Task 4. ✓
- UI: channel picker + confirm + per-channel result → Task 7. ✓
- Error handling: sale recorded first, per-channel independence, offline → failed → Task 7 action logic + Task 3 task. ✓
- Testing: cores (Task 2), computeTasks (Task 3), live (Task 8). ✓
- "Sold elsewhere" always on OfferUp → Task 5 flow. ✓
- FB unverified flag → Task 6 comment + Task 8. ✓

**Placeholder scan:** No TBD/TODO; every code step carries real code.

**Type consistency:** `SoldChannel` / `SOLD_CHANNELS` (Task 1) used in Tasks 2, 7. `SoldResult` defined in Task 7, consumed by `MarkSoldForm`. `AndroidResult` `{status:"done"|"failed",...}` handled in Task 7 matches `types.ts`. `markSoldOfferup` / `markSoldFacebook` signatures (`FlowContext → AndroidResult`) match Tasks 5/6 and the Task 7 call sites. `endListingCore(db, listingId, now)` consistent across Tasks 2, 4, 7.
