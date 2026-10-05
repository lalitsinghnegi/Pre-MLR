CREATE TABLE `llm_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`page_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`served_model` text,
	`prompt_version` text NOT NULL,
	`status` text NOT NULL,
	`cached` integer NOT NULL,
	`attempts` integer NOT NULL,
	`page_tip` text,
	`output` text,
	`problems` text DEFAULT '[]' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `llm_analyses_cache_idx` ON `llm_analyses` (`cache_key`,`status`);--> statement-breakpoint
CREATE INDEX `llm_analyses_page_idx` ON `llm_analyses` (`page_id`);--> statement-breakpoint
ALTER TABLE `scans` ADD `phase` text;