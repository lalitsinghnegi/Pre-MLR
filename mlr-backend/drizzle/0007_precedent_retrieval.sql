CREATE TABLE `finding_precedents` (
	`finding_id` text NOT NULL,
	`precedent_id` text NOT NULL,
	`rank` integer NOT NULL,
	`similarity` real NOT NULL,
	`embedder` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`finding_id`, `precedent_id`),
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`precedent_id`) REFERENCES `precedents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `finding_precedents_precedent_idx` ON `finding_precedents` (`precedent_id`);--> statement-breakpoint
CREATE TABLE `precedent_embeddings` (
	`precedent_id` text NOT NULL,
	`embedder` text NOT NULL,
	`vector` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`precedent_id`, `embedder`),
	FOREIGN KEY (`precedent_id`) REFERENCES `precedents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rule_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`precedent_ids` text NOT NULL,
	`finding_id` text,
	`scan_id` text,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
