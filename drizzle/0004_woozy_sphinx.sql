CREATE TABLE `attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`actor_did` text NOT NULL,
	`statement` text NOT NULL,
	`note` text NOT NULL,
	`event_json` text NOT NULL,
	`signature` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attestations_result_actor_statement` ON `attestations` (`result_id`,`actor_did`,`statement`);--> statement-breakpoint
CREATE INDEX `idx_attestations_mission_created` ON `attestations` (`mission_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_attestations_actor_created` ON `attestations` (`actor_did`,`created_at`);--> statement-breakpoint
CREATE TABLE `observer_gaps` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`epoch` integer NOT NULL,
	`kind` text NOT NULL,
	`expected_seq` integer NOT NULL,
	`first_seq` integer NOT NULL,
	`detected_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_observer_gaps_room_detected` ON `observer_gaps` (`room`,`detected_at`);--> statement-breakpoint
CREATE TABLE `room_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`epoch` integer NOT NULL,
	`start_seq` integer NOT NULL,
	`end_seq` integer NOT NULL,
	`gap_count` integer DEFAULT 0 NOT NULL,
	`source_commit` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`last_sync_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_room_epochs_room_epoch` ON `room_epochs` (`room`,`epoch`);--> statement-breakpoint
CREATE INDEX `idx_room_epochs_room_started` ON `room_epochs` (`room`,`started_at`);--> statement-breakpoint
CREATE TABLE `transport_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`room` text NOT NULL,
	`epoch` integer NOT NULL,
	`sequence` integer NOT NULL,
	`server_timestamp` text NOT NULL,
	`actor_hint` text NOT NULL,
	`text_sha256` text NOT NULL,
	`receipt_id` text,
	`verification_state` text NOT NULL,
	`observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transport_observations_room_epoch_sequence` ON `transport_observations` (`room`,`epoch`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_transport_observations_receipt` ON `transport_observations` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `idx_transport_observations_observed` ON `transport_observations` (`observed_at`);
--> statement-breakpoint
PRAGMA optimize;
