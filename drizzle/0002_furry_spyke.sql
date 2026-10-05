DROP INDEX `keys_key_value_unique`;--> statement-breakpoint
ALTER TABLE `keys` ADD `key_fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `keys_key_fingerprint_unique` ON `keys` (`key_fingerprint`);