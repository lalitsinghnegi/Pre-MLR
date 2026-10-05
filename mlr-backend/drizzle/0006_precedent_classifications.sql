CREATE TABLE `precedent_classifications` (
	`precedent_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`category` text,
	`rule_id` text,
	`confidence` real,
	`no_matching_rule` integer NOT NULL,
	`topic` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`rule_pack_hash` text NOT NULL,
	`error` text,
	`classified_by` text NOT NULL,
	`classified_at` text NOT NULL,
	FOREIGN KEY (`precedent_id`) REFERENCES `precedents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `precedent_classifications_category_idx` ON `precedent_classifications` (`category`);