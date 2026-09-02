CREATE TABLE `technocore_relay_attempts` (
	`envelope_sha256` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`room` text NOT NULL,
	`actor_did` text NOT NULL,
	`nonce_value` text NOT NULL,
	`text_sha256` text NOT NULL,
	`state` text NOT NULL,
	`upstream_status` integer,
	`upstream_detail` text,
	`reserved_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_technocore_relay_nonce` ON `technocore_relay_attempts` (`room`,`actor_did`,`nonce_value`);--> statement-breakpoint
CREATE INDEX `idx_technocore_relay_result_state` ON `technocore_relay_attempts` (`result_id`,`state`);