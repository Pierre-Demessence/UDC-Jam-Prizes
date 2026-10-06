/**
 * Database access. SQLite is synchronous, so these are plain functions: every
 * one returns finished data rather than a promise.
 */
import { and, asc, eq, isNotNull, lt, sql } from 'drizzle-orm';

import type { AttemptStore } from './auth.ts';
import type { DatabaseHandle } from './db.ts';
import type { AdminAsset, AdminAuthor, PublicCatalogue } from './payloads.ts';
import type { Asset, Author } from './schema.ts';
import type { AssetInput, AuthorInput } from './validate.ts';

import { toAdminAsset, toAdminAuthor, toPublicAsset } from './payloads.ts';
import { assets, authors, keys, rateLimitAttempts } from './schema.ts';
import { decryptSecret, encryptSecret, fingerprintSecret, isEncrypted } from './secrets.ts';

type Db = DatabaseHandle['db'];

/** How many prizes hang off one author. */
function assetCount(db: Db, authorId: number): number {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(assets)
    .where(eq(assets.authorId, authorId))
    .get()
    ?.count ?? 0;
}

/** One author with its prize count, or null when the id is null or unknown. */
function authorPayload(db: Db, authorId: number | null): AdminAuthor | null {
  if (authorId === null)
    return null;

  const author = findAuthorById(db, authorId);

  return author === null ? null : toAdminAuthor(author, assetCount(db, authorId));
}

/** The public catalogue: shaped fields only, plus the totals the header shows. */
export function publicCatalogue(db: Db): PublicCatalogue {
  // Hidden prizes are left out entirely, totals included: the public page is the
  // catalogue, and a prize taken off it is not part of the sum any more.
  const visible = eq(assets.hidden, false);
  // The publisher id comes from the author, its only home; a LEFT JOIN keeps a
  // prize with no author in the catalogue, it simply has no link.
  const rows = db
    .select({ asset: assets, publisherId: authors.publisherId })
    .from(assets)
    .leftJoin(authors, eq(assets.authorId, authors.id))
    .where(visible)
    .orderBy(asc(assets.name))
    .all();
  const totals = db
    .select({
      count: sql<number>`count(*)`,
      priceCents: sql<number>`coalesce(sum(${assets.priceCents}), 0)`,
    })
    .from(assets)
    .where(visible)
    .get();

  return {
    assets: rows.map(row => toPublicAsset(row.asset, row.publisherId)),
    totals: { count: totals?.count ?? 0, priceCents: totals?.priceCents ?? 0 },
  };
}

/** Everything the admin screen needs, private fields included. */
export function adminCatalogue(db: Db, secret: string): AdminAsset[] {
  const rows = db.select().from(assets).orderBy(asc(assets.name)).all();
  // Loaded in bulk and grouped here: a jam's prize list is small, and this
  // keeps one query per table instead of one per prize.
  const authorRows = db.select().from(authors).all();
  const keyRows = db.select().from(keys).all();
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.authorId !== null)
      counts.set(row.authorId, (counts.get(row.authorId) ?? 0) + 1);
  }

  const known = new Map(authorRows.map(author => [author.id, toAdminAuthor(author, counts.get(author.id) ?? 0)]));

  return rows.map(asset => toAdminAsset(
    asset,
    asset.authorId === null ? null : known.get(asset.authorId) ?? null,
    keyRows.filter(key => key.assetId === asset.id),
    secret,
  ));
}

export function adminAsset(db: Db, id: number, secret: string): AdminAsset | null {
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset)
    return null;

  const rows = db.select().from(keys).where(eq(keys.assetId, id)).all();

  return toAdminAsset(asset, authorPayload(db, asset.authorId), rows, secret);
}

export function findAssetByAssetId(db: Db, assetId: string): Asset | null {
  return db.select().from(assets).where(eq(assets.assetId, assetId)).get() ?? null;
}

export function createAsset(db: Db, input: AssetInput, secret: string): AdminAsset {
  const asset = db.insert(assets).values(input).returning().get();

  return toAdminAsset(asset, authorPayload(db, asset.authorId), [], secret);
}

