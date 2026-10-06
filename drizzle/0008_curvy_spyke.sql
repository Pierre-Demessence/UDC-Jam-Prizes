CREATE TABLE `authors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`discord_handle` text,
	`discord_id` text,
	`notes` text,
	`publisher` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authors_discord_handle_unique` ON `authors` (`discord_handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `authors_discord_id_unique` ON `authors` (`discord_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `authors_publisher_unique` ON `authors` (`publisher`);--> statement-breakpoint
ALTER TABLE `assets` ADD `author_id` integer REFERENCES authors(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `assets_author_id_index` ON `assets` (`author_id`);--> statement-breakpoint
INSERT INTO `authors` (`name`, `publisher`, `discord_handle`, `notes`, `created_at`, `updated_at`)
SELECT
	coalesce(claimed.publisher, grouped.handle) AS `name`,
	claimed.publisher AS `publisher`,
	grouped.handle AS `discord_handle`,
	grouped.notes AS `notes`,
	grouped.created_at AS `created_at`,
	grouped.created_at AS `updated_at`
FROM (
	SELECT
		lower(trim(contact.discord_handle)) AS handle,
		(SELECT earlier.contact_notes FROM `contacts` earlier
			WHERE lower(trim(earlier.discord_handle)) = lower(trim(contact.discord_handle))
				AND earlier.contact_notes IS NOT NULL
			ORDER BY earlier.id LIMIT 1) AS notes,
		min(contact.created_at) AS created_at
	FROM `contacts` contact
	GROUP BY lower(trim(contact.discord_handle))
) grouped
LEFT JOIN (
	-- A publisher is carried over only when exactly one handle claims it. Two
	-- authors holding the same publisher would break the unique index and abort
	-- the migration, and a match that could mean two people is worse than none:
	-- such an author is left with no publisher, for the panel to fill in.
	SELECT owner.handle AS handle, owner.publisher AS publisher
	FROM (
		SELECT lower(trim(contact.discord_handle)) AS handle, min(asset.publisher) AS publisher
		FROM `assets` asset JOIN `contacts` contact ON contact.asset_id = asset.id
		WHERE asset.publisher IS NOT NULL
		GROUP BY lower(trim(contact.discord_handle))
		HAVING count(DISTINCT asset.publisher) = 1
	) owner
	GROUP BY lower(owner.publisher)
	HAVING count(*) = 1
) claimed ON claimed.handle = grouped.handle;--> statement-breakpoint
UPDATE `assets`
SET `author_id` = (
	SELECT author.id FROM `authors` author
	JOIN `contacts` contact ON contact.asset_id = `assets`.id
	WHERE author.discord_handle = lower(trim(contact.discord_handle))
)
WHERE EXISTS (SELECT 1 FROM `contacts` contact WHERE contact.asset_id = `assets`.id);--> statement-breakpoint
DROP TABLE `contacts`;