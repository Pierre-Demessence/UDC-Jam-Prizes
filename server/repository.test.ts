// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from './db.ts';

import { connectDatabase } from './db.ts';
import { adminAsset, attachAuthorByPublisher, createAttemptStore, createAuthor, deleteAuthor, encryptLegacyKeys, findAuthorByPublisher, listAuthors } from './repository.ts';
import { assets, keys } from './schema.ts';
import { encryptSecret } from './secrets.ts';
import { testConfig } from './testing.ts';

const SECRET = testConfig().keyEncryptionSecret;
const OTHER_SECRET = 'another-key-encryption-secret-32-chars';

let handle: DatabaseHandle;

beforeEach(() => {
  handle = connectDatabase(':memory:');
});

afterEach(() => {
  handle.close();
});

function addAsset(): number {
  return handle.db
    .insert(assets)
    .values({
      name: 'Text Animator',
      assetId: '341308',
      assetUrl: 'https://assetstore.unity.com/packages/tools/gui/text-animator-341308',
    })
    .returning()
    .get()
    .id;
}

/**
 * A key as an older version of this app wrote it: plain text, no fingerprint.
 * Written in raw SQL on purpose — `created_at` is a runtime default, so the
 * insert has to supply it, which is exactly what the old rows look like.
 */
function insertLegacyKey(assetId: number, value: string): void {
  handle.sqlite
    .prepare('insert into keys (asset_id, created_at, key_value) values (?, ?, ?)')
    .run(assetId, Date.now(), value);
}

function storedKey(assetId: number): { key_fingerprint: string | null; key_value: string } {
  return handle.sqlite
    .prepare('select key_fingerprint, key_value from keys where asset_id = ?')
    .get(assetId) as { key_fingerprint: string | null; key_value: string };
}

describe('keys stored before encryption existed', () => {
  it('are encrypted on the next start, and still readable by the admin', () => {
    const assetId = addAsset();
    insertLegacyKey(assetId, 'LEGACY-KEY-1');

    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(1);

    const row = storedKey(assetId);
    expect(row.key_value).toMatch(/^v1:/);
    expect(row.key_value).not.toContain('LEGACY');
    expect(row.key_fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const keys = adminAsset(handle.db, assetId, SECRET)?.keys ?? [];
    expect(keys.map(key => key.keyValue)).toEqual(['LEGACY-KEY-1']);
  });

  it('are left alone the second time round', () => {
    const assetId = addAsset();
    insertLegacyKey(assetId, 'LEGACY-KEY-1');

    encryptLegacyKeys(handle.db, SECRET);
    const after = storedKey(assetId);

    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(0);
    // Rewriting would re-encrypt the ciphertext and lose the value for good.
    expect(storedKey(assetId)).toEqual(after);
  });

  it('leaves an asset with no keys untouched', () => {
    addAsset();

    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(0);
  });

  it('keeps a key written with another secret instead of failing to start', () => {
    const assetId = addAsset();
    const foreign = encryptSecret('SOMEBODY-ELSES', OTHER_SECRET);
    handle.db.insert(keys).values({ assetId, keyValue: foreign }).run();

    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(0);
    // Untouched, fingerprint and all: the value cannot be read, so it cannot be fingerprinted either.
    expect(storedKey(assetId)).toEqual({ key_fingerprint: null, key_value: foreign });
    expect(adminAsset(handle.db, assetId, SECRET)?.keys[0].keyValue).toMatch(/unreadable/);
  });

  it('encrypts a clear value that happens to start with the version prefix', () => {
    const assetId = addAsset();
    insertLegacyKey(assetId, 'v1:not-base64-at-all');

    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(1);
    expect(storedKey(assetId).key_value).toMatch(/^v1:/);
    expect(storedKey(assetId).key_value).not.toContain('not-base64');
    expect(adminAsset(handle.db, assetId, SECRET)?.keys[0].keyValue).toBe('v1:not-base64-at-all');
  });

  it('encrypts a duplicate the fingerprint index can only hold once', () => {
    const assetId = addAsset();
    insertLegacyKey(assetId, 'SAME-LEGACY-KEY');
    insertLegacyKey(assetId, 'SAME-LEGACY-KEY');

    // Both are encrypted; only the first can carry the fingerprint, which the
    // unique index would otherwise refuse.
    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(2);

    const rows = handle.sqlite
      .prepare('select key_fingerprint, key_value from keys where asset_id = ? order by id')
      .all(assetId) as { key_fingerprint: string | null; key_value: string }[];

    expect(rows[0].key_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1].key_fingerprint).toBeNull();
    for (const row of rows)
      expect(row.key_value).toMatch(/^v1:/);

    expect(adminAsset(handle.db, assetId, SECRET)?.keys.map(key => key.keyValue))
      .toEqual(['SAME-LEGACY-KEY', 'SAME-LEGACY-KEY']);

    // And a second start leaves both alone.
    expect(encryptLegacyKeys(handle.db, SECRET)).toBe(0);
  });
});

