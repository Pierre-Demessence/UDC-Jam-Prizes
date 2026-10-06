// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from './db.ts';

import { connectDatabase } from './db.ts';
import { importAssets } from './import-assets.ts';
import { createAuthor } from './repository.ts';
import { testConfig } from './testing.ts';

const fixture = readFileSync(new URL('./fixtures/asset-page.html', import.meta.url), 'utf8');

/** A page for a given asset id, so a batch has distinct prizes. */
function pageFor(id: string): string {
  return fixture
    .replaceAll('341308', id)
    .replaceAll('Text Animator for Unity | UI Toolkit and Text Mesh Pro', `Prize ${id}`);
}

const pageFetcher = (async (input: URL | RequestInfo) => {
  const href = String(input);
  const id = /-(\d+)\/?$/.exec(href)?.[1] ?? '0';

  // One URL in the tests stands for a page Unity answers without metadata.
  return new Response(id === '404' ? '<html><body>nothing here</body></html>' : pageFor(id), { status: 200 });
}) as typeof fetch;

const url = (id: string): string => `https://assetstore.unity.com/packages/tools/a-prize-${id}`;

// These tests never look at keys, but importing writes through the same path
// that encrypts them, so the secret has to be there.
const SECRET = testConfig().keyEncryptionSecret;

let handle: DatabaseHandle;

beforeEach(() => {
  handle = connectDatabase(':memory:');
});

afterEach(() => {
  handle.close();
});

describe('importing several links', () => {
  it('adds one prize per link, in the order they were pasted', async () => {
    const outcome = await importAssets(handle.db, pageFetcher, [url('111'), url('222'), url('333')], SECRET);

    expect(outcome.added).toBe(3);
    expect(outcome.failed).toBe(0);
    expect(outcome.results.map(result => result.name)).toEqual(['Prize 111', 'Prize 222', 'Prize 333']);
    expect(outcome.results.every(result => result.status === 'added')).toBe(true);
  });

  it('fills each prize from the page it read', async () => {
    await importAssets(handle.db, pageFetcher, [url('111')], SECRET);

    const row = handle.sqlite.prepare('select name, asset_id, price_cents, category from assets').get();

    expect(row).toEqual({
      name: 'Prize 111',
      asset_id: '111',
      category: 'tools',
      price_cents: 6500,
    });
  });

  it('makes the author the page names, and attaches the prize to it', async () => {
    await importAssets(handle.db, pageFetcher, [url('111')], SECRET);

    const author = handle.sqlite.prepare('select id, publisher, publisher_id from authors').get() as { id: number; publisher: string; publisher_id: string };
    const row = handle.sqlite.prepare('select author_id from assets').get() as { author_id: number };

    expect(author).toMatchObject({ publisher: 'Febucci', publisher_id: '45737' });
    expect(row.author_id).toBe(author.id);
  });

  it('makes one author for a batch of prizes that share a publisher', async () => {
    await importAssets(handle.db, pageFetcher, [url('111'), url('222'), url('333')], SECRET);

    expect(handle.sqlite.prepare('select count(*) as n from authors').get()).toEqual({ n: 1 });
    expect(handle.sqlite.prepare('select count(*) as n from assets where author_id is null').get()).toEqual({ n: 0 });
  });

  it('attaches to the author the list already has, and fills in the id they lacked', async () => {
    const existing = createAuthor(handle.db, { discordHandle: 'priya', discordId: null, publisher: 'Febucci', publisherId: null });

    await importAssets(handle.db, pageFetcher, [url('111')], SECRET);

    expect(handle.sqlite.prepare('select count(*) as n from authors').get()).toEqual({ n: 1 });
    expect(handle.sqlite.prepare('select author_id from assets').get()).toEqual({ author_id: existing.id });
    expect(handle.sqlite.prepare('select publisher_id from authors').get()).toEqual({ publisher_id: '45737' });
  });

  it('counts a link it already has as a duplicate instead of adding it twice', async () => {
    await importAssets(handle.db, pageFetcher, [url('111')], SECRET);
    const again = await importAssets(handle.db, pageFetcher, [url('111')], SECRET);

    expect(again.duplicates).toBe(1);
    expect(again.added).toBe(0);
    expect(again.results[0].message).toBe('Already in the list.');
    expect(handle.sqlite.prepare('select count(*) as n from assets').get()).toEqual({ n: 1 });
  });

  it('reports a link that is not an Asset Store page, and still reads the rest', async () => {
    const outcome = await importAssets(handle.db, pageFetcher, ['https://example.com/steal', url('222')], SECRET);

    expect(outcome.results[0]).toMatchObject({ status: 'failed' });
    expect(outcome.results[0].message).toMatch(/assetstore\.unity\.com/);
    expect(outcome.results[1]).toMatchObject({ status: 'added' });
    expect(outcome.added).toBe(1);
    expect(outcome.failed).toBe(1);
  });

  it('reports a page with no metadata', async () => {
    const outcome = await importAssets(handle.db, pageFetcher, [url('404')], SECRET);

    expect(outcome.results[0].status).toBe('failed');
    expect(outcome.results[0].message).toMatch(/no asset metadata/i);
  });

  it('reports a link it cannot reach at all', async () => {
    const brokenFetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const outcome = await importAssets(handle.db, brokenFetch, [url('111')], SECRET);

    expect(outcome.results[0]).toMatchObject({ message: 'Could not reach the Asset Store.', status: 'failed' });
  });

  it('keeps a failure from hiding a later success, even when the batch is large', async () => {
    const urls = ['https://example.com/nope', url('111'), url('222'), url('333'), url('444')];
    const outcome = await importAssets(handle.db, pageFetcher, urls, SECRET);

    expect(outcome).toMatchObject({ added: 4, duplicates: 0, failed: 1 });
    expect(outcome.results.map(result => result.status))
      .toEqual(['failed', 'added', 'added', 'added', 'added']);
  });

  it('does nothing at all with an empty list', async () => {
    const outcome = await importAssets(handle.db, pageFetcher, [], SECRET);

    expect(outcome).toEqual({ added: 0, duplicates: 0, failed: 0, results: [] });
  });
});
