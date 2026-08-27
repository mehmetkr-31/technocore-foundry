CREATE TABLE `change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`issuer_did` text NOT NULL,
	`result_sha256` text NOT NULL,
	`note` text NOT NULL,
	`event_json` text NOT NULL,
	`signature` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_change_requests_result` ON `change_requests` (`result_id`);--> statement-breakpoint
CREATE INDEX `idx_change_requests_mission_created` ON `change_requests` (`mission_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `result_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`actor_did` text NOT NULL,
	`revision` integer NOT NULL,
	`parent_result_id` text,
	`parent_receipt_sha256` text,
	`change_request_id` text,
	`change_request_sha256` text,
	`revision_receipt_id` text,
	`revision_event_json` text,
	`revision_signature` text,
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
CREATE UNIQUE INDEX `idx_result_revisions_claim_revision` ON `result_revisions` (`claim_id`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_result_revisions_parent` ON `result_revisions` (`parent_result_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_result_revisions_change_request` ON `result_revisions` (`change_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_result_revisions_receipt` ON `result_revisions` (`revision_receipt_id`);--> statement-breakpoint
CREATE INDEX `idx_result_revisions_mission_created` ON `result_revisions` (`mission_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_result_revisions_actor_created` ON `result_revisions` (`actor_did`,`created_at`);
--> statement-breakpoint
INSERT OR IGNORE INTO `result_revisions` (
	`id`, `mission_id`, `claim_id`, `actor_did`, `revision`, `receipt_json`, `receipt_sha256`,
	`artifact_object_key`, `artifact_name`, `artifact_media_type`, `artifact_sha256`,
	`artifact_bytes`, `repository_url`, `commit_sha`, `created_at`
)
SELECT
	`id`, `mission_id`, `claim_id`, `actor_did`, 1, `receipt_json`, `receipt_sha256`,
	`artifact_object_key`, `artifact_name`, `artifact_media_type`, `artifact_sha256`,
	`artifact_bytes`, `repository_url`, `commit_sha`, `created_at`
FROM `results`;
--> statement-breakpoint
PRAGMA optimize;
