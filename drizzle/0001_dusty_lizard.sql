CREATE TABLE `acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`issuer_did` text NOT NULL,
	`decision` text NOT NULL,
	`note` text NOT NULL,
	`event_json` text NOT NULL,
	`signature` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_acceptances_result` ON `acceptances` (`result_id`);--> statement-breakpoint
CREATE INDEX `idx_acceptances_mission_created` ON `acceptances` (`mission_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mission_signatures` (
	`mission_id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`event_json` text NOT NULL,
	`signature` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`actor_did` text NOT NULL,
	`receipt_json` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`artifact_object_key` text NOT NULL,
	`artifact_name` text NOT NULL,
	`artifact_media_type` text NOT NULL,
	`artifact_sha256` text NOT NULL,
	`artifact_bytes` integer NOT NULL,
	`repository_url` text,
	`commit_sha` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_results_claim` ON `results` (`claim_id`);--> statement-breakpoint
CREATE INDEX `idx_results_mission_created` ON `results` (`mission_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_results_actor_created` ON `results` (`actor_did`,`created_at`);