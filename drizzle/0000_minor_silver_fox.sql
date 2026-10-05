CREATE TABLE `assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`asset_id` text NOT NULL,
	`asset_url` text NOT NULL,
	`category` text,
	`created_at` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`image_url` text,
	`notes` text,
	`price_cents` integer,
	`publisher` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_asset_id_unique` ON `assets` (`asset_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contact_notes` text,
	`created_at` integer NOT NULL,
	`discord_handle` text NOT NULL,
	`asset_id` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contacts_asset_id_index` ON `contacts` (`asset_id`);--> statement-breakpoint
CREATE TABLE `keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assigned_at` integer,
	`assigned_to` text,
	`created_at` integer NOT NULL,
	`key_value` text NOT NULL,
	`sent_at` integer,
	`asset_id` integer NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keys_key_value_unique` ON `keys` (`key_value`);--> statement-breakpoint
CREATE INDEX `keys_asset_id_index` ON `keys` (`asset_id`);