// @vitest-environment node
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from './db.ts';

import { connectDatabase } from './db.ts';
import { assets, contacts, keys } from './schema.ts';

let handle: DatabaseHandle;

beforeEach(() => {
  handle = connectDatabase(':memory:');
});

afterEach(() => {
  handle.close();
});

function tableNames(target: DatabaseHandle): string[] {
  const rows = target.sqlite
    .prepare('select name from sqlite_master where type = ? order by name')
    .all('table') as { name: string }[];

  return rows.map(row => row.name);
}

function indexNames(target: DatabaseHandle): string[] {
  const rows = target.sqlite
    .prepare('select name from sqlite_master where type = ? order by name')
    .all('index') as { name: string }[];

  return rows.map(row => row.name);
}

function addAsset(overrides: Partial<typeof assets.$inferInsert> = {}) {
  return handle.db
    .insert(assets)
    .values({
      name: 'Fantasy Kit',
      assetId: '169047',
      assetUrl: 'https://assetstore.unity.com/packages/2d/fantasy-kit-169047',
      ...overrides,
    })
    .returning()
    .get();
}

describe('the assets table', () => {
  it('stores an asset with both clients and sensible defaults', () => {
    const asset = addAsset();

    expect(asset.id).toBe(1);
    expect(asset.currency).toBe('USD');
    expect(asset.createdAt).toBeInstanceOf(Date);
    expect(asset.updatedAt).toBeInstanceOf(Date);
  });

  it('keeps the price null when it could not be read from the page', () => {
    expect(addAsset().priceCents).toBeNull();
  });

  it('accepts a price in cents when the admin typed one', () => {
    expect(addAsset({ priceCents: 4999 }).priceCents).toBe(4999);
  });

  it('refuses two assets with the same Unity identifier', () => {
    addAsset();

    expect(() => addAsset({ name: 'Another Kit' })).toThrow(/UNIQUE/i);
  });
});

describe('the private tables', () => {
  it('deletes an asset\'s contacts and keys along with the asset', () => {
    const asset = addAsset();
    handle.db.insert(contacts).values({ assetId: asset.id, discordHandle: 'some_author' }).run();
    handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).run();

    handle.db.delete(assets).where(eq(assets.id, asset.id)).run();

    expect(handle.db.select().from(contacts).all()).toHaveLength(0);
    expect(handle.db.select().from(keys).all()).toHaveLength(0);
  });

  it('refuses the same key twice', () => {
    const asset = addAsset();
    handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).run();

    expect(() => handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).run())
      .toThrow(/UNIQUE/i);
  });

  it('defaults a key to available and tracks the assignment', () => {
    const asset = addAsset();
    const key = handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).returning().get();

    expect(key.status).toBe('available');
    expect(key.assignedTo).toBeNull();
    expect(key.assignedAt).toBeNull();
  });
});

describe('the schema itself', () => {
  it('refreshes updated_at when an asset is updated', () => {
    const created = new Date('2020-01-01T00:00:00Z');
    const asset = addAsset({ createdAt: created, updatedAt: created });

    handle.db.update(assets).set({ priceCents: 4999 }).where(eq(assets.id, asset.id)).run();

    const updated = handle.db.select().from(assets).where(eq(assets.id, asset.id)).get();

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.getTime());
  });

  it('refuses a key pointing at an asset that does not exist', () => {
    expect(() => handle.db.insert(keys).values({ assetId: 999, keyValue: 'ABCD-1234-EFGH' }).run())
      .toThrow(/FOREIGN KEY/i);
  });

  it('carries the uniqueness and foreign-key indexes', () => {
    expect(indexNames(handle)).toEqual(expect.arrayContaining([
      'assets_asset_id_unique',
      'contacts_asset_id_index',
      'keys_asset_id_index',
      'keys_key_value_unique',
    ]));
  });

  it('is safe to run its migrations on every connect', () => {
    const directory = mkdtempSync(join(tmpdir(), 'prizes-'));

    try {
      const file = join(directory, 'test.sqlite');
      const first = connectDatabase(file);
      const tables = tableNames(first);
      first.close();

      const second = connectDatabase(file);
      expect(tableNames(second)).toEqual(tables);
      second.close();
    }
    finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
