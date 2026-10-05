CREATE TABLE `rate_limit_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempted_at` integer NOT NULL,
	`bucket` text NOT NULL,
	`client_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_attempts_window_index` ON `rate_limit_attempts` (`bucket`,`client_key`,`attempted_at`);