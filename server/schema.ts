import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * The author behind one or more prizes: the whole catalogue comes from a handful
 * of people, so the person is a record of its own rather than a field copied onto
 * every prize. Private, like the contact it replaces: no author data reaches a
 * public response.
 *
 * There is no name column: an author is shown by their Discord handle, then by
 * the store publisher, which is the one label a prize fills in by itself. A
 * publisher string of their own is therefore worth more than a free-text name.
 *
 * `discordHandle` is a mutable display name and `discordId` is the snowflake that
 * never changes, which is why both are kept. Neither is required on its own, but
 * at least one of the three identifying fields has to be there — a record with
 * none of them is noise (see `parseAuthorInput`).
 *
 * `publisher` is the store publisher string the prizes were read from, and it is
 * what lets a prize find its author unasked: the form and the bulk import match
 * on it. It is unique among authors, because a preselect that could mean two
 * people is worse than none — the second author claiming a publisher is refused
 * with a readable sentence instead.
 */
export const authors = sqliteTable('authors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  discordHandle: text('discord_handle').unique(),
  discordId: text('discord_id').unique(),
  publisher: text('publisher').unique(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    // See the note on `assets.updatedAt`.
    .$onUpdate(() => new Date()),
});

/**
 * One prize: a Unity asset donated to a jam.
 *
 * `assetId` is Unity's own identifier, kept as text — it is a label, not a
 * quantity. `priceCents` is null when the price could not be read from the
 * asset page, which is expected: Unity renders it client-side. `needed` is how
 * many keys the jam's winners asked for, which is planning information and
 * therefore never published.
 */
export const assets = sqliteTable('assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  assetId: text('asset_id').notNull().unique(),
  assetUrl: text('asset_url').notNull(),
  /**
   * The person who donated it. Null means nobody has been attached yet, and it
   * is `SET NULL` rather than a cascade: deleting an author must never delete a
   * prize. The reverse still holds — deleting the prize removes its keys.
   */
  authorId: integer('author_id').references(() => authors.id, { onDelete: 'set null' }),
  category: text('category'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  /**
   * Hidden from the public catalogue while staying in the admin list with its
   * keys and author: pulling a prize off the public page never loses anything,
   * and it can be shown again. The default is in SQL so adding the column gives
   * the rows already in the table a value.
   */
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  imageUrl: text('image_url'),
  needed: integer('needed').notNull().default(0),
  notes: text('notes'),
  priceCents: integer('price_cents'),
  publisher: text('publisher'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    // Without this Drizzle omits the column from every UPDATE, so `updatedAt`
    // would silently stay equal to `createdAt`.
    .$onUpdate(() => new Date()),
}, table => [
  // SQLite does not index foreign keys, and the admin screen lists an author's
  // prizes through this column.
  index('assets_author_id_index').on(table.authorId),
]);

/**
 * A donated key. Private, and a secret: `keyValue` holds AES-256-GCM ciphertext
 * (see secrets.ts), never the key itself, and a key is nothing more than stock
 * for its prize — no status, no recipient. Random initialisation means the same
 * key encrypts differently every time, so the separate, deterministic
 * `keyFingerprint` is what recognises a key that was pasted twice. It is
 * nullable because rows written before encryption existed are backfilled at
 * start-up; SQLite counts every NULL as distinct, so the unique index tolerates
 * them.
 */
export const keys = sqliteTable('keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  keyFingerprint: text('key_fingerprint').unique(),
  keyValue: text('key_value').notNull(),
  assetId: integer('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
}, table => [
  // See the note on `assets.authorId`: SQLite does not index foreign keys, and
  // the gallery counts an asset's keys on every page.
  index('keys_asset_id_index').on(table.assetId),
]);

export type Asset = typeof assets.$inferSelect;
export type Author = typeof authors.$inferSelect;
export type Key = typeof keys.$inferSelect;

/**
 * One limiter attempt. The login limit is pointless if a restart clears it, and
 * the login endpoint is the only unauthenticated writer, so its window lives
 * here rather than in memory — `bucket` names the limiter, so the admin-only
 * limits can move in later. Rows age out of their window as they are checked.
 * There is no `$defaultFn` on `attempted_at`: the limiter passes the time it
 * judged the attempt by, so a test can control the clock.
 */
export const rateLimitAttempts = sqliteTable('rate_limit_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  attemptedAt: integer('attempted_at', { mode: 'timestamp_ms' }).notNull(),
  bucket: text('bucket').notNull(),
  clientKey: text('client_key').notNull(),
}, table => [
  index('rate_limit_attempts_window_index').on(table.bucket, table.clientKey, table.attemptedAt),
]);