export function updateAsset(db: Db, id: number, input: AssetInput, secret: string): AdminAsset | null {
  db.update(assets).set(input).where(eq(assets.id, id)).run();

  return adminAsset(db, id, secret);
}

export function deleteAsset(db: Db, id: number): boolean {
  return db.delete(assets).where(eq(assets.id, id)).run().changes > 0;
}

/** How many keys the winners asked for, set from the admin table's own field. */
export function updateNeeded(db: Db, id: number, needed: number, secret: string): AdminAsset | null {
  const existing = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!existing)
    return null;

  db.update(assets).set({ needed }).where(eq(assets.id, id)).run();

  return adminAsset(db, id, secret);
}

/**
 * Shows or hides a prize on the public side, from the admin table's own button.
 * The row itself is never touched: hiding keeps its keys and its author.
 */
export function updateHidden(db: Db, id: number, hidden: boolean, secret: string): AdminAsset | null {
  const existing = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!existing)
    return null;

  db.update(assets).set({ hidden }).where(eq(assets.id, id)).run();

  return adminAsset(db, id, secret);
}

/** Every author with their prize count, ordered by the label the admin sees. */
export function listAuthors(db: Db): AdminAuthor[] {
  const counts = new Map(
    db
      .select({ authorId: assets.authorId, count: sql<number>`count(*)` })
      .from(assets)
      .where(isNotNull(assets.authorId))
      .groupBy(assets.authorId)
      .all()
      .map(row => [row.authorId as number, row.count] as const),
  );

  // Sorted here rather than in SQL: the label is a fallback chain, and the panel
  // and the prize form both show exactly what this orders.
  return db.select().from(authors).all().map(author => toAdminAuthor(author, counts.get(author.id) ?? 0)).sort((left, right) => left.label.localeCompare(right.label));
}

export function findAuthorById(db: Db, id: number): Author | null {
  return db.select().from(authors).where(eq(authors.id, id)).get() ?? null;
}

/**
 * The author whose publisher matches, case-insensitively: the lookup the prize
 * form and the bulk import use to attach an author without being asked.
 */
export function findAuthorByPublisher(db: Db, publisher: string | null): Author | null {
  if (publisher === null || publisher.trim() === '')
    return null;

  return db.select().from(authors).where(sql`lower(${authors.publisher}) = ${publisher.trim().toLowerCase()}`).get() ?? null;
}

/** The clash checks behind the author routes: a handle or an id already taken. */
export function findAuthorByDiscordHandle(db: Db, handle: string): Author | null {
  return db.select().from(authors).where(sql`lower(${authors.discordHandle}) = ${handle.trim().toLowerCase()}`).get() ?? null;
}

export function findAuthorByDiscordId(db: Db, discordId: string): Author | null {
  return db.select().from(authors).where(eq(authors.discordId, discordId)).get() ?? null;
}

/** The author who already holds a store publisher id, which is unique like the name. */
export function findAuthorByPublisherId(db: Db, publisherId: string): Author | null {
  return db.select().from(authors).where(eq(authors.publisherId, publisherId)).get() ?? null;
}

export function createAuthor(db: Db, input: AuthorInput): AdminAuthor {
  const author = db.insert(authors).values(input).returning().get();

  return toAdminAuthor(author, 0);
}

export function updateAuthor(db: Db, id: number, input: AuthorInput): AdminAuthor | null {
  const author = db.update(authors).set(input).where(eq(authors.id, id)).returning().get();

  return author === undefined ? null : toAdminAuthor(author, assetCount(db, id));
}

/**
 * Deletes an author and clears the link on their prizes — what `ON DELETE SET
 * NULL` does too, but doing it here is what lets the count come back for the
 * notice. Returns how many prizes were unlinked, or null when there is no such
 * author.
 */
export function deleteAuthor(db: Db, id: number): number | null {
  if (findAuthorById(db, id) === null)
    return null;

  const unlinked = db.update(assets).set({ authorId: null }).where(eq(assets.authorId, id)).run().changes;
  db.delete(authors).where(eq(authors.id, id)).run();

  return unlinked;
}

/**
 * Attaches every prize whose publisher matches, case-insensitively: the action
 * that clears a whole back catalogue for one author in a click. Returns how many
 * prizes were linked.
 */