describe('the limiter store', () => {
  const NOW = 1_700_000_000_000;

  it('keeps each limiter and each key apart, oldest first', () => {
    const store = createAttemptStore(handle.db);
    store.save('login', 'a', [NOW + 20, NOW]);
    store.save('login', 'b', [NOW + 30]);
    store.save('metadata', 'a', [NOW + 40]);

    expect(store.load('login', 'a')).toEqual([NOW, NOW + 20]);
    expect(store.load('login', 'b')).toEqual([NOW + 30]);
    expect(store.load('metadata', 'a')).toEqual([NOW + 40]);
  });

  it('replaces a key\'s window instead of appending to it', () => {
    const store = createAttemptStore(handle.db);
    store.save('login', 'a', [NOW, NOW + 1]);
    store.save('login', 'a', []);

    expect(store.load('login', 'a')).toEqual([]);
  });

  it('prunes only the limiter it was asked about', () => {
    const store = createAttemptStore(handle.db);
    store.save('login', 'a', [NOW]);
    store.save('metadata', 'a', [NOW]);
    store.prune('login', NOW + 1);

    expect(store.load('login', 'a')).toEqual([]);
    expect(store.load('metadata', 'a')).toEqual([NOW]);
  });

  it('still holds the attempts when a new store opens the same database', () => {
    // What the app does on every start: a restart must not clear the window.
    createAttemptStore(handle.db).save('login', 'a', [NOW]);

    expect(createAttemptStore(handle.db).load('login', 'a')).toEqual([NOW]);
  });
});

describe('the authors behind the prizes', () => {
  let prize = 0;

  function addPrize(publisher: string | null): number {
    prize += 1;

    return handle.db
      .insert(assets)
      .values({
        name: `Prize ${prize}`,
        assetId: `prize-${prize}`,
        assetUrl: 'https://assetstore.unity.com/packages/tools/a-prize-1',
        publisher,
      })
      .returning()
      .get()
      .id;
  }

  function addAuthor(overrides: Partial<Parameters<typeof createAuthor>[1]> = {}) {
    return createAuthor(handle.db, {
      discordHandle: 'priya',
      discordId: '123456789012345678',
      publisher: 'VIVID Arts',
      ...overrides,
    });
  }

  it('finds an author by publisher whatever the case and spacing', () => {
    const author = addAuthor();

    expect(findAuthorByPublisher(handle.db, '  vivid arts ')?.id).toBe(author.id);
    expect(findAuthorByPublisher(handle.db, 'VIVID ARTS')?.id).toBe(author.id);
    expect(findAuthorByPublisher(handle.db, 'Someone else')).toBeNull();
    expect(findAuthorByPublisher(handle.db, null)).toBeNull();
  });

  it('attaches every prize published under a string, and reports how many', () => {
    const author = addAuthor();
    const first = addPrize('VIVID Arts');
    const second = addPrize('vivid arts');
    const other = addPrize('Other Studio');
    const noPublisher = addPrize(null);

    expect(attachAuthorByPublisher(handle.db, author.id, 'VIVID ARTS')).toBe(2);

    const linked = (id: number) => handle.db.select().from(assets).where(eq(assets.id, id)).get()?.authorId;
    expect([linked(first), linked(second)]).toEqual([author.id, author.id]);
    expect([linked(other), linked(noPublisher)]).toEqual([null, null]);
  });

  it('deletes the author only, leaving the prize and its keys in place', () => {
    const author = addAuthor();
    const id = addPrize('VIVID Arts');
    attachAuthorByPublisher(handle.db, author.id, 'VIVID Arts');
    handle.db.insert(keys).values({ assetId: id, keyValue: 'v1:ciphertext' }).run();

    expect(deleteAuthor(handle.db, author.id)).toBe(1);
    expect(handle.db.select().from(assets).where(eq(assets.id, id)).get()?.authorId).toBeNull();
    expect(handle.db.select().from(keys).all()).toHaveLength(1);
    expect(deleteAuthor(handle.db, author.id)).toBeNull();
  });

  it('counts each author\'s prizes, and says nothing rather than guessing', () => {
    const busy = addAuthor({ discordHandle: 'busy', publisher: 'Studio One' });
    addAuthor({ discordHandle: 'idle', discordId: null });
    addPrize('VIVID Arts');
    attachAuthorByPublisher(handle.db, busy.id, 'VIVID Arts');

    expect(listAuthors(handle.db).map(author => [author.label, author.assetCount])).toEqual([
      ['busy', 1],
      ['idle', 0],
    ]);
  });

  it('names an author by their handle, then by their publisher', () => {
    const named = addAuthor({ discordHandle: 'kim', publisher: 'VIVID Arts' });
    const namedByPublisher = addAuthor({ discordHandle: null, discordId: null, publisher: 'Other Studio' });
    const namedById = addAuthor({ discordHandle: null, discordId: '999999999999999999', publisher: null });

    const labels = new Map(listAuthors(handle.db).map(author => [author.id, author.label]));

    expect(labels.get(named.id)).toBe('kim');
    expect(labels.get(namedByPublisher.id)).toBe('Other Studio');
    // An id alone is a poor name, but it is what the record has.
    expect(labels.get(namedById.id)).toBe(`Author #${namedById.id}`);
  });
});
