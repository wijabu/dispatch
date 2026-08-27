# r/WatchExchange Sourcing & Sales-History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Wil's r/WatchExchange `[WTS]` posts in his exact house format from a Dispatch watch item, add the watch fields and sold-channels the format needs, and seed his 8 past sales as tracked records.

**Architecture:** The template is a pure function — rewrite the existing `reddit-watchexchange` publisher to emit Wil's title-only post + first-comment format. Supporting changes: extend the `SOLD_CHANNELS` type-enum and the watch attribute chips. The one-time history seed is a data operation, not a code feature. The AI research (Phase 0 corpus, Phase 1 buy-side sourcing) is a documented playbook in the spec, not code.

**Tech Stack:** Next.js 16, Drizzle ORM + better-sqlite3, vitest, TypeScript.

## Global Constraints

- Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (per AGENTS.md — breaking changes vs. training data). This plan touches no Next.js runtime APIs (pure publisher + config + a SQL seed).
- `SOLD_CHANNELS` is a compile-time drizzle enum over a plain `text` column — adding values needs **no migration**, only the TS array + every `Record<SoldChannel, …>` map updated.
- The publisher is a pure function `generate(item, photos) → { title, body, warnings }`; `title` is the title-only post, `body` is Wil's first comment. No DB access, no side effects.
- Payment line is exactly: `PayPal F&F or G&S Invoice (+4% paid by buyer)`.
- Title pattern: `[WTS] <name>[ - <Variant>] - <Kit>` (Kit defaults to "Full Kit").
- Comment sections are separated by blank lines; the labeled block (specs → Condition → Price/Shipping → Includes → Payment) is single-newline-joined.
- Tests: `npm test` runs `vitest run`. Branch: `watchexchange-sourcing`.

---

### Task 1: Extend `SOLD_CHANNELS` for the watch channels

**Files:**
- Modify: `src/db/schema.ts` (`SOLD_CHANNELS` array)
- Modify: `src/components/MarkSoldForm.tsx` (`CHANNEL_LABELS` map)
- Test: `src/db/__tests__/sold-channels.test.ts` (create)

**Interfaces:**
- Produces: `SOLD_CHANNELS` gains `"reddit-watchexchange"` and `"watchuseek"`; `SoldChannel` type widens accordingly.

- [ ] **Step 1: Find every exhaustive use of `SoldChannel`**

Run: `grep -rn "SoldChannel\|SOLD_CHANNELS" src/`
Expected: `schema.ts` (definition), `task-actions.ts` / `automation-actions.ts` (param types — these widen automatically, no edit), and `MarkSoldForm.tsx` (`CHANNEL_LABELS: Record<SoldChannel, string>` — this MUST gain the new keys or `tsc` fails). Note any other `Record<SoldChannel` or `switch` you find; they must be updated too.

- [ ] **Step 2: Write the failing test**

Create `src/db/__tests__/sold-channels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SOLD_CHANNELS } from "../schema";

describe("SOLD_CHANNELS", () => {
  it("includes the shipped watch channels", () => {
    expect(SOLD_CHANNELS).toContain("reddit-watchexchange");
    expect(SOLD_CHANNELS).toContain("watchuseek");
  });
  it("keeps the original local channels", () => {
    expect(SOLD_CHANNELS).toEqual(
      expect.arrayContaining(["offerup", "facebook", "craigslist", "other"])
    );
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test -- sold-channels`
Expected: FAIL — `expected [ 'offerup', … ] to contain 'reddit-watchexchange'`.

- [ ] **Step 4: Add the channels**

In `src/db/schema.ts`, change the `SOLD_CHANNELS` array to:

```ts
export const SOLD_CHANNELS = [
  "offerup",
  "facebook",
  "craigslist",
  "reddit-watchexchange",
  "watchuseek",
  "other",
] as const;
```

- [ ] **Step 5: Update the `CHANNEL_LABELS` map**

In `src/components/MarkSoldForm.tsx`, extend the map so it stays exhaustive:

```tsx
const CHANNEL_LABELS: Record<SoldChannel, string> = {
  offerup: "OfferUp",
  facebook: "Facebook",
  craigslist: "Craigslist",
  "reddit-watchexchange": "Reddit r/Watchexchange",
  watchuseek: "Watchuseek",
  other: "Other",
};
```

