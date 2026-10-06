// @vitest-environment node
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from './db.ts';

import { connectDatabase } from './db.ts';
import { assets, authors, keys } from './schema.ts';

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

function addAuthor(overrides: Partial<typeof authors.$inferInsert> = {}) {
  return handle.db.insert(authors).values({ discordHandle: 'priya', ...overrides }).returning().get();
}

describe('the assets table', () => {
  it('stores an asset with both clients and sensible defaults', () => {
    const asset = addAsset();

    expect(asset.id).toBe(1);
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
  it('deletes an asset\'s keys along with the asset', () => {
    const asset = addAsset();
    handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).run();

    handle.db.delete(assets).where(eq(assets.id, asset.id)).run();

    expect(handle.db.select().from(keys).all()).toHaveLength(0);
  });

  it('refuses two keys carrying the same fingerprint', () => {
    const asset = addAsset();
    handle.db.insert(keys)
      .values({ assetId: asset.id, keyFingerprint: 'a-fingerprint', keyValue: 'v1:first' })
      .run();

    expect(() => handle.db.insert(keys)
      .values({ assetId: asset.id, keyFingerprint: 'a-fingerprint', keyValue: 'v1:second' })
      .run()).toThrow(/UNIQUE/i);
  });

  it('accepts several keys with no fingerprint yet, which the backfill relies on', () => {
    const asset = addAsset();
    handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).run();
    handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'IJKL-5678-MNOP' }).run();

    expect(handle.db.select().from(keys).all()).toHaveLength(2);
  });

  it('stores a key whose only content is its value', () => {
    const asset = addAsset();
    const key = handle.db.insert(keys).values({ assetId: asset.id, keyValue: 'ABCD-1234-EFGH' }).returning().get();

    expect(key.keyValue).toBe('ABCD-1234-EFGH');
    expect(key.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(key).sort()).toEqual(['assetId', 'createdAt', 'id', 'keyFingerprint', 'keyValue']);
  });
});

describe('the authors table', () => {
  it('links a prize to its author and unlinks it when the author goes', () => {
    const author = addAuthor();
    const prize = addAsset({ authorId: author.id });

    expect(prize.authorId).toBe(author.id);

    handle.db.delete(authors).where(eq(authors.id, author.id)).run();

    // The prize survives: `SET NULL`, never a cascade in this direction.
    expect(handle.db.select().from(assets).where(eq(assets.id, prize.id)).get()?.authorId).toBeNull();
  });

  it('refuses a prize pointing at an author that does not exist', () => {
    expect(() => addAsset({ authorId: 999 })).toThrow(/FOREIGN KEY/i);
  });

  it('refuses a second author on the same publisher, or the same Discord id', () => {
    addAuthor({ discordId: '123456789012345678', publisher: 'ashkatchap' });

    expect(() => addAuthor({ discordHandle: 'someone-else', publisher: 'ashkatchap' })).toThrow(/UNIQUE/i);
    expect(() => addAuthor({ discordHandle: 'someone-else', discordId: '123456789012345678' })).toThrow(/UNIQUE/i);
  });

  it('accepts any number of authors with no publisher, which is not a clash', () => {
    addAuthor({ discordHandle: 'priya' });
    addAuthor({ discordHandle: 'bob' });

    expect(handle.db.select().from(authors).all()).toHaveLength(2);
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
      'assets_author_id_index',
      'authors_discord_handle_unique',
      'authors_discord_id_unique',
      'authors_publisher_unique',
      'keys_asset_id_index',
      'keys_key_fingerprint_unique',
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
