CREATE TABLE `contribution_dossiers` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`claimant_did` text NOT NULL,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`snapshot_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_contribution_dossiers_result_sha256` ON `contribution_dossiers` (`result_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `idx_contribution_dossiers_result_created` ON `contribution_dossiers` (`result_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_contribution_dossiers_mission_created` ON `contribution_dossiers` (`mission_id`,`created_at`);