Apply the same additive fix to any other `Record<SoldChannel>` / exhaustive `switch` that Step 1 surfaced.

- [ ] **Step 6: Verify tests + types**

Run: `npm test -- sold-channels && npx tsc --noEmit`
Expected: PASS, and `tsc` clean (0 errors — proves no `Record<SoldChannel>` was left non-exhaustive).

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/components/MarkSoldForm.tsx src/db/__tests__/sold-channels.test.ts
git commit -m "feat: add reddit-watchexchange + watchuseek to SOLD_CHANNELS"
```

---

### Task 2: Watch attribute suggestion chips

**Files:**
- Modify: `src/config/categories.ts` (`watches` list)
- Test: `src/config/__tests__/categories.test.ts` (create)

**Interfaces:**
- Produces: `CATEGORY_SUGGESTIONS.watches` gains Variant, Thickness, Lug Width, Lug-to-Lug, Water Resistance, Condition Rating, Kit Contents. These are the exact attribute keys the Task 3 publisher reads (`Diameter`, `Lug Width`, `Thickness`, `Lug-to-Lug`, `Water Resistance`, `Variant`, `Condition Rating`, `Kit Contents`, `Kit`).

- [ ] **Step 1: Write the failing test**

Create `src/config/__tests__/categories.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATEGORY_SUGGESTIONS } from "../categories";

