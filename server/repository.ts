/**
 * Database access. SQLite is synchronous, so these are plain functions: every
 * one returns finished data rather than a promise.
 */
import { asc, eq, sql } from 'drizzle-orm';

import type { DatabaseHandle } from './db.ts';
import type { AdminAsset, PublicCatalogue } from './payloads.ts';
import type { Asset } from './schema.ts';
import type { AssetInput, ContactInput, KeyStatusInput } from './validate.ts';

import { toAdminAsset, toPublicAsset } from './payloads.ts';
import { assets, contacts, keys } from './schema.ts';

type Db = DatabaseHandle['db'];

/** The public catalogue: shaped fields only, plus the totals the header shows. */
export function publicCatalogue(db: Db): PublicCatalogue {
  const rows = db.select().from(assets).orderBy(asc(assets.name)).all();
  const totals = db
    .select({
      count: sql<number>`count(*)`,
      priceCents: sql<number>`coalesce(sum(${assets.priceCents}), 0)`,
    })
    .from(assets)
    .get();

  return {
    assets: rows.map(toPublicAsset),
    totals: { count: totals?.count ?? 0, priceCents: totals?.priceCents ?? 0 },
  };
}

/** Everything the admin screen needs, private fields included. */
export function adminCatalogue(db: Db): AdminAsset[] {
  const rows = db.select().from(assets).orderBy(asc(assets.name)).all();
  // Loaded in bulk and grouped here: a jam's prize list is small, and this
  // keeps one query per table instead of one per asset.
  const contactRows = db.select().from(contacts).all();
  const keyRows = db.select().from(keys).all();

  return rows.map(asset => toAdminAsset(
    asset,
    contactRows.find(contact => contact.assetId === asset.id) ?? null,
    keyRows.filter(key => key.assetId === asset.id),
  ));
}

export function adminAsset(db: Db, id: number): AdminAsset | null {
  const asset = db.select().from(assets).where(eq(assets.id, id)).get();
  if (!asset)
    return null;

  const contact = db.select().from(contacts).where(eq(contacts.assetId, id)).get() ?? null;
  const rows = db.select().from(keys).where(eq(keys.assetId, id)).all();

  return toAdminAsset(asset, contact, rows);
}

export function findAssetByAssetId(db: Db, assetId: string): Asset | null {
  return db.select().from(assets).where(eq(assets.assetId, assetId)).get() ?? null;
}

export function createAsset(db: Db, input: AssetInput): AdminAsset {
  const asset = db.insert(assets).values(input).returning().get();

  return toAdminAsset(asset, null, []);
}

export function updateAsset(db: Db, id: number, input: AssetInput): AdminAsset | null {
  db.update(assets).set(input).where(eq(assets.id, id)).run();

  return adminAsset(db, id);
}

export function deleteAsset(db: Db, id: number): boolean {
  return db.delete(assets).where(eq(assets.id, id)).run().changes > 0;
}

/** One contact per asset: the author behind the prize. */
export function saveContact(db: Db, assetId: number, input: ContactInput): void {
  db.insert(contacts)
    .values({ ...input, assetId })
    .onConflictDoUpdate({ set: input, target: contacts.assetId })
    .run();
}

/** Adds pasted keys, ignoring the ones already stored. Returns how many landed. */
export function addKeys(db: Db, assetId: number, values: string[]): number {
  const result = db
    .insert(keys)
    .values(values.map(keyValue => ({ assetId, keyValue })))
    .onConflictDoNothing()
    .run();

  return result.changes;
}

export function updateKey(db: Db, assetId: number, keyId: number, input: KeyStatusInput): AdminAsset | null {
  const existing = db.select().from(keys).where(eq(keys.id, keyId)).get();
  if (!existing || existing.assetId !== assetId)
    return adminAsset(db, assetId);

  const assignedAt = input.status === 'assigned' ? existing.assignedAt ?? new Date() : null;
  const sentAt = input.status === 'sent' ? existing.sentAt ?? new Date() : null;

  db.update(keys)
    .set({ assignedAt, assignedTo: input.status === 'available' ? null : input.assignedTo, sentAt, status: input.status })
    .where(eq(keys.id, keyId))
    .run();

  return adminAsset(db, assetId);
}

export function deleteKey(db: Db, assetId: number, keyId: number): AdminAsset | null {
  const existing = db.select().from(keys).where(eq(keys.id, keyId)).get();
  if (existing && existing.assetId === assetId)
    db.delete(keys).where(eq(keys.id, keyId)).run();

  return adminAsset(db, assetId);
}
