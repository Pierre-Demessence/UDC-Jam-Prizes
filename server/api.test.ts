// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseHandle } from './db.ts';

import { createApp } from './app.ts';
import { connectDatabase } from './db.ts';
import { testConfig } from './testing.ts';

const PASSWORD = 'test-password';
const PAGE_URL = 'https://assetstore.unity.com/packages/tools/gui/text-animator-for-unity-ui-toolkit-and-text-mesh-pro-341308';
const fixture = readFileSync(new URL('./fixtures/asset-page.html', import.meta.url), 'utf8');

// `id` and `name` first, then alphabetical: the house key order.
const PUBLIC_FIELDS = ['id', 'name', 'assetId', 'assetUrl', 'category', 'imageUrl', 'priceCents', 'publisher', 'publisherId'];

let handle: DatabaseHandle;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  handle = connectDatabase(':memory:');
  app = createApp({
    config: testConfig({ adminPassword: PASSWORD }),
    fetchImpl: (async () => new Response(fixture, { status: 200 })) as typeof fetch,
    handle,
  });
});

afterEach(() => {
  handle.close();
});

function json(body: unknown, cookie?: string): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    method: 'POST',
  };
}

async function signIn(): Promise<string> {
  const response = await app.request('/api/session', json({ password: PASSWORD }));
  const cookie = response.headers.get('set-cookie') ?? '';

  return cookie.split(';')[0];
}

/** Creates the asset from the captured page, the way the admin form does. */
async function addAsset(cookie: string): Promise<Record<string, unknown>> {
  const metadata = await app.request('/api/metadata', json({ url: PAGE_URL }, cookie));
  const { metadata: fields } = await metadata.json() as { metadata: Record<string, unknown> };
  const response = await app.request('/api/admin/assets', json({ ...fields, notes: 'internal note' }, cookie));

  return (await response.json() as { asset: Record<string, unknown> }).asset;
}

/** Creates an author the way the panel does, with the fields a test asks for. */
async function addAuthor(cookie: string, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const response = await app.request('/api/admin/authors', json({
    discordHandle: 'priya',
    discordId: '123456789012345678',
    publisher: 'VIVID Arts',
    ...overrides,
  }, cookie));

  return (await response.json() as { author: Record<string, unknown> }).author;
}

describe('the session endpoints', () => {
  it('rejects a wrong password', async () => {
    const response = await app.request('/api/session', json({ password: 'nope' }));

    expect(response.status).toBe(401);
  });

  it('sets a cookie the client cannot read, and only for this site', async () => {
    const response = await app.request('/api/session', json({ password: PASSWORD }));
    const cookie = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
  });

  it('reports whether the caller is signed in', async () => {
    const anonymous = await app.request('/api/session');
    const cookie = await signIn();
    const admin = await app.request('/api/session', { headers: { cookie } });

    expect(await anonymous.json()).toEqual({ authenticated: false });
    expect(await admin.json()).toEqual({ authenticated: true });
  });

  it('reports a session as gone once it is signed out', async () => {
    const cookie = await signIn();
    await app.request('/api/session', { headers: { cookie }, method: 'DELETE' });

    const response = await app.request('/api/session', { headers: { cookie: cookie.replace(/=.*/, '=') } });
    expect(await response.json()).toEqual({ authenticated: false });
  });

  it('stops honouring a cookie issued before the password changed', async () => {
    const cookie = await signIn();
    const rotated = createApp({
      config: testConfig({ adminPassword: 'a-new-password' }),
      fetchImpl: (async () => new Response(fixture, { status: 200 })) as typeof fetch,
      handle,
    });

    const session = await rotated.request('/api/session', { headers: { cookie } });
    const admin = await rotated.request('/api/admin/assets', { headers: { cookie } });

    expect(await session.json()).toEqual({ authenticated: false });
    expect(admin.status).toBe(401);
  });

  it('stops answering after too many wrong passwords', async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      await app.request('/api/session', json({ password: 'nope' }));

    const blocked = await app.request('/api/session', json({ password: PASSWORD }));

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toHaveProperty('error');
  });

  it('keeps that lockout when the server restarts', async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      await app.request('/api/session', json({ password: 'nope' }));

    // A new app on the same database is what a restart looks like: the window
    // lives in SQLite, so the lockout survives it.
    const afterRestart = createApp({
      config: testConfig({ adminPassword: PASSWORD }),
      fetchImpl: (async () => new Response(fixture, { status: 200 })) as typeof fetch,
      handle,
    });
    const blocked = await afterRestart.request('/api/session', json({ password: PASSWORD }));

    expect(blocked.status).toBe(429);
  });
});

