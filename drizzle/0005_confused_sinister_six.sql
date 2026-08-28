CREATE TABLE `evidence_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor_did` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_evidence_receipts_result_kind_actor` ON `evidence_receipts` (`result_id`,`kind`,`actor_did`);--> statement-breakpoint
CREATE INDEX `idx_evidence_receipts_result_created` ON `evidence_receipts` (`result_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_evidence_receipts_mission_created` ON `evidence_receipts` (`mission_id`,`created_at`);