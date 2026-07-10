CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`condition` text DEFAULT 'good' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`purchase_price` real,
	`asking_price` real,
	`minimum_price` real,
	`sold_price` real,
	`notes` text DEFAULT '' NOT NULL,
	`attributes` text DEFAULT '{}' NOT NULL,
	`acquired_at` text,
	`sold_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`publisher` text NOT NULL,
	`url` text,
	`listed_price` real,
	`status` text DEFAULT 'active' NOT NULL,
	`listed_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`path` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`asking_price` real NOT NULL,
	`changed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
