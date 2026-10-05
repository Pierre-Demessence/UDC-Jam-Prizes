// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { assertAssetStoreUrl, fetchAssetPage } from './unity-fetch.ts';
import { MetadataError } from './unity.ts';

const PAGE_URL = 'https://assetstore.unity.com/packages/tools/gui/a-tool-341308';

function respondWith(body: string, init: ResponseInit = {}): typeof fetch {
  return (async () => new Response(body, { status: 200, ...init })) as typeof fetch;
}

describe('assertAssetStoreUrl', () => {
  it('accepts an Asset Store asset page and strips its query', () => {
    expect(assertAssetStoreUrl(`${PAGE_URL}?utm_source=x`).href).toBe(PAGE_URL);
  });

  it('refuses anything that is not an Asset Store page', () => {
    for (const raw of [
      '',
      'not a url',
      'http://assetstore.unity.com/packages/tools/gui/a-tool-341308',
      'https://example.com/packages/tools/gui/a-tool-341308',
      'https://127.0.0.1:3001/api/health',
      'https://assetstore.unity.com.evil.example/packages/x-1',
    ]) {
      expect(() => assertAssetStoreUrl(raw)).toThrow(MetadataError);
    }
  });
});

describe('fetchAssetPage redirects', () => {
  it('follows a redirect, because a store URL may move', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;

      return calls === 1
        ? new Response(null, { headers: { location: `${PAGE_URL}?ref=x` }, status: 302 })
        : new Response('<html>ok</html>', { status: 200 });
    }) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).resolves.toBe('<html>ok</html>');
    expect(calls).toBe(2);
  });

  it('refuses a redirect to another host', async () => {
    const fetchImpl = (async () => new Response(null, {
      headers: { location: 'https://example.com/steal' },
      status: 302,
    })) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/assetstore\.unity\.com/);
  });

  it('refuses a redirect that drops https, or points into the network', async () => {
    for (const location of ['http://assetstore.unity.com/packages/x-1', 'http://127.0.0.1:3001/api/health']) {
      const fetchImpl = (async () => new Response(null, { headers: { location }, status: 302 })) as typeof fetch;

      await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/https/);
    }
  });

  it('gives up on a redirect loop', async () => {
    const fetchImpl = (async () => new Response(null, { headers: { location: PAGE_URL }, status: 302 })) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/too many times/i);
  });

  it('refuses a redirect with no destination', async () => {
    const fetchImpl = (async () => new Response(null, { status: 302 })) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/redirect/i);
  });

  it('refuses a page whose declared size is already too large', async () => {
    const fetchImpl = (async () => ({
      headers: { get: (name: string) => (name === 'content-length' ? '9000000' : null) },
      ok: true,
      status: 200,
      text: async () => 'x',
    }) as unknown as Response) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/too large/i);
  });

  it('reports a body that dies mid-download', async () => {
    const fetchImpl = (async () => ({
      headers: { get: () => null },
      ok: true,
      status: 200,
      text: async () => {
        throw new Error('terminated');
      },
    }) as unknown as Response) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/stopped answering/i);
  });
});

describe('fetchAssetPage', () => {
  it('returns the page body', async () => {
    const html = await fetchAssetPage(new URL(PAGE_URL), { fetchImpl: respondWith('<html>ok</html>') });

    expect(html).toBe('<html>ok</html>');
  });

  it('reports a missing page', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/no page/i);
  });

  it('reports any other failing status', async () => {
    const fetchImpl = (async () => new Response('', { status: 503 })) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/503/);
  });

  it('gives up on a slow page', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/too long/i);
  });

  it('gives up when the network fails', async () => {
    const fetchImpl = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as typeof fetch;

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl })).rejects.toThrow(/could not reach/i);
  });

  it('refuses an oversized body', async () => {
    const big = 'x'.repeat(4_000_001);

    await expect(fetchAssetPage(new URL(PAGE_URL), { fetchImpl: respondWith(big) })).rejects.toThrow(/too large/i);
  });
});
