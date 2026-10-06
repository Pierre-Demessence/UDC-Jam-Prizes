ALTER TABLE `authors` ADD `publisher_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `authors_publisher_id_unique` ON `authors` (`publisher_id`);