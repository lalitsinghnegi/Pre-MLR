CREATE TABLE `link_checks` (
	`scan_id` text NOT NULL,
	`url` text NOT NULL,
	`ok` integer NOT NULL,
	`http_status` integer,
	`error` text,
	`final_url` text,
	`content_type` text,
	`checked_at` text NOT NULL,
	PRIMARY KEY(`scan_id`, `url`),
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `facts` text;--> statement-breakpoint
ALTER TABLE `rule_versions` ADD `source_note` text;--> statement-breakpoint
ALTER TABLE `scans` ADD `product` text;