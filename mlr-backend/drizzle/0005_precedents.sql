CREATE TABLE `precedent_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`mapping` text NOT NULL,
	`site` text,
	`rows_total` integer NOT NULL,
	`rows_imported` integer NOT NULL,
	`rows_skipped` integer NOT NULL,
	`rows_duplicate` integer NOT NULL,
	`row_errors` text NOT NULL,
	`imported_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `precedents` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`source_comment_id` text,
	`site` text,
	`brand` text NOT NULL,
	`country` text,
	`proof_name` text,
	`proof_version` text,
	`page_ref` text,
	`comment_text` text NOT NULL,
	`reviewer_pseudonym` text,
	`reviewer_function` text,
	`status` text,
	`commented_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`import_id`) REFERENCES `precedent_imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `precedents_fingerprint_idx` ON `precedents` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `precedents_brand_date_idx` ON `precedents` (`brand`,`commented_at`);--> statement-breakpoint
CREATE INDEX `precedents_site_idx` ON `precedents` (`site`);