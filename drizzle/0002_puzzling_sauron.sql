CREATE TABLE `pilot_eris` (
	`eri` text PRIMARY KEY NOT NULL,
	`export_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pilot_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`source_hash` text NOT NULL,
	`context` text NOT NULL,
	`snapshot` text NOT NULL,
	`created` text NOT NULL,
	`confirmed` text
);
--> statement-breakpoint
CREATE TABLE `shipment_numbers` (
	`event` text NOT NULL,
	`order_id` text NOT NULL,
	`scope` text NOT NULL,
	`day` text NOT NULL,
	`sequence` integer NOT NULL,
	PRIMARY KEY(`event`, `order_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipment_numbers_scope_day_sequence` ON `shipment_numbers` (`scope`,`day`,`sequence`);--> statement-breakpoint
ALTER TABLE `events` ADD `organizer` text DEFAULT '' NOT NULL;