describe("watch attribute chips", () => {
  it("offers the r/WatchExchange spec-block fields", () => {
    const w = CATEGORY_SUGGESTIONS.watches;
    for (const f of ["Variant", "Thickness", "Lug Width", "Lug-to-Lug", "Water Resistance", "Condition Rating", "Kit Contents"]) {
      expect(w).toContain(f);
    }
  });
  it("keeps the original watch chips", () => {
    expect(CATEGORY_SUGGESTIONS.watches).toEqual(
      expect.arrayContaining(["Brand", "Model", "Reference", "Diameter", "Movement", "Year"])
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- categories`
Expected: FAIL — `expected [ 'Brand', … ] to contain 'Variant'`.

- [ ] **Step 3: Extend the watches list**

In `src/config/categories.ts`, replace the `watches` line with:

```ts
  watches: ["Brand", "Model", "Reference", "Variant", "Movement", "Diameter", "Thickness", "Lug Width", "Lug-to-Lug", "Water Resistance", "Condition Rating", "Box/Papers", "Kit Contents", "Accessories", "Year"],
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test -- categories`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/categories.ts src/config/__tests__/categories.test.ts
git commit -m "feat: watch attribute chips for r/WatchExchange spec block"
```

---

### Task 3: Rewrite the `reddit-watchexchange` publisher to Wil's format

**Files:**
- Modify: `src/publishers/reddit-watchexchange.ts` (full rewrite of `generate`)
- Modify: `src/publishers/__tests__/reddit-watchexchange.test.ts` (rewrite expectations)

**Interfaces:**
- Consumes: `formatDescription`, `formatUsd`, `commonWarnings` from `./helpers`; `item.attributes` keys from Task 2.
- Produces: unchanged `Publisher` shape; `generate` now returns `title` = title-only post, `body` = first comment in Wil's format.

- [ ] **Step 1: Rewrite the tests first (they encode the format)**

Replace the entire body of `src/publishers/__tests__/reddit-watchexchange.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { redditWatchexchange } from "../reddit-watchexchange";
import { makeItem, makePhotos, deskOverrides } from "./fixtures";

const watch = () => makeItem({
  name: "Citizen Promaster Land AT6080-53L",
  description: "Navy Promaster on Super Titanium. Radio-controlled.",
  askingPrice: 250,
  attributes: {
    Variant: "Blue Dial",
    Diameter: "39mm",
    Thickness: "11.4mm",
    "Lug Width": "22mm",
    "Water Resistance": "200m",
    "Condition Rating": "8.5/10",
    "Kit Contents": "Original box, papers, extra strap",
  },
});

describe("redditWatchexchange.generate", () => {
  it("title is title-only in Wil's pattern: [WTS] name - Variant - Full Kit", () => {
    expect(redditWatchexchange.generate(watch(), makePhotos(3)).title)
      .toBe("[WTS] Citizen Promaster Land AT6080-53L - Blue Dial - Full Kit");
  });

  it("opens the comment with the 'For your consideration' line and the imgur placeholders", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(3));
    expect(body).toContain("For your consideration today is the Citizen Promaster Land AT6080-53L - Full Kit");
    expect(body).toContain("[Photos](PHOTOS_ALBUM_URL) | [Timestamp](TIMESTAMP_ALBUM_URL)");
  });

  it("renders the labeled spec block with Wil's labels (Diameter->Case size, Lug Width->Lugs)", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(3));
    expect(body).toContain("Case size: 39mm");
    expect(body).toContain("Thickness: 11.4mm");
    expect(body).toContain("Lugs: 22mm");
    expect(body).toContain("Water Resistance: 200m");
    expect(body).toContain("Condition: 8.5/10");
    expect(body).toContain("Price/Shipping: $250 USD Shipped to CONUS by USPS.");
    expect(body).toContain("Includes Full Kit: Original box, papers, extra strap");
    expect(body).toContain("Payment Method: PayPal F&F or G&S Invoice (+4% paid by buyer)");
  });

  it("ends with Wil's fixed closer after the payment line", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(3));
    expect(body.endsWith("Not looking for any trades\n\nCheers")).toBe(true);
  });

  it("does NOT emit spec lines for attributes that have no value", () => {
    const { body } = redditWatchexchange.generate(makeItem({ name: "Seiko SRPD", attributes: { Diameter: "42mm" } }), makePhotos(1));
    expect(body).toContain("Case size: 42mm");
    expect(body).not.toContain("Thickness:");
    expect(body).not.toContain("Lugs:");
  });

  it("omits the price line and warns when there is no asking price", () => {
    const noPrice = makeItem({ name: "Orient", askingPrice: null, attributes: {} });
    const { body, warnings } = redditWatchexchange.generate(noPrice, makePhotos(1));
    expect(body).not.toContain("Price/Shipping:");
    expect(warnings).toContain("No asking price set");
  });

  it("honors a non-default Kit override in title and comment", () => {
    const headOnly = makeItem({ name: "Tudor BB58", attributes: { Kit: "Head Only" } });
    const { title, body } = redditWatchexchange.generate(headOnly, makePhotos(1));
    expect(title).toBe("[WTS] Tudor BB58 - Head Only");
    expect(body).toContain("Includes Head Only:");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- reddit-watchexchange`
Expected: FAIL — old format (`[WTS] … | $ | Full Set`, `Price: … shipped CONUS`) doesn't match the new assertions.

- [ ] **Step 3: Rewrite the publisher**

Replace the entire contents of `src/publishers/reddit-watchexchange.ts` with:

```ts
import type { Publisher } from "./types";
import { commonWarnings, formatDescription, formatUsd } from "./helpers";

const PAYMENT_METHOD = "PayPal F&F or G&S Invoice (+4% paid by buyer)";

// Wil's r/WatchExchange spec block, in his order. Maps an item.attributes key to
// the label he uses in the post; only fields with a value are emitted.
const SPEC_FIELDS: ReadonlyArray<readonly [key: string, label: string]> = [
  ["Diameter", "Case size"],
  ["Thickness", "Thickness"],
  ["Lug Width", "Lugs"],
  ["Lug-to-Lug", "Lug-to-Lug"],
  ["Water Resistance", "Water Resistance"],
];

// Emits Wil's house format (learned from his 11-post corpus, 2026-08-27):
// a title-only post + a first comment he pastes. Photos/timestamp are imgur
// albums he adds at post time, so they render as placeholders here.
export const redditWatchexchange: Publisher = {
  id: "reddit-watchexchange",
  name: "Reddit r/Watchexchange",
  relistPolicy: { method: "repost", intervalDays: 7, minIntervalDays: 7 },
  generate(item, photos) {
    const a = item.attributes;
    const kit = a["Kit"] ?? "Full Kit";
    const variant = a["Variant"];

    const title = `[WTS] ${item.name}${variant ? ` - ${variant}` : ""} - ${kit}`;

    const price = formatUsd(item.askingPrice);
    // Single-newline labeled block: specs, then condition/price/includes/payment.
    const block = [
      ...SPEC_FIELDS.filter(([k]) => a[k]).map(([k, label]) => `${label}: ${a[k]}`),
      a["Condition Rating"] ? `Condition: ${a["Condition Rating"]}` : "",
      price ? `Price/Shipping: ${price} USD Shipped to CONUS by USPS.` : "",
      `Includes ${kit}: ${a["Kit Contents"] ?? "Original box and papers"}`,
      `Payment Method: ${PAYMENT_METHOD}`,
    ].filter(Boolean).join("\n");

    // Blank-line-separated sections: intro, photos, prose, labeled block, then
    // Wil's fixed closer (no-trades + sign-off).
    const body = [
      `For your consideration today is the ${item.name} - ${kit}`,
      `[Photos](PHOTOS_ALBUM_URL) | [Timestamp](TIMESTAMP_ALBUM_URL)`,
      formatDescription(item.description),
      block,
      "Not looking for any trades",
      "Cheers",
    ].filter(Boolean).join("\n\n");

    return { title, body, warnings: commonWarnings(item, photos) };
  },
};
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npm test -- reddit-watchexchange`
Expected: PASS (all 6).

- [ ] **Step 5: Full suite + types**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, tsc clean. (If another test imported the old `redditWatchexchange` output shape, update it — none is expected.)

- [ ] **Step 6: Commit**

```bash
git add src/publishers/reddit-watchexchange.ts src/publishers/__tests__/reddit-watchexchange.test.ts
git commit -m "feat: reddit-watchexchange publisher emits Wil's [WTS] format"
```

---

### Task 4: One-time history seed (data operation, not TDD)

**Files:**
- Create: `scripts/seed-watchexchange-history.sql`

**Interfaces:** none (writes rows). Depends on Task 1 (channel value) being merged for type consistency, though SQLite stores the string regardless.

This seeds Wil's 8 sold watches as tracked records (name + asking price + sold status + `reddit-watchexchange` listing linking to the post). It is a one-time data load, so it is verified by query, not by a unit test. Sold prices are DM-private → left null ("not measured"). The Brew Retrograph asking price must be re-pulled exactly before running (spec ledger flags it); use its confirmed value in the SQL.

- [ ] **Step 1: Write the seed SQL**

Create `scripts/seed-watchexchange-history.sql` (fill the Brew price once confirmed; `sold_at`/`listed_at` use the post dates from the spec ledger):

```sql
-- One-time seed: Wil's past r/WatchExchange sales as tracked sold items.
-- Asking prices; sold_price left NULL (negotiated in DMs = not measured).
INSERT INTO items (name, category, condition, status, asking_price, sold_channel, sold_at, created_at, updated_at) VALUES
 ('Sinn 556i RS', 'watches', 'excellent', 'sold', 1199, 'reddit-watchexchange', '2023-02-14 12:00:00', '2023-02-14 12:00:00', '2023-02-14 12:00:00'),
 ('Orient Commuter', 'watches', 'excellent', 'sold', 155, 'reddit-watchexchange', '2022-03-19 12:00:00', '2022-03-19 12:00:00', '2022-03-19 12:00:00'),
 ('Orient Mako II Pepsi', 'watches', 'excellent', 'sold', 115, 'reddit-watchexchange', '2022-03-19 12:00:00', '2022-03-19 12:00:00', '2022-03-19 12:00:00'),
 ('Oris Big Crown Pointer Date Oxblood', 'watches', 'excellent', 'sold', 1100, 'reddit-watchexchange', '2021-11-20 12:00:00', '2021-11-20 12:00:00', '2021-11-20 12:00:00'),
 ('Brew Retrograph Technicolor', 'watches', 'excellent', 'sold', 350, 'reddit-watchexchange', '2021-11-11 12:00:00', '2021-11-11 12:00:00', '2021-11-11 12:00:00'),
 ('Seiko Prospex SRPD35K1', 'watches', 'like_new', 'sold', 335, 'reddit-watchexchange', '2021-08-13 12:00:00', '2021-08-13 12:00:00', '2021-08-13 12:00:00'),
 ('Glycine Combat Sub Phantom GL0083', 'watches', 'excellent', 'sold', 275, 'reddit-watchexchange', '2021-01-04 12:00:00', '2021-01-04 12:00:00', '2021-01-04 12:00:00'),
 ('Glycine Combat Sub Black GL0261', 'watches', 'excellent', 'sold', 395, 'reddit-watchexchange', '2020-12-18 12:00:00', '2020-12-18 12:00:00', '2020-12-18 12:00:00');

INSERT INTO listings (item_id, publisher, url, listed_price, status, listed_at, ended_at)
SELECT i.id, 'reddit-watchexchange', u.url, i.asking_price, 'ended', i.sold_at, i.sold_at
FROM items i
JOIN (VALUES
 ('Sinn 556i RS','https://www.reddit.com/r/Watchexchange/comments/112hkhn/'),
 ('Orient Commuter','https://www.reddit.com/r/Watchexchange/comments/ti1del/'),
 ('Orient Mako II Pepsi','https://www.reddit.com/r/Watchexchange/comments/ti1aj9/'),
 ('Oris Big Crown Pointer Date Oxblood','https://www.reddit.com/r/Watchexchange/comments/qy5506/'),
 ('Brew Retrograph Technicolor','https://www.reddit.com/r/Watchexchange/comments/qrkdj0/'),
 ('Seiko Prospex SRPD35K1','https://www.reddit.com/r/Watchexchange/comments/p3cq0w/'),
 ('Glycine Combat Sub Phantom GL0083','https://www.reddit.com/r/Watchexchange/comments/kqa9dh/'),
 ('Glycine Combat Sub Black GL0261','https://www.reddit.com/r/Watchexchange/comments/kfmtuj/')
) AS u(name, url) ON u.name = i.name
WHERE i.sold_channel = 'reddit-watchexchange';
```

- [ ] **Step 2: Apply the seed**

Run: `sqlite3 data/dispatch.db < scripts/seed-watchexchange-history.sql`
Expected: no output (success).

- [ ] **Step 3: Verify the rows**

Run: `sqlite3 -header -column data/dispatch.db "SELECT i.name, i.status, i.asking_price, i.sold_channel, l.url FROM items i JOIN listings l ON l.item_id=i.id WHERE i.sold_channel='reddit-watchexchange' ORDER BY i.sold_at DESC;"`
Expected: 8 rows, each `sold`, `reddit-watchexchange`, with its Reddit URL.

- [ ] **Step 4: Commit the seed script**

```bash
git add scripts/seed-watchexchange-history.sql
git commit -m "chore: one-time seed of past r/WatchExchange sales"
```

---

## Self-Review

**Spec coverage:**
- `SOLD_CHANNELS` + reddit-watchexchange/watchuseek → Task 1 (no migration — type-enum). ✓
- Watch attribute chips aligned to the spec block → Task 2. ✓
- Publisher emits Wil's title-only post + first-comment format (title pattern, opening line, imgur placeholders, `Diameter→Case size`/`Lug Width→Lugs` mapping, Condition X/10, Price/Shipping, Includes, PayPal payment line) → Task 3. ✓
- Sales-history tracking as items + reddit-watchexchange listing rows → Task 4. ✓
- Script/AI split: the research (Phase 0 done, Phase 1 buy-side proven) is playbook in the spec, no code — correctly absent from this plan. ✓
- Honesty (sold prices "not measured") → Task 4 leaves `sold_price` null. ✓

**Placeholder scan:** The only fill-in is the Brew asking price in Task 4's SQL, explicitly flagged in the spec ledger and the task as "confirm before running" — a data value, not a code placeholder. No TODO/TBD in code.

**Type consistency:** `SoldChannel` widening (Task 1) is consumed only by `Record<SoldChannel>` maps (Task 1 updates them; tsc gate in Step 6 proves exhaustiveness). Publisher attribute keys in Task 3 (`Diameter`, `Lug Width`, `Thickness`, `Lug-to-Lug`, `Water Resistance`, `Variant`, `Condition Rating`, `Kit Contents`, `Kit`) match the chips added in Task 2. `generate` signature unchanged, so `getPublisher("reddit-watchexchange")` callers are unaffected.