describe('the admin gate', () => {
  it('refuses every admin route without a session', async () => {
    const routes: [string, RequestInit][] = [
      ['/api/admin/assets', { method: 'GET' }],
      ['/api/admin/assets', { method: 'POST' }],
      ['/api/admin/assets/1', { method: 'PATCH' }],
      ['/api/admin/assets/1', { method: 'DELETE' }],
      ['/api/admin/assets/1/keys', { method: 'POST' }],
      ['/api/admin/assets/1/keys/1', { method: 'DELETE' }],
      ['/api/admin/assets/1/needed', { method: 'PUT' }],
      ['/api/admin/assets/1/hidden', { method: 'PUT' }],
      ['/api/admin/authors', { method: 'GET' }],
      ['/api/admin/authors', { method: 'POST' }],
      ['/api/admin/authors/1', { method: 'PATCH' }],
      ['/api/admin/authors/1', { method: 'DELETE' }],
      ['/api/admin/authors/1/attach', { method: 'POST' }],
      ['/api/metadata', { method: 'POST' }],
    ];

    for (const [path, init] of routes) {
      const response = await app.request(path, init);
      expect([path, response.status]).toEqual([path, 401]);
    }
  });

  it('refuses a cookie that was tampered with', async () => {
    const cookie = await signIn();
    const forged = `${cookie}tampered`;
    const response = await app.request('/api/admin/assets', { headers: { cookie: forged } });

    expect(response.status).toBe(401);
  });
});

describe('the public catalogue', () => {
  it('leaves a public visitor with the nine public fields and nothing else', async () => {
    const cookie = await signIn();
    await addAsset(cookie);

    const response = await app.request('/api/assets');
    const body = await response.json() as { assets: Record<string, unknown>[]; totals: unknown };

    expect(response.status).toBe(200);
    expect(Object.keys(body.assets[0])).toEqual(PUBLIC_FIELDS);
    expect(JSON.stringify(body)).not.toContain('internal note');
  });

  it('sums the prices for the header', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    expect(asset.priceCents).toBe(6500);

    const body = await (await app.request('/api/assets')).json() as { totals: { count: number; priceCents: number } };

    expect(body.totals).toEqual({ count: 1, priceCents: 6500 });
  });

  it('leaves an unattached prize named but unlinked', async () => {
    const cookie = await signIn();
    // Entered by hand: the metadata read is what would have made the author.
    await app.request('/api/admin/assets', json({
      name: 'A Prize',
      assetId: '169047',
      assetUrl: 'https://assetstore.unity.com/packages/2d/a-prize-169047',
      publisher: 'Febucci',
    }, cookie));

    const body = await (await app.request('/api/assets')).json() as { assets: { publisher: string | null; publisherId: string | null }[] };

    // The id belongs to the author: a prize with no author keeps the name from
    // the page and simply has no store link.
    expect(body.assets[0].publisher).toBe('Febucci');
    expect(body.assets[0].publisherId).toBeNull();
  });

  it('counts an asset with no price in the total only by its own count', async () => {
    const cookie = await signIn();
    await app.request('/api/admin/assets', json({
      name: 'Free Thing',
      assetId: '42',
      assetUrl: 'https://assetstore.unity.com/packages/tools/gui/free-thing-42',
    }, cookie));

    const body = await (await app.request('/api/assets')).json() as { totals: { count: number; priceCents: number } };

    expect(body.totals).toEqual({ count: 1, priceCents: 0 });
  });
});

