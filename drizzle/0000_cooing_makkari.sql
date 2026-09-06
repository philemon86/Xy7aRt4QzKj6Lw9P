CREATE TABLE `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`actor` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `churches` (
	`code` text PRIMARY KEY NOT NULL,
	`password` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `closings` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`day` text NOT NULL,
	`snapshot` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tenant` text NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`pricing` text DEFAULT 'website' NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated` text NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`n` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`tenant` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shop` (
	`code` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER audit_event_update AFTER UPDATE OF state ON events BEGIN
  INSERT INTO audit(event,revision,state,actor,created) VALUES(OLD.id,OLD.revision,OLD.state,NEW.actor,NEW.updated);
END;
--> statement-breakpoint
CREATE INDEX events_tenant_idx ON events(tenant,date);
--> statement-breakpoint
CREATE INDEX audit_event_idx ON audit(event,revision);
--> statement-breakpoint
CREATE INDEX closings_event_idx ON closings(event,created);
