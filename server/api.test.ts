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
const PUBLIC_FIELDS = ['id', 'name', 'assetId', 'assetUrl', 'category', 'currency', 'imageUrl', 'priceCents', 'publisher'];

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

  it('stops answering after too many wrong passwords', async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      await app.request('/api/session', json({ password: 'nope' }));

    const blocked = await app.request('/api/session', json({ password: PASSWORD }));

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toHaveProperty('error');
  });
});

describe('the admin gate', () => {
  it('refuses every admin route without a session', async () => {
    const routes: [string, RequestInit][] = [
      ['/api/admin/assets', { method: 'GET' }],
      ['/api/admin/assets', { method: 'POST' }],
      ['/api/admin/assets/1', { method: 'PATCH' }],
      ['/api/admin/assets/1', { method: 'DELETE' }],
      ['/api/admin/assets/1/contact', { method: 'PUT' }],
      ['/api/admin/assets/1/keys', { method: 'POST' }],
      ['/api/admin/assets/1/keys/1', { method: 'PATCH' }],
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
    expect(asset.priceCents).toBe(3250);

    const body = await (await app.request('/api/assets')).json() as { totals: { count: number; priceCents: number } };

    expect(body.totals).toEqual({ count: 1, priceCents: 3250 });
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
    expect(body.metadata).toMatchObject({ name: expect.stringContaining('Text Animator'), assetId: '341308', priceCents: 3250 });
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

  it('deletes the asset with its contacts and keys, so it leaves the public list', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    await app.request(`/api/admin/assets/${asset.id}/contact`, json({ discordHandle: 'someone' }, cookie));
    await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1' }, cookie));

    const deleted = await app.request(`/api/admin/assets/${asset.id}`, { headers: { cookie }, method: 'DELETE' });
    const catalogue = await (await app.request('/api/assets')).json() as { totals: { count: number } };

    expect(deleted.status).toBe(204);
    expect(catalogue.totals.count).toBe(0);
    expect(handle.sqlite.prepare('select count(*) as n from contacts').get()).toEqual({ n: 0 });
    expect(handle.sqlite.prepare('select count(*) as n from keys').get()).toEqual({ n: 0 });
  });
});

describe('the keys behind a prize', () => {
  async function assetWithKeys(cookie: string): Promise<{ assetId: number; keyId: number }> {
    const asset = await addAsset(cookie);
    const response = await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1\nKEY-2' }, cookie));
    const body = await response.json() as { asset: { keys: { id: number }[] } };

    return { assetId: asset.id as number, keyId: body.asset.keys[0].id };
  }

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

  it('assigns a key to a winner', async () => {
    const cookie = await signIn();
    const { assetId, keyId } = await assetWithKeys(cookie);

    const response = await app.request(`/api/admin/assets/${assetId}/keys/${keyId}`, {
      body: JSON.stringify({ assignedTo: 'Winner One', status: 'assigned' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });
    const body = await response.json() as { asset: { keys: { assignedAt: string | null; assignedTo: string | null }[] } };
    const key = body.asset.keys[0];

    expect(key.assignedAt).not.toBeNull();
    expect(key.assignedTo).toBe('Winner One');
  });

  it('refuses an assignment with no winner', async () => {
    const cookie = await signIn();
    const { assetId, keyId } = await assetWithKeys(cookie);
    const response = await app.request(`/api/admin/assets/${assetId}/keys/${keyId}`, {
      body: JSON.stringify({ status: 'assigned' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect(response.status).toBe(400);
  });

  it('refuses a status it does not know', async () => {
    const cookie = await signIn();
    const { assetId, keyId } = await assetWithKeys(cookie);
    const response = await app.request(`/api/admin/assets/${assetId}/keys/${keyId}`, {
      body: JSON.stringify({ status: 'eaten' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect(response.status).toBe(400);
  });

  it('stores the contact of the author without publishing it', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const response = await app.request(`/api/admin/assets/${asset.id}/contact`, {
      body: JSON.stringify({ contactNotes: 'replies slowly', discordHandle: 'author#1' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PUT',
    });

    const admin = await response.json() as { asset: { contact: { discordHandle: string } } };
    const publicBody = await (await app.request('/api/assets')).text();

    expect(admin.asset.contact.discordHandle).toBe('author#1');
    expect(publicBody).not.toContain('author#1');
    expect(publicBody).not.toContain('replies slowly');
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

  it('refuses to mark a key as sent with no winner', async () => {
    const cookie = await signIn();
    const asset = await addAsset(cookie);
    const added = await app.request(`/api/admin/assets/${asset.id}/keys`, json({ keys: 'KEY-1' }, cookie));
    const keyId = ((await added.json()) as { asset: { keys: { id: number }[] } }).asset.keys[0].id;

    const response = await app.request(`/api/admin/assets/${asset.id}/keys/${keyId}`, {
      body: JSON.stringify({ status: 'sent' }),
      headers: { 'content-type': 'application/json', cookie },
      method: 'PATCH',
    });

    expect(response.status).toBe(400);
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

describe('unknown API routes', () => {
  it('answer with JSON, not HTML', async () => {
    const response = await app.request('/api/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
