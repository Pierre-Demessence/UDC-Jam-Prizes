import type { Context, MiddlewareHandler } from 'hono';

import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import process from 'node:process';

import type { Config } from './config.ts';
import type { DatabaseHandle } from './db.ts';

import {
  createRateLimiter,
  createSessionToken,
  passwordMatches,
  rateLimits,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifySessionToken,
} from './auth.ts';
import { importAssets } from './import-assets.ts';
import { addressMatches, isLoopback, normalizeAddress } from './ip-filter.ts';
import {
  addKeys,
  adminAsset,
  adminCatalogue,
  createAsset,
  deleteAsset,
  deleteKey,
  findAssetByAssetId,
  publicCatalogue,
  saveContact,
  updateAsset,
  updateKey,
} from './repository.ts';
import { assertAssetStoreUrl, fetchAssetPage } from './unity-fetch.ts';
import { MetadataError, parseAssetPage } from './unity.ts';
import {
  assetInputFromMetadata,
  parseAssetInput,
  parseContactInput,
  parseId,
  parseKeyStatusInput,
  parseKeyValues,
  parseUrls,
} from './validate.ts';

export interface AppOptions {
  config: Config;
  fetchImpl?: typeof fetch;
  handle: DatabaseHandle;
}

const MAX_BODY_BYTES = 256 * 1024;
const MINUTE_MS = 60_000;

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES)
    return null;

  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  }
  catch {
    return null;
  }
}

/**
 * The API's routes. Serving the built client is the entry point's job, so the
 * app stays testable with an in-memory database.
 */
