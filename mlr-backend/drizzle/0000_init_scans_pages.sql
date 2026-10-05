CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`crawl_index` integer NOT NULL,
	`url` text NOT NULL,
	`depth` integer NOT NULL,
	`parent_page_id` text,
	`title` text,
	`text` text,
	`links` text DEFAULT '[]' NOT NULL,
	`http_status` integer,
	`desktop_screenshot_path` text,
	`mobile_screenshot_path` text,
	`error` text,
	`crawled_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_scan_url_idx` ON `pages` (`scan_id`,`url`);--> statement-breakpoint
CREATE INDEX `pages_scan_crawl_index_idx` ON `pages` (`scan_id`,`crawl_index`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`start_url` text NOT NULL,
	`max_pages` integer NOT NULL,
	`max_depth` integer NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`pages_crawled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