describe('the metadata endpoint', () => {
  it('prefills the admin form from the page', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/metadata', json({ url: PAGE_URL }, cookie));
    const body = await response.json() as { existingAsset: unknown; metadata: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.existingAsset).toBeNull();
    expect(body.metadata).toMatchObject({ name: expect.stringContaining('Text Animator'), assetId: '341308', priceCents: 6500, publisherId: '45737' });
  });

  it('warns when the asset is already in the list', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    const body = await (await app.request('/api/metadata', json({ url: PAGE_URL }, cookie))).json() as {
      existingAsset: { id: number };
    };

    expect(body.existingAsset.id).toBe(asset.id);
  });

  it('refuses a URL that is not an Asset Store page', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/metadata', json({ url: 'https://example.com/steal' }, cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('assetstore.unity.com'));
  });
});

describe('editing assets', () => {
  it('refuses the same asset twice', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const response = await app.request('/api/admin/assets', json({
      name: 'Copy',
      assetId: asset.assetId,
      assetUrl: asset.assetUrl,
    }, cookie));

    expect(response.status).toBe(409);
  });

  it('updates a field and reports the new state', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const response = await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, name: 'Renamed' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect(((await response.json()) as { asset: { name: string } }).asset.name).toBe('Renamed');
  });

  it('rejects an incomplete asset with a readable message', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/admin/assets', json({ name: '   ' }, cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('required'));
  });

  it('deletes the asset with its keys, and leaves its author alone', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const author = await addAuthor(cookie);
    await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, authorId: author.id }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });
    await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1' }, cookie));

    const deleted = await app.request(`/api/admin/assets/${asset.id}`, { headers: { cookie }, method: 'DELETE' });
    const catalogue = await (await app.request('/api/assets')).json() as { totals: { count: number } };
    const authors = await (await app.request('/api/admin/authors', { headers: { cookie } }))
      .json() as { authors: { assetCount: number; id: number }[] };

    expect(deleted.status).toBe(204);
    expect(catalogue.totals.count).toBe(0);
    expect(handle.sqlite.prepare('select count(*) as n from keys').get()).toEqual({ n: 0 });
    // An author outlives the prizes: this is the opposite direction from the keys.
    expect(authors.authors.find(row => row.id === author.id)?.assetCount).toBe(0);
  });
});

