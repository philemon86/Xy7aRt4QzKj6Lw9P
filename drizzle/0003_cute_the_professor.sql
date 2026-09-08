CREATE TABLE `pilot_export_parts` (
	`export_id` text NOT NULL,
	`part` integer NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`export_id`, `part`)
);
