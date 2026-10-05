import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  category: text('category'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
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
});

/**
 * The author behind a prize. Private: the Discord handle never reaches a
 * public response. One per asset, which the unique index enforces.
 */
export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contactNotes: text('contact_notes'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  discordHandle: text('discord_handle').notNull(),
  assetId: integer('asset_id')
    .notNull()
    .unique()
    .references(() => assets.id, { onDelete: 'cascade' }),
}, table => [
  // SQLite does not index foreign keys; without this, cascading a delete and
  // looking up an asset's authors both scan the whole table.
  index('contacts_asset_id_index').on(table.assetId),
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
  // See contacts: the foreign key is not indexed by SQLite, and the gallery
  // counts an asset's keys on every page.
  index('keys_asset_id_index').on(table.assetId),
]);

export type Asset = typeof assets.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
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
