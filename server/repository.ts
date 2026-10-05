/**
 * Database access. SQLite is synchronous, so these are plain functions: every
 * one returns finished data rather than a promise.
 */
import { and, asc, eq, lt, sql } from 'drizzle-orm';

import type { AttemptStore } from './auth.ts';
import type { DatabaseHandle } from './db.ts';
import type { AdminAsset, PublicCatalogue } from './payloads.ts';
import type { Asset } from './schema.ts';
import type { AssetInput, ContactInput } from './validate.ts';

import { toAdminAsset, toPublicAsset } from './payloads.ts';
import { assets, contacts, keys, rateLimitAttempts } from './schema.ts';
import { decryptSecret, encryptSecret, fingerprintSecret, isEncrypted } from './secrets.ts';

type Db = DatabaseHandle['db'];

/** The public catalogue: shaped fields only, plus the totals the header shows. */
export function publicCatalogue(db: Db): PublicCatalogue {
  // Hidden prizes are left out entirely, totals included: the public page is the
  // catalogue, and a prize taken off it is not part of the sum any more.
  const visible = eq(assets.hidden, false);
  const rows = db.select().from(assets).where(visible).orderBy(asc(assets.name)).all();
  const totals = db
    .select({
      count: sql<number>`count(*)`,
      priceCents: sql<number>`coalesce(sum(${assets.priceCents}), 0)`,
    })
    .from(assets)
    .where(visible)
    .get();

  return {
    assets: rows.map(toPublicAsset),
    totals: { count: totals?.count ?? 0, priceCents: totals?.priceCents ?? 0 },
  };
}

/** Everything the admin screen needs, private fields included. */
export function adminCatalogue(db: Db, secret: string): AdminAsset[] {
  const rows = db.select().from(assets).orderBy(asc(assets.name)).all();
  // Loaded in bulk and grouped here: a jam's prize list is small, and this
  // keeps one query per table instead of one per asset.
  const contactRows = db.select().from(contacts).all();
  const keyRows = db.select().from(keys).all();

  return rows.map(asset => toAdminAsset(
    asset,
    contactRows.find(contact => contact.assetId === asset.id) ?? null,
    keyRows.filter(key => key.assetId === asset.id),
    secret,
  ));
}

export function adminAsset(db: Db, id: number, secret: string): AdminAsset | null {
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset)
    return null;

  const contact = db.select().from(contacts).where(eq(contacts.assetId, id)).get() ?? null;
  const rows = db.select().from(keys).where(eq(keys.assetId, id)).all();

  return toAdminAsset(asset, contact, rows, secret);
}

export function findAssetByAssetId(db: Db, assetId: string): Asset | null {
  return db.select().from(assets).where(eq(assets.assetId, assetId)).get() ?? null;
}

export function createAsset(db: Db, input: AssetInput, secret: string): AdminAsset {
  const asset = db.insert(assets).values(input).returning().get();

  return toAdminAsset(asset, null, [], secret);
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
 * The row itself is never touched: hiding keeps its keys, contact and notes.
 */
export function updateHidden(db: Db, id: number, hidden: boolean, secret: string): AdminAsset | null {
  const existing = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!existing)
    return null;

  db.update(assets).set({ hidden }).where(eq(assets.id, id)).run();

  return adminAsset(db, id, secret);
}

/** One contact per asset: the author behind the prize. */
export function saveContact(db: Db, assetId: number, input: ContactInput): void {
  db.insert(contacts)
    .values({ ...input, assetId })
    .onConflictDoUpdate({ set: input, target: contacts.assetId })
    .run();
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
