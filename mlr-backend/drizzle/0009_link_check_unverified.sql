ALTER TABLE `link_checks` ADD `unverified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `link_checks` ADD `checked_via` text DEFAULT 'http' NOT NULL;