import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const ITEM_STATUSES = [
  "draft",
  "ready",
  "published",
  "needs_repricing",
  "needs_relisting",
  "sold",
  "archived",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

// needs_repricing / needs_relisting are obsolete as of v1.1 — "needs
// attention" is computed by the task engine, never stored. Kept in the
// enum for DB compatibility; hidden from all pickers.
export const VISIBLE_ITEM_STATUSES = ITEM_STATUSES.filter(
  (s) => s !== "needs_repricing" && s !== "needs_relisting"
);

export const CONDITIONS = [
  "new",
  "like_new",
  "excellent",
  "good",
  "fair",
  "for_parts",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("general"),
  condition: text("condition", { enum: CONDITIONS }).notNull().default("good"),
  status: text("status", { enum: ITEM_STATUSES }).notNull().default("draft"),
  purchasePrice: real("purchase_price"),
  askingPrice: real("asking_price"),
  minimumPrice: real("minimum_price"),
  soldPrice: real("sold_price"),
  notes: text("notes").notNull().default(""),
  // v1.1 repricing cadence — all optional; null = no cadence
  dropAmount: real("drop_amount"),
  dropPercent: real("drop_percent"),
  dropIntervalDays: integer("drop_interval_days"),
  snoozedUntil: text("snoozed_until"),
  // Category-specific fields (watch specs, electronics details, etc.)
  attributes: text("attributes", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  acquiredAt: text("acquired_at"),
  soldAt: text("sold_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const photos = sqliteTable("photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  // Path relative to the photos storage root
  path: text("path").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Where an item is listed. Publisher integrations arrive in Phase 3,
// but tracking listings manually is useful from day one.
export const listings = sqliteTable("listings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  publisher: text("publisher").notNull(), // e.g. "offerup", "facebook", "watchuseek"
  url: text("url"),
  listedPrice: real("listed_price"),
  status: text("status", {
    enum: ["active", "ended", "sold"],
  })
    .notNull()
    .default("active"),
  listedAt: text("listed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  // last renew action on renew-method channels (Facebook/Craigslist)
  renewedAt: text("renewed_at"),
  endedAt: text("ended_at"),
});

export const priceHistory = sqliteTable("price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id")
    .notNull()
    .references(() => items.id, { onDelete: "cascade" }),
  askingPrice: real("asking_price").notNull(),
  changedAt: text("changed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Photo = typeof photos.$inferSelect;
export type Listing = typeof listings.$inferSelect;