export function attachAuthorByPublisher(db: Db, authorId: number, publisher: string): number {
  return db.update(assets)
    .set({ authorId })
    .where(sql`lower(${assets.publisher}) = ${publisher.trim().toLowerCase()}`)
    .run()
    .changes;
}

/**
 * Adds pasted keys, ignoring the ones already stored. Returns how many landed.
 * The value is encrypted, and its fingerprint is what spots the duplicate.
 */
export function addKeys(db: Db, assetId: number, values: string[], secret: string): number {
  const result = db
    .insert(keys)
    .values(values.map(value => ({
      assetId,
      keyFingerprint: fingerprintSecret(value, secret),
      keyValue: encryptSecret(value, secret),
    })))
    .onConflictDoNothing()
    .run();

  return result.changes;
}

/**
 * Encrypts keys that were stored before encryption existed, and gives them the
 * fingerprint the duplicate check needs. Idempotent, so it runs on every start:
 * a row that already has a fingerprint is skipped, and a row that is already
 * ciphertext keeps that ciphertext — rewriting it would only swap one good value
 * for another. Returns how many rows it rewrote.
 */
export function encryptLegacyKeys(db: Db, secret: string): number {
  let migrated = 0;

  for (const row of db.select().from(keys).all()) {
    if (row.keyFingerprint !== null)
      continue;

    const alreadyEncrypted = isEncrypted(row.keyValue);
    let plaintext: string;
    if (alreadyEncrypted) {
      try {
        plaintext = decryptSecret(row.keyValue, secret);
      }
      catch {
        // Written with another secret: leave it alone, the admin screen reports it as unreadable.
        continue;
      }
    }
    else {
      plaintext = row.keyValue;
    }

    const fingerprint = fingerprintSecret(plaintext, secret);
    const taken = db.select().from(keys).where(eq(keys.keyFingerprint, fingerprint)).get() !== undefined;

    // The same key is already stored under that fingerprint, and the unique
    // index only holds one: this copy is encrypted but stays unfingerprinted.
    if (alreadyEncrypted && taken)
      continue;

    db.update(keys)
      .set({
        keyFingerprint: taken ? null : fingerprint,
        keyValue: alreadyEncrypted ? row.keyValue : encryptSecret(plaintext, secret),
      })
      .where(eq(keys.id, row.id))
      .run();
    migrated++;
  }

  return migrated;
}

export function deleteKey(db: Db, assetId: number, keyId: number, secret: string): AdminAsset | null {
  const existing = db.select().from(keys).where(eq(keys.id, keyId)).get();
  if (existing && existing.assetId === assetId)
    db.delete(keys).where(eq(keys.id, keyId)).run();

  return adminAsset(db, assetId, secret);
}

/**
 * The limiter's windows, in SQLite: a restart must not clear a lockout. A window
 * holds at most `limit` timestamps, so `save` replaces a key's rows instead of
 * tracking them one by one.
 */
export function createAttemptStore(db: Db): AttemptStore {
  const mine = (bucket: string, clientKey: string) => and(
    eq(rateLimitAttempts.bucket, bucket),
    eq(rateLimitAttempts.clientKey, clientKey),
  );

  return {
    load(bucket, clientKey) {
      return db
        .select({ at: rateLimitAttempts.attemptedAt })
        .from(rateLimitAttempts)
        .where(mine(bucket, clientKey))
        .orderBy(asc(rateLimitAttempts.attemptedAt))
        .all()
        .map(row => row.at.getTime());
    },
    prune(bucket, before) {
      db.delete(rateLimitAttempts)
        .where(and(eq(rateLimitAttempts.bucket, bucket), lt(rateLimitAttempts.attemptedAt, new Date(before))))
        .run();
    },
    save(bucket, clientKey, attempts) {
      db.transaction((tx) => {
        tx.delete(rateLimitAttempts).where(mine(bucket, clientKey)).run();

        if (attempts.length > 0) {
          tx.insert(rateLimitAttempts)
            .values(attempts.map(at => ({ attemptedAt: new Date(at), bucket, clientKey })))
            .run();
        }
      });
    },
  };
}