describe('the keys behind a prize', () => {
  async function assetWithKeys(cookie: string): Promise<{ assetId: number; keyId: number }> {
    const asset = await addAsset(cookie);
    const response = await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1\nKEY-2' }, cookie));
    const body = await response.json() as { asset: { keys: { id: number }[] } };

    return { assetId: asset.id as number, keyId: body.asset.keys[0].id };
  }

  it('removes one key and leaves the others alone', async () => {
    const cookie = await signIn();
    const { assetId, keyId } = await assetWithKeys(cookie);

    const response = await app.request(`/api/admin/assets/${assetId}/keys/${keyId}`, { headers: { cookie }, method: 'DELETE' });
    const body = await response.json() as { asset: { keys: { keyValue: string }[] } };

    expect(response.status).toBe(200);
    expect(body.asset.keys.map(key => key.keyValue)).toEqual(['KEY-2']);
    expect(handle.sqlite.prepare('select count(*) as n from keys').get()).toEqual({ n: 1 });
  });

  it('stores pasted keys and skips the ones already there', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    const first = await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1\nKEY-2' }, cookie));
    const second = await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-2\nKEY-3' }, cookie));

    expect((await first.json() as { added: number }).added).toBe(2);
    expect(await second.json()).toMatchObject({ added: 1, skipped: 1 });
  });

  it('keeps the key values encrypted on disk', async () => {
    const cookie = await signIn();
    const { assetId } = await assetWithKeys(cookie);

    const rows = handle.sqlite
      .prepare('select key_value, key_fingerprint from keys where asset_id = ? order by id')
      .all(assetId) as { key_fingerprint: string; key_value: string }[];

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.key_value).toMatch(/^v1:/);
      expect(row.key_value).not.toContain('KEY-');
      // A fingerprint, not the key: recognised without being reversible.
      expect(row.key_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(rows[0].key_value).not.toBe(rows[1].key_value);
  });

  it('hands the readable key back to the admin, and never to a public visitor', async () => {
    const cookie = await signIn();
    const { assetId } = await assetWithKeys(cookie);

    const adminBody = await (await app.request('/api/admin/assets', { headers: { cookie } }))
      .json() as { assets: { id: number; keys: { keyValue: string }[] }[] };

    expect(adminBody.assets.find(a => a.id === assetId)?.keys.map(key => key.keyValue))
      .toEqual(['KEY-1', 'KEY-2']);

    const publicBody = await (await app.request('/api/assets')).json() as { assets: Record<string, unknown>[] };
    // Neither the key nor its stored form: the public list has no key fields at all.
    expect(JSON.stringify(publicBody)).not.toContain('KEY-');
    expect(JSON.stringify(publicBody)).not.toContain('v1:');
  });

  it('still spots a repeated key although its ciphertext differs every time', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'same-key-here' }, cookie));
    const again = await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'same-key-here' }, cookie));

    expect(await again.json()).toMatchObject({ added: 0, skipped: 1 });
  });

  it('says a key is unreadable when the encryption secret no longer opens it', async () => {
    const cookie = await signIn();
    const { assetId } = await assetWithKeys(cookie);
    const stored = (handle.sqlite.prepare('select key_value from keys where asset_id = ?').get(assetId) as { key_value: string }).key_value;

    // Edit the ciphertext the way a changed secret or a corrupted row would: well
    // formed, but it no longer authenticates.
    handle.sqlite.prepare('update keys set key_value = ? where asset_id = ?')
      .run(`${stored.slice(0, -4)}AAAA`, assetId);

    const body = await (await app.request('/api/admin/assets', { headers: { cookie } }))
      .json() as { assets: { id: number; keys: { keyValue: string }[] }[] };

    expect(body.assets.find(a => a.id === assetId)?.keys[0].keyValue).toMatch(/unreadable/);
  });

  it('stores how many keys the winners asked for, without publishing it', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    const response = await app.request(`/api/admin/assets/${asset.id}/needed`, {
      body: JSON.stringify({ needed: 4 }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PUT',
    });

    expect(((await response.json()) as { asset: { needed: number } }).asset.needed).toBe(4);

    // Planning information: the public side has no such field at all.
    const publicBody = await (await app.request('/api/assets')).json() as { assets: Record<string, unknown>[] };
    expect(publicBody.assets[0]).not.toHaveProperty('needed');
  });

  it('refuses a number of keys that is not a whole, sane count', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    for (const needed of [-1, 1.5, 'many', 1000]) {
      const response = await app.request(`/api/admin/assets/${asset.id}/needed`, {
        body: JSON.stringify({ needed }),
        headers: { 'content-type': 'application/json', cookie },
        method: 'PUT',
      });

      expect(response.status, String(needed)).toBe(400);
    }
  });

  it('refuses to set a request on a prize that does not exist', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/admin/assets/9999/needed', {
      body: JSON.stringify({ needed: 1 }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PUT',
    });

    expect(response.status).toBe(404);
  });

  it('stores the author of a prize without publishing any of it', async () => {
    const cookie = await signIn();
    const author = await addAuthor(cookie);
    const asset = await addAsset(cookie);

    const response = await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, authorId: author.id }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });
    const admin = await response.json() as { asset: { author: { assetCount: number; label: string } } };
    const publicBody = await (await app.request('/api/assets')).text();

    // Named by the handle, since that is what the author was given.
    expect(admin.asset.author.label).toBe('priya');
    expect(admin.asset.author.assetCount).toBe(1);
    // The handle and the id are private: neither may reach the public list.
    expect(publicBody).not.toContain('priya');
    expect(publicBody).not.toContain('123456789012345678');
  });
});