export function createApp({ config, fetchImpl, handle }: AppOptions) {
  const app = new Hono();
  const db = handle.db;
  const importLimiter = createRateLimiter(rateLimits.import);
  const loginLimiter = createRateLimiter(rateLimits.login);
  const metadataLimiter = createRateLimiter(rateLimits.metadata);

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ['\'self\''],
      // Prize images are hot-linked from Unity's CDN.
      imgSrc: ['\'self\'', 'https:', 'data:'],
      scriptSrc: ['\'self\''],
      styleSrc: ['\'self\''],
    },
  }));

  /** The real socket address, so a header cannot dodge a rate limit or the allow-list. */
  function clientAddress(env: unknown): string | undefined {
    const incoming = (env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    return incoming?.socket?.remoteAddress;
  }

  function clientKey(env: unknown): string {
    return normalizeAddress(clientAddress(env)) ?? 'local';
  }

  /** Empty allow-list means the admin area is reachable from anywhere. */
  function addressAllowed(env: unknown): boolean {
    const { allowLoopback, patterns } = config.adminIp;
    if (patterns.length === 0)
      return true;

    const address = normalizeAddress(clientAddress(env));
    if (allowLoopback && isLoopback(address))
      return true;

    return addressMatches(address, patterns);
  }

  /**
   * The admin side is pinned to known addresses when the allow-list is set —
   * the login page included, so the password is not the only door.
   */
  const gateAddress: MiddlewareHandler = async (c, next) => {
    if (!addressAllowed(c.env))
      return c.json({ error: 'This address is not allowed to reach the admin.' }, 403);

    await next();
  };

  app.use('/api/session', gateAddress);
  app.use('/api/metadata', gateAddress);
  app.use('/api/admin/*', gateAddress);

  function authenticated(c: Context): boolean {
    return verifySessionToken(config.sessionSecret, getCookie(c, SESSION_COOKIE));
  }

  function requireAdmin(c: Context): Response | null {
    return authenticated(c) ? null : c.json({ error: 'Sign in as the admin first.' }, 401);
  }

  app.get('/api/health', (c) => {
    try {
      handle.sqlite.prepare('select 1 as ok').get();
    }
    catch {
      return c.json({ database: 'unreachable', status: 'degraded', uptime: 0 }, 503);
    }

    return c.json({ database: 'ok', status: 'ok', uptime: Math.round(process.uptime()) });
  });

  app.get('/api/session', c => c.json({ authenticated: authenticated(c) }));

  app.post('/api/session', async (c) => {
    const verdict = loginLimiter.check(clientKey(c.env));
    if (!verdict.allowed) {
      const minutes = Math.max(1, Math.ceil(verdict.retryAfterMs / MINUTE_MS));
      return c.json({ error: `Too many attempts. Try again in ${minutes} minutes.` }, 429);
    }

    const body = await readJson(c);
    if (!passwordMatches(body?.password, config.adminPassword))
      return c.json({ error: 'Wrong password.' }, 401);

    loginLimiter.reset(clientKey(c.env));
    setCookie(c, SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      httpOnly: true,
      maxAge: Math.round(SESSION_TTL_MS / 1000),
      path: '/',
      sameSite: 'Strict',
      secure: config.cookieSecure,
    });

    return c.json({ authenticated: true });
  });

  app.delete('/api/session', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ authenticated: false });
  });

  // Public. The payload is shaped field by field, so private columns cannot leak.
  app.get('/api/assets', c => c.json(publicCatalogue(db)));

  /** Reads a Unity page and returns the fields it offers, for the admin to confirm. */
  app.post('/api/metadata', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    if (!metadataLimiter.check(clientKey(c.env)).allowed)
      return c.json({ error: 'Too many lookups in a row. Wait a moment.' }, 429);

    const body = await readJson(c);

    try {
      const url = assertAssetStoreUrl(body?.url);
      const html = await fetchAssetPage(url, fetchImpl === undefined ? {} : { fetchImpl });
      const metadata = parseAssetPage(html, url.href);
      const existing = findAssetByAssetId(db, metadata.assetId);

      return c.json({
        existingAsset: existing === null ? null : { id: existing.id, name: existing.name },
        metadata: assetInputFromMetadata(metadata),
      });
    }
    catch (cause) {
      if (cause instanceof MetadataError)
        return c.json({ error: cause.message }, 400);

      throw cause;
    }
  });

  /** Several links in one paste; each is read the way the form reads one. */
  app.post('/api/admin/import', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    if (!importLimiter.check(clientKey(c.env)).allowed)
      return c.json({ error: 'Too many imports in a row. Wait a moment.' }, 429);

    const urls = parseUrls(await readJson(c));
    if (!urls.ok)
      return c.json({ error: urls.error }, 400);

    const outcome = await importAssets(db, fetchImpl ?? fetch, urls.value);

    return c.json({ ...outcome, assets: adminCatalogue(db) }, 201);
  });

  app.get('/api/admin/assets', (c) => {
    const denied = requireAdmin(c);
    return denied ?? c.json({ assets: adminCatalogue(db) });
  });

  app.post('/api/admin/assets', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const input = parseAssetInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    if (findAssetByAssetId(db, input.value.assetId) !== null)
      return c.json({ error: 'That asset is already in the list.' }, 409);

    return c.json({ asset: createAsset(db, input.value) }, 201);
  });

  app.patch('/api/admin/assets/:id', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null)
      return c.json({ error: 'Unknown asset.' }, 404);

    const input = parseAssetInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const clash = findAssetByAssetId(db, input.value.assetId);
    if (clash !== null && clash.id !== id)
      return c.json({ error: 'Another prize already uses that Unity id.' }, 409);

    const asset = updateAsset(db, id, input.value);
    return asset === null ? c.json({ error: 'Unknown asset.' }, 404) : c.json({ asset });
  });

  app.delete('/api/admin/assets/:id', (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null || !deleteAsset(db, id))
      return c.json({ error: 'Unknown asset.' }, 404);

    return c.body(null, 204);
  });

  app.put('/api/admin/assets/:id/contact', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    const asset = id === null ? null : adminAsset(db, id);
    if (id === null || asset === null)
      return c.json({ error: 'Unknown asset.' }, 404);

    const input = parseContactInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    saveContact(db, id, input.value);
    return c.json({ asset: adminAsset(db, id) });
  });

  app.post('/api/admin/assets/:id/keys', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null || adminAsset(db, id) === null)
      return c.json({ error: 'Unknown asset.' }, 404);

    const input = parseKeyValues(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const added = addKeys(db, id, input.value);
    const skipped = input.value.length - added;

    return c.json({
      added,
      asset: adminAsset(db, id),
      skipped,
    }, 201);
  });

  app.patch('/api/admin/assets/:id/keys/:keyId', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    const keyId = parseId(c.req.param('keyId'));
    if (id === null || keyId === null || adminAsset(db, id) === null)
      return c.json({ error: 'Unknown key.' }, 404);

    const input = parseKeyStatusInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    return c.json({ asset: updateKey(db, id, keyId, input.value) });
  });

  app.delete('/api/admin/assets/:id/keys/:keyId', (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    const keyId = parseId(c.req.param('keyId'));
    if (id === null || keyId === null || adminAsset(db, id) === null)
      return c.json({ error: 'Unknown key.' }, 404);

    return c.json({ asset: deleteKey(db, id, keyId) });
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/'))
      return c.json({ error: 'Not found' }, 404);

    return c.text('Not found', 404);
  });

  app.onError((error, c) => {
    // The client gets a plain message: stack traces and driver errors stay here.

    console.error(error);

    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  return app;
}
