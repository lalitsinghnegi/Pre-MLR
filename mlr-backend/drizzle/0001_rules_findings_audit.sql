CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`scan_id` text,
	`action` text NOT NULL,
	`changes` text NOT NULL,
	`actor` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_scan_idx` ON `audit_log` (`scan_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`page_id` text,
	`rule_id` text NOT NULL,
	`rule_version` integer NOT NULL,
	`detected_by` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`evidence_text` text,
	`evidence_location` text,
	`evidence_crop_path` text,
	`suggested_fix` text,
	`edited_fix` text,
	`confidence` real,
	`status` text NOT NULL,
	`author_comment` text,
	`revision` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`,`rule_version`) REFERENCES `rule_versions`(`rule_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_scan_fingerprint_idx` ON `findings` (`scan_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `findings_scan_status_idx` ON `findings` (`scan_id`,`status`);--> statement-breakpoint
CREATE INDEX `findings_page_idx` ON `findings` (`page_id`);--> statement-breakpoint
CREATE TABLE `rule_versions` (
	`rule_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`check_type` text NOT NULL,
	`source_citation` text NOT NULL,
	`source_url` text,
	`last_verified` text,
	`prompt_template` text,
	`params` text DEFAULT '{}' NOT NULL,
	`enabled_by_default` integer NOT NULL,
	`origin` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL,
	PRIMARY KEY(`rule_id`, `version`),
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`retired_at` text
);
--> statement-breakpoint
CREATE TABLE `scan_rules` (
	`scan_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_version` integer NOT NULL,
	`enabled` integer NOT NULL,
	PRIMARY KEY(`scan_id`, `rule_id`),
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`,`rule_version`) REFERENCES `rule_versions`(`rule_id`,`version`) ON UPDATE no action ON DELETE no action
);