describe('the authors behind the prizes', () => {
  it('refuses a second author on the same publisher, whatever the case', async () => {
    const cookie = await signIn();
    await addAuthor(cookie);

    const same = await app.request('/api/admin/authors', json({ publisher: 'VIVID Arts' }, cookie));
    const otherCase = await app.request('/api/admin/authors', json({ publisher: 'vivid arts' }, cookie));

    expect([same.status, otherCase.status]).toEqual([409, 409]);
    expect(await same.json()).toHaveProperty('error', expect.stringContaining('VIVID Arts'));
  });

  it('refuses an author with nothing to be found by', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/admin/authors', json({}, cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('needs a store publisher'));
  });

  it('refuses a Discord id that is not a snowflake', async () => {
    const cookie = await signIn();
    const tooShort = await app.request('/api/admin/authors', json({ discordId: '1234567890123456' }, cookie));
    const tooLong = await app.request('/api/admin/authors', json({ discordId: '123456789012345678901' }, cookie));
    const notDigits = await app.request('/api/admin/authors', json({ discordId: 'priya#1' }, cookie));

    expect([tooShort.status, tooLong.status, notDigits.status]).toEqual([400, 400, 400]);
    expect(await notDigits.json()).toHaveProperty('error', expect.stringContaining('17 to 20 digit'));
  });

  it('refuses a Discord handle or id another author already has', async () => {
    const cookie = await signIn();
    await addAuthor(cookie);

    // The stored handle is lower-case; the clash must not care about the case.
    const handle = await app.request('/api/admin/authors', json({ discordHandle: 'Priya' }, cookie));
    const id = await app.request('/api/admin/authors', json({ discordId: '123456789012345678' }, cookie));

    expect([handle.status, id.status]).toEqual([409, 409]);
    expect(await handle.json()).toHaveProperty('error', expect.stringContaining('handle'));
    expect(await id.json()).toHaveProperty('error', expect.stringContaining('id'));
  });

  it('refuses a publisher id that is not the number in the store address', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/admin/authors', json({
      publisher: 'Febucci',
      publisherId: 'https://assetstore.unity.com/publishers/45737',
    }, cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('like 45737'));
  });

  it('refuses a store publisher id another author already holds', async () => {
    const cookie = await signIn();
    await addAuthor(cookie, { publisher: 'Febucci', publisherId: '45737' });

    const response = await app.request('/api/admin/authors', json({ discordHandle: 'someone-else', publisherId: '45737' }, cookie));

    // A readable 409, not the driver's error surfacing as a 500.
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('store publisher id'));
  });

  it('lets an author keep its own publisher id when it is edited', async () => {
    const cookie = await signIn();
    const author = await addAuthor(cookie, { publisher: 'Febucci', publisherId: '45737' });

    const response = await app.request(`/api/admin/authors/${author.id}`, {
      body: JSON.stringify({ publisher: 'Febucci', publisherId: '45737' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('author.publisherId', '45737');
  });

  it('makes the author of a page whose publisher the list does not know', async () => {
    const cookie = await signIn();

    const lookup = await app.request('/api/metadata', json({ url: PAGE_URL }, cookie));
    const body = await lookup.json() as { metadata: { authorId: number | null } };
    const authors = await (await app.request('/api/admin/authors', { headers: { cookie } }))
      .json() as { authors: { id: number; publisher: string | null; publisherId: string | null }[] };

    expect(authors.authors).toHaveLength(1);
    expect(authors.authors[0]).toMatchObject({ publisher: 'Febucci', publisherId: '45737' });
    expect(body.metadata.authorId).toBe(authors.authors[0].id);
  });

  it('preselects the author a page belongs to, and fills in the id they lacked', async () => {
    const cookie = await signIn();
    const author = await addAuthor(cookie, { publisher: 'Febucci' });

    const lookup = await app.request('/api/metadata', json({ url: PAGE_URL }, cookie));
    const body = await lookup.json() as { metadata: { authorId: number | null } };
    const authors = await (await app.request('/api/admin/authors', { headers: { cookie } }))
      .json() as { authors: { id: number; publisherId: string | null }[] };

    // Found by name rather than made again, and the store id the page knows is
    // filled in on the record, which is what its link needs.
    expect(body.metadata.authorId).toBe(author.id);
    expect(authors.authors).toHaveLength(1);
    expect(authors.authors[0].publisherId).toBe('45737');
  });

  it('keeps the publisher id on the author and serves it with their prizes', async () => {
    const cookie = await signIn();
    const author = await addAuthor(cookie, { publisher: 'Febucci', publisherId: '45737' });
    await addAsset(cookie);

    const catalogue = await (await app.request('/api/assets')).json() as { assets: { publisherId: string | null }[] };

    // Stored on the author, joined onto the prize for the public page.
    expect(author.publisherId).toBe('45737');
    expect(catalogue.assets[0].publisherId).toBe('45737');
  });

  it('attaches every prize published under a publisher in one action', async () => {
    const cookie = await signIn();
    // Created by hand: a prize from before its author's record existed, which is
    // what the attach action is for.
    const created = await (await app.request('/api/admin/assets', json({
      name: 'A Prize',
      assetId: '169047',
      assetUrl: 'https://assetstore.unity.com/packages/2d/a-prize-169047',
      publisher: 'Febucci',
    }, cookie))).json() as { asset: { id: number } };
    const author = await addAuthor(cookie, { publisher: 'Febucci' });

    const attached = await app.request(`/api/admin/authors/${author.id}/attach`, json({ publisher: 'Febucci' }, cookie));
    const body = await attached.json() as { assets: { author: { id: number } | null; id: number }[]; attached: number };
    const missed = await app.request(`/api/admin/authors/${author.id}/attach`, json({ publisher: 'Nobody at all' }, cookie));

    expect(body.attached).toBe(1);
    expect(body.assets.find(row => row.id === created.asset.id)?.author?.id).toBe(author.id);
    expect((await missed.json() as { attached: number }).attached).toBe(0);
  });

  it('deletes the author only, leaving the prize with no author', async () => {
    const cookie = await signIn();
    const author = await addAuthor(cookie);
    const asset = await addAsset(cookie);
    await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, authorId: author.id }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    const response = await app.request(`/api/admin/authors/${author.id}`, { headers: { cookie }, method: 'DELETE' });
    const body = await response.json() as { assets: { author: unknown; id: number }[]; unlinked: number };

    expect(body.unlinked).toBe(1);
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0].author).toBeNull();
  });
});

