ALTER TABLE `items` ADD `drop_amount` real;--> statement-breakpoint
ALTER TABLE `items` ADD `drop_percent` real;--> statement-breakpoint
ALTER TABLE `items` ADD `drop_interval_days` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `snoozed_until` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `renewed_at` text;