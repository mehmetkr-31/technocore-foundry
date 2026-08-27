CREATE TABLE `evidence_checks` (
	`result_id` text PRIMARY KEY NOT NULL,
	`github_status` text NOT NULL,
	`ci_status` text NOT NULL,
	`identity_binding` text NOT NULL,
	`detail` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `result_finalizations` (
	`result_id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`receipt_json` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_result_finalizations_receipt` ON `result_finalizations` (`receipt_id`);