describe('hiding a prize from the public list', () => {
  async function setHidden(cookie: string, id: unknown, hidden: unknown): Promise<Response> {
    return app.request(`/api/admin/assets/${id}/hidden`, {
      body: JSON.stringify({ hidden }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PUT',
    });
  }

  it('takes the prize off the public list but keeps it in the admin one', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    const response = await setHidden(cookie, asset.id, true);
    expect(((await response.json()) as { asset: { hidden: boolean } }).asset.hidden).toBe(true);

    const publicBody = await (await app.request('/api/assets')).json() as {
      assets: unknown[];
      totals: { count: number; priceCents: number };
    };
    expect(publicBody.assets).toHaveLength(0);
    // Off the catalogue means out of the totals too: it is no longer on the page.
    expect(publicBody.totals).toEqual({ count: 0, priceCents: 0 });

    const adminBody = await (await app.request('/api/admin/assets', { headers: { cookie } }))
      .json() as { assets: { hidden: boolean; id: number }[] };
    expect(adminBody.assets.find(row => row.id === asset.id)?.hidden).toBe(true);
  });

  it('puts the prize back with its author and keys untouched', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const author = await addAuthor(cookie);
    await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, authorId: author.id }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });
    await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1' }, cookie));

    await setHidden(cookie, asset.id, true);
    await setHidden(cookie, asset.id, false);

    const publicBody = await (await app.request('/api/assets')).json() as { assets: { id: number }[]; totals: { count: number } };
    expect(publicBody.assets.map(row => row.id)).toEqual([asset.id]);
    expect(publicBody.totals.count).toBe(1);

    const adminBody = await (await app.request('/api/admin/assets', { headers: { cookie } }))
      .json() as { assets: { author: unknown; id: number; keys: unknown[] }[] };
    const row = adminBody.assets.find(candidate => candidate.id === asset.id);
    expect(row?.author).not.toBeNull();
    expect(row?.keys).toHaveLength(1);
  });

  it('leaves the flag alone when the prize is edited', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    await setHidden(cookie, asset.id, true);

    // The edit form carries the whole asset back; a stray `hidden` key in it must
    // not turn a hidden prize visible again.
    const response = await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, name: 'Renamed', hidden: false }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect((await response.json() as { asset: { name: string; hidden: boolean } }).asset)
      .toMatchObject({ name: 'Renamed', hidden: true });
  });

  it('refuses a value that is not a boolean', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);

    for (const hidden of ['yes', 1, null]) {
      const response = await setHidden(cookie, asset.id, hidden);
      expect(response.status, String(hidden)).toBe(400);
    }
  });

  it('refuses to hide a prize that does not exist', async () => {
    const cookie = await signIn();
    const response = await setHidden(cookie, 9999, true);

    expect(response.status).toBe(404);
  });
});

