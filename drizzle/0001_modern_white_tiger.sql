CREATE TABLE `order_numbers` (
	`event` text NOT NULL,
	`order_id` text NOT NULL,
	`scope` text NOT NULL,
	`day` text NOT NULL,
	`sequence` integer NOT NULL,
	PRIMARY KEY(`event`, `order_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_order_numbers_scope_day_sequence` ON `order_numbers` (`scope`,`day`,`sequence`);