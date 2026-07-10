# Dispatch v1 — Design Spec

**Date:** 2026-07-10
**Status:** Approved (brainstorming session with Wil, all sections reviewed)

## What Dispatch is

A personal, local-first inventory and marketplace publishing tool. One source of truth for items being sold; marketplaces are "publishers" that listings get dispatched to. Not a SaaS — single user, SQLite, local photo storage, no cloud.

## The v1 workflow

Enter an item once → generate per-channel listing text → copy/paste into each marketplace → one-click record of where it's listed.

Listing generation is v1's reason to exist: inventory CRUD alone doesn't beat a spreadsheet. Ready-to-paste channel-specific text does.

## Design decisions

### Photo intake
AirDrop photos from phone to Mac, then drag-drop (or file-pick) into the item form. No new infrastructure. Files live on local disk under `data/photos/`; the DB stores relative path + sort order.

### Attributes — everything optional
Items carry a free-form key/value `attributes` JSON column. Selecting a category surfaces **optional tap-to-add suggestion chips** (watches → Brand, Model, Reference, Movement, Diameter, Box/Papers, Accessories, Year; furniture → Dimensions, Material). Chips are UI sugar defined in a config file (`src/config/categories.ts`), not the database.

**The only required field on an item is its name.** A computer desk can be name + price + photos, done.

### Channels (v1 publishers)
- OfferUp
- Facebook Marketplace
- Craigslist
- Reddit r/Watchexchange (`[WTS] Brand Model Ref | $Price | Extras` title format)
- Watchuseek (forum post format with spec block)

Chrono24 structured export is deferred.

### Publisher architecture
One small TypeScript module per channel in `src/publishers/`, implementing:

```ts
interface Publisher {
  id: string;            // "offerup"
  name: string;          // "OfferUp"
  generate(item: Item, photos: Photo[]): GeneratedListing;
}

interface GeneratedListing {
  title: string;
  body: string;
  structuredFields?: Record<string, string>; // for form-based channels later
  warnings: string[];    // "title exceeds 80 chars", "no price set", …
}
```

Publishers are **pure functions of item data** — no DB access, no side effects. Deterministic, unit-testable, git-versioned. In v1.2 this interface gains optional `publish()`/`relist()` methods for Playwright automation; the shape is chosen so that requires no restructuring.

### Listing tracking (the ledger)
Each channel card on an item's Publish tab has a **Mark listed** action recording publisher + listed price + date + optional URL into the `listings` table. Channels already listed show status and a **Mark ended** action instead. The dashboard answers "what's listed where, at what price, since when."

## Data model

Existing scaffold, kept as-is:

- **`items`** — name (required), description, category (free text), condition, status (`draft | ready | published | needs_repricing | needs_relisting | sold | archived`), asking/minimum/purchase/sold prices (all optional), private notes, `attributes` JSON, acquired/sold dates.
- **`photos`** — path on disk, sort order, FK to item (cascade delete).
- **`listings`** — item × publisher: publisher id, URL, listed price, status (`active | ended | sold`), listed/ended dates.
- **`price_history`** — asking price + timestamp, auto-logged whenever asking price changes. Powers the v1.1 repricing engine.

`needs_repricing`/`needs_relisting` statuses exist in the schema but nothing sets them automatically in v1.

## Architecture

```
Web UI (Next.js App Router, server actions)
        ↓
Inventory core (CRUD, queries, listing ledger — Drizzle + better-sqlite3)
        ↓
Publisher modules (src/publishers/*.ts — pure functions)
```

One-way dependencies. Stack: TypeScript, Next.js, SQLite via Drizzle, Tailwind. Photos on local disk.

## Error handling — degrade, never block

| Situation | Behavior |
|---|---|
| Item lacks an attribute a template uses | Template skips it; output still generates |
| Title/photo count violates channel rules | Warning shown on channel card; copy still works |
| No price set | Generation runs, flags the gap |
| Photo file missing on disk | Placeholder shown; item still functions |

## Roadmap — fast follows are commitments

- **v1 (this spec):** inventory + listing generation + copy/paste publishing + listing tracking
- **v1.1:** repricing/relisting engine + daily task dashboard (schema support already present)
- **v1.2:** Playwright human-assisted publishing — prepare listing, open marketplace, pre-fill, pause for human review (publisher interface already reserves the methods)

Unscheduled: AI-generated descriptions, photo optimization, analytics, Chrono24 structured export, OCR, barcode lookup.

## Verification

1. **Unit tests per publisher module.** Fixtures: full-spec watch (all attributes), bare-bones desk (name + price only), edge cases (no price, very long name). Expected exact title/body/warnings for each channel.
2. **Browser acceptance test:** create a real item with photos → Publish tab → copy each channel's text → mark listed → dashboard shows what's listed where. This is the definition of "v1 works."
3. **Environment check:** better-sqlite3 was rebuilt for Node 26 but the dev server restart was never verified — confirm the app boots and reads/writes the DB.

## Existing code

A pre-design scaffold exists and aligns with this spec: schema (`src/db/schema.ts`), CRUD server actions (`src/lib/actions.ts`), queries (`src/lib/queries.ts`), dashboard + item pages (`src/app/`). Implementation builds on it rather than starting over. New surface area: `src/publishers/` + tests, Publish tab UI, mark-listed/ended actions, drag-drop photo input, `src/config/categories.ts`.
