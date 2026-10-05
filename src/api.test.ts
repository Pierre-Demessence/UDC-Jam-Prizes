import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@/api';

/** A Response good enough for the client, without depending on jsdom's globals. */
function responseOf(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Installs a stub for `fetch` and counts how often the client called it. */
function stubFetch(handler: (call: number) => Response): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal('fetch', async () => {
    calls += 1;
    return handler(calls);
  });

  return { calls: () => calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the API client', () => {
  it('retries while the dev proxy has not found the API yet', async () => {
    const stub = stubFetch(call => call === 1
      ? responseOf(502, { error: 'Bad Gateway' })
      : responseOf(200, { assets: [], totals: { count: 0, priceCents: 0 } }));

    const catalogue = await api.catalogue();

    expect(stub.calls()).toBe(2);
    expect(catalogue.totals.count).toBe(0);
  });

  it('gives up after the last attempt and reports the server message', async () => {
    stubFetch(() => responseOf(502, { error: 'Bad Gateway' }));

    await expect(api.catalogue()).rejects.toThrow(ApiError);
    await expect(api.catalogue()).rejects.toThrow('Bad Gateway');
  });

  it('does not retry a refusal', async () => {
    const stub = stubFetch(() => responseOf(401, { error: 'Wrong password.' }));

    await expect(api.signIn('nope')).rejects.toThrow('Wrong password.');
    expect(stub.calls()).toBe(1);
  });

  it('passes on the status, so a caller can tell 401 from 500', async () => {
    stubFetch(() => responseOf(401, { error: 'Sign in as the admin first.' }));

    await expect(api.adminAssets()).rejects.toMatchObject({ status: 401 });
  });

  it('reports an unreachable API in words a human can act on', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(api.catalogue()).rejects.toThrow('The API is unreachable.');
  });

  it('handles a response with no body', async () => {
    stubFetch(() => responseOf(204, null));

    await expect(api.deleteAsset(1)).resolves.toBeUndefined();
  });

  it('falls back to a plain message when the API sends no explanation', async () => {
    stubFetch(() => responseOf(500, null));

    await expect(api.catalogue()).rejects.toThrow('The API answered 500.');
  });

  it('asks the browser to send the session cookie', async () => {
    let init: RequestInit | undefined;
    vi.stubGlobal('fetch', async (_input: string, options: RequestInit) => {
      init = options;
      return responseOf(200, { authenticated: false });
    });

    await api.session();

    expect(init?.credentials).toBe('same-origin');
  });

  it('hides and unhides a prize with a PUT carrying the flag', async () => {
    let path: string | undefined;
    let init: RequestInit | undefined;
    vi.stubGlobal('fetch', async (input: string, options: RequestInit) => {
      path = input;
      init = options;
      return responseOf(200, { asset: { id: 1, hidden: true } });
    });

    await api.setHidden(1, true);

    expect(path).toBe('/api/admin/assets/1/hidden');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ hidden: true }));
  });
});
