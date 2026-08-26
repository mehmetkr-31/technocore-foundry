CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text NOT NULL,
	`actor_did` text NOT NULL,
	`signature` text NOT NULL,
	`event_json` text NOT NULL,
	`created_at` text NOT NULL,
	`observed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_claims_mission_actor` ON `claims` (`mission_id`,`actor_did`);--> statement-breakpoint
CREATE INDEX `idx_claims_actor_created` ON `claims` (`actor_did`,`created_at`);--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`lane` text NOT NULL,
	`summary` text NOT NULL,
	`requirements_hash` text NOT NULL,
	`issuer_did` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_missions_status_created` ON `missions` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`schema` text NOT NULL,
	`actor_did` text NOT NULL,
	`mission_id` text,
	`object_key` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_receipts_actor_created` ON `receipts` (`actor_did`,`created_at`);