describe('editing a prize onto another prize\'s identity', () => {
  it('refuses a Unity id that another prize already uses', async () => {
    const cookie = await signIn();
    const first = await addAsset(cookie);
    const created = await app.request('/api/admin/assets', json({
      name: 'Another Tool',
      assetId: '999',
      assetUrl: 'https://assetstore.unity.com/packages/tools/another-tool-999',
    }, cookie));
    const other = (await created.json() as { asset: { id: number } }).asset;

    const response = await app.request(`/api/admin/assets/${other.id}`, {
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Another Tool',
        assetId: first.assetId,
        assetUrl: 'https://assetstore.unity.com/packages/tools/another-tool-999',
      }),
    });

    expect(response.status).toBe(409);
  });

  it('still lets a prize keep its own Unity id while being edited', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const response = await app.request(`/api/admin/assets/${asset.id}`, {
      body: JSON.stringify({ ...asset, name: 'Text Animator, renamed' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { asset: { name: string } }).asset.name).toBe('Text Animator, renamed');
  });
});

describe('the bulk import', () => {
  it('refuses a paste from someone who is not the admin', async () => {
    const response = await app.request('/api/admin/import', json({ urls: PAGE_URL }));

    expect(response.status).toBe(401);
  });

  it('adds the links and hands back the whole list', async () => {
    const cookie = await signIn();
    const second = 'https://assetstore.unity.com/packages/tools/gui/another-slug-341308';
    const response = await app.request('/api/admin/import', json({ urls: `${PAGE_URL}\n${second}` }, cookie));
    const body = await response.json() as { added: number; assets: unknown[]; duplicates: number; results: unknown[] };

    expect(response.status).toBe(201);
    // Two different links here, but the stub answers both with the same page, so
    // the second one is recognised as the prize already in the list.
    expect(body).toMatchObject({ added: 1, duplicates: 1 });
    expect(body.results).toHaveLength(2);
    expect(body.assets).toHaveLength(1);
  });

  it('ignores the same link pasted twice', async () => {
    const cookie = await signIn();
    const response = await app.request('/api/admin/import', json({ urls: `${PAGE_URL}\n${PAGE_URL}` }, cookie));

    expect(await response.json()).toMatchObject({ added: 1, duplicates: 0 });
  });

  it('refuses a paste bigger than it will read in one go', async () => {
    const cookie = await signIn();
    const urls = Array.from(
      { length: 21 },
      (_value, index) => `https://assetstore.unity.com/packages/tools/a-prize-${index}`,
    ).join('\n');

    const response = await app.request('/api/admin/import', json({ urls }, cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error', expect.stringContaining('at most 20'));
  });
});

describe('the admin allow-list', () => {
  const ALLOWED = '203.0.113.7';
  const BLOCKED = '198.51.100.9';

  function fromAddress(address: string): Record<string, unknown> {
    return { incoming: { socket: { remoteAddress: address } } };
  }

  function restrictedApp(patterns: string[], allowLoopback = false): ReturnType<typeof createApp> {
    return createApp({
      config: testConfig({ adminIp: { allowLoopback, patterns } }),
      fetchImpl: (async () => new Response(fixture, { status: 200 })) as typeof fetch,
      handle,
    });
  }

  it('lets an allowed address sign in', async () => {
    const response = await restrictedApp([ALLOWED])
      .request('/api/session', json({ password: PASSWORD }), fromAddress(ALLOWED));

    expect(response.status).toBe(200);
  });

  it('closes every admin door on another address, the login included', async () => {
    const restricted = restrictedApp([ALLOWED]);
    const attempts: [string, RequestInit][] = [
      ['/api/session', json({ password: PASSWORD })],
      ['/api/session', { method: 'GET' }],
      ['/api/admin/assets', { method: 'GET' }],
      ['/api/admin/import', json({ urls: PAGE_URL })],
      ['/api/metadata', json({ url: PAGE_URL })],
    ];

    for (const [path, init] of attempts) {
      const response = await restricted.request(path, init, fromAddress(BLOCKED));
      expect([path, response.status]).toEqual([path, 403]);
    }
  });

  it('still serves the public list to a blocked address', async () => {
    const response = await restrictedApp([ALLOWED])
      .request('/api/assets', { method: 'GET' }, fromAddress(BLOCKED));

    expect(response.status).toBe(200);
  });

  it('accepts a whole block, however Node reports the address', async () => {
    const response = await restrictedApp(['203.0.113.0/24'])
      .request('/api/session', { method: 'GET' }, fromAddress('::ffff:203.0.113.9'));

    expect(response.status).toBe(200);
  });

  it('keeps local addresses working outside production', async () => {
    const response = await restrictedApp([ALLOWED], true)
      .request('/api/session', { method: 'GET' }, fromAddress('::ffff:127.0.0.1'));

    expect(response.status).toBe(200);
  });

  it('closes local addresses too once loopback is not allowed', async () => {
    const response = await restrictedApp([ALLOWED], false)
      .request('/api/session', { method: 'GET' }, fromAddress('127.0.0.1'));

    expect(response.status).toBe(403);
  });

  it('leaves the admin open when no list is configured', async () => {
    const response = await app.request('/api/session', { method: 'GET' }, fromAddress(BLOCKED));

    expect(response.status).toBe(200);
  });
});

describe('a trusted proxy', () => {
  const PROXY = '10.0.0.1';
  const CLIENT = '203.0.113.7';
  const OTHER = '198.51.100.9';

  function throughProxy(headers: Record<string, string>, from = PROXY): Record<string, unknown> {
    return { incoming: { headers, socket: { remoteAddress: from } } };
  }

  function proxyApp(patterns: string[] = [CLIENT], trusted: string[] = [PROXY]): ReturnType<typeof createApp> {
    return createApp({
      config: testConfig({ adminIp: { allowLoopback: false, patterns }, trustedProxies: trusted }),
      fetchImpl: (async () => new Response(fixture, { status: 200 })) as typeof fetch,
      handle,
    });
  }

  it('lets the allow-list see the client the proxy names', async () => {
    const response = await proxyApp()
      .request('/api/session', json({ password: PASSWORD }), throughProxy({ 'x-forwarded-for': CLIENT }));

    expect(response.status).toBe(200);
  });

  it('reads the last hop, so a client cannot name itself', async () => {
    // The client put 1.2.3.4 in the header; the proxy appended what it saw. Only
    // the appended address counts, so a spoofed entry cannot talk past the list.
    const response = await proxyApp()
      .request('/api/session', json({ password: PASSWORD }), throughProxy({ 'x-forwarded-for': `1.2.3.4, ${CLIENT}` }));

    expect(response.status).toBe(200);
  });

  it('skips a hop that is itself a listed proxy, as a load balancer in front is', async () => {
    // Two proxies in the chain: the ingress saw the load balancer, which saw the
    // client. Neither of them can stand in for the caller.
    const response = await proxyApp([CLIENT], ['10.0.0.0/24'])
      .request('/api/session', json({ password: PASSWORD }), throughProxy({ 'x-forwarded-for': `${CLIENT}, 10.0.0.2` }));

    expect(response.status).toBe(200);
  });

  it('gives every client behind the proxy its own rate-limit window', async () => {
    const proxy = proxyApp([]);
    for (let attempt = 0; attempt < 10; attempt++)
      await proxy.request('/api/session', json({ password: 'nope' }), throughProxy({ 'x-forwarded-for': CLIENT }));

    const other = await proxy.request('/api/session', json({ password: PASSWORD }), throughProxy({ 'x-forwarded-for': OTHER }));

    expect(other.status).toBe(200);
  });

  it('falls back to the socket address when the header is missing', async () => {
    const response = await proxyApp()
      .request('/api/session', json({ password: PASSWORD }), throughProxy({}));

    expect(response.status).toBe(403);
  });

  it('ignores the header when the peer is not a listed proxy', async () => {
    const response = await proxyApp()
      .request('/api/session', json({ password: PASSWORD }), throughProxy({ 'x-forwarded-for': CLIENT }, OTHER));

    expect(response.status).toBe(403);
  });
});

describe('unknown API routes', () => {
  it('answer with JSON, not HTML', async () => {
    const response = await app.request('/api/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
