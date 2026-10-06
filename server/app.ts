import type { Context, MiddlewareHandler } from 'hono';

import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import process from 'node:process';

import type { Config } from './config.ts';
import type { DatabaseHandle } from './db.ts';
import type { AuthorInput, MetadataPrefill } from './validate.ts';

import {
  createRateLimiter,
  createSessionToken,
  deriveSessionKey,
  passwordMatches,
  rateLimits,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  verifySessionToken,
} from './auth.ts';
import { importAssets } from './import-assets.ts';
import { addressMatches, isLoopback, normalizeAddress } from './ip-filter.ts';
import { authorLabel } from './payloads.ts';
import {
  addKeys,
  adminAsset,
  adminCatalogue,
  attachAuthorByPublisher,
  createAsset,
  createAttemptStore,
  createAuthor,
  deleteAsset,
  deleteAuthor,
  deleteKey,
  findAssetByAssetId,
  findAuthorByDiscordHandle,
  findAuthorByDiscordId,
  findAuthorById,
  findAuthorByPublisher,
  findAuthorByPublisherId,
  listAuthors,
  publicCatalogue,
  updateAsset,
  updateAuthor,
  updateHidden,
  updateNeeded,
} from './repository.ts';
import { assertAssetStoreUrl, fetchAssetPage } from './unity-fetch.ts';
import { MetadataError, parseAssetPage } from './unity.ts';
import {
  assetInputFromMetadata,
  parseAssetInput,
  parseAuthorInput,
  parseHiddenInput,
  parseId,
  parseKeyValues,
  parseNeededInput,
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
 * The first field another author already holds, as a sentence the admin can act
 * on. `ignoreId` lets an update keep its own values; the reasons differ because
 * the fix does.
 */
function authorClash(db: DatabaseHandle['db'], input: AuthorInput, ignoreId?: number): string | null {
  if (input.publisher !== null) {
    const taken = findAuthorByPublisher(db, input.publisher);
    if (taken !== null && taken.id !== ignoreId)
      return `"${authorLabel(taken)}" already publishes as ${input.publisher}. One author per publisher is what lets a prize find its author on its own.`;
  }

  if (input.publisherId !== null) {
    const taken = findAuthorByPublisherId(db, input.publisherId);
    if (taken !== null && taken.id !== ignoreId)
      return `That store publisher id already belongs to "${authorLabel(taken)}".`;
  }

  if (input.discordHandle !== null) {
    const taken = findAuthorByDiscordHandle(db, input.discordHandle);
    if (taken !== null && taken.id !== ignoreId)
      return `That Discord handle already belongs to "${authorLabel(taken)}".`;
  }

  if (input.discordId !== null) {
    const taken = findAuthorByDiscordId(db, input.discordId);
    if (taken !== null && taken.id !== ignoreId)
      return `That Discord id already belongs to "${authorLabel(taken)}".`;
  }

  return null;
}

/**
 * The API's routes. Serving the built client is the entry point's job, so the
 * app stays testable with an in-memory database.
 */
export function createApp({ config, fetchImpl, handle }: AppOptions) {
  const app = new Hono();
  const db = handle.db;
  // Admin payloads carry key values, which are decrypted on the way out.
  const { keyEncryptionSecret } = config;
  // Derived once: it is what the session cookie is signed with, so a changed
  // password stops every cookie issued under the old one from verifying.
  const sessionKey = deriveSessionKey(config.sessionSecret, config.adminPassword);
  // The limiter windows live in SQLite, so a restart cannot clear a lockout.
  const attemptStore = createAttemptStore(db);
  const importLimiter = createRateLimiter({ ...rateLimits.import, store: attemptStore });
  const loginLimiter = createRateLimiter({ ...rateLimits.login, store: attemptStore });
  const metadataLimiter = createRateLimiter({ ...rateLimits.metadata, store: attemptStore });

  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ['\'self\''],
      // Prize images are hot-linked from Unity's CDN.
      imgSrc: ['\'self\'', 'https:', 'data:'],
      scriptSrc: ['\'self\''],
      styleSrc: ['\'self\''],
    },
  }));

  /** True for a proxy the configuration says may speak for the caller. */
  function isTrustedProxy(address: string | null): boolean {
    return address !== null && addressMatches(address, config.trustedProxies);
  }

  /**
   * The address the request came from. The socket address is the only one a header
   * cannot fake, so on its own it stands — unless it belongs to a proxy we were
   * told to believe, which says who the caller is in `X-Forwarded-For`. The hops
   * are read from the right, which is where a proxy appends: an entry naming
   * another listed proxy is a hop of that chain, and the first entry that is not
   * is the client. Whatever sits before it is what the client sent, so a spoofed
   * entry cannot name it. A trusted proxy also gives the allow-list real visitors
   * back, instead of its own address.
   */
  function clientAddress(env: unknown): string | null {
    const incoming = (env as {
      incoming?: {
        headers?: Record<string, string | string[] | undefined>;
        socket?: { remoteAddress?: string };
      };
    } | undefined)?.incoming;

    const socket = normalizeAddress(incoming?.socket?.remoteAddress);
    if (!isTrustedProxy(socket))
      return socket;

    const forwarded = incoming?.headers?.['x-forwarded-for'];
    const hops = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '')
      .split(',')
      .map(hop => normalizeAddress(hop))
      .filter(hop => hop !== null);

    for (const hop of hops.toReversed()) {
      if (!isTrustedProxy(hop))
        return hop;
    }

    // Every hop was a proxy of the chain: the socket address is all that is left.
    return socket;
  }

  function clientKey(env: unknown): string {
    return clientAddress(env) ?? 'local';
  }

  /** Empty allow-list means the admin area is reachable from anywhere. */
  function addressAllowed(env: unknown): boolean {
    const { allowLoopback, patterns } = config.adminIp;
    if (patterns.length === 0)
      return true;

    const address = clientAddress(env);
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
    return verifySessionToken(sessionKey, getCookie(c, SESSION_COOKIE));
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
    setCookie(c, SESSION_COOKIE, createSessionToken(sessionKey), {
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
      // The publisher is what ties a prize to its author, so a known one is
      // preselected: reading a batch from a dozen authors is then no typing.
      const author = findAuthorByPublisher(db, metadata.publisher);
      // The publisher id rides along with the prefill so the form can hand it to
      // the author it creates; it is not a column of the prize.
      const prefill: MetadataPrefill = {
        ...assetInputFromMetadata(metadata),
        authorId: author?.id ?? null,
        publisherId: metadata.publisherId,
      };

      return c.json({
        existingAsset: existing === null ? null : { id: existing.id, name: existing.name },
        metadata: prefill,
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

    const outcome = await importAssets(db, fetchImpl ?? fetch, urls.value, keyEncryptionSecret);

    return c.json({ ...outcome, assets: adminCatalogue(db, keyEncryptionSecret) }, 201);
  });

  app.get('/api/admin/assets', (c) => {
    const denied = requireAdmin(c);
    return denied ?? c.json({ assets: adminCatalogue(db, keyEncryptionSecret) });
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

    if (input.value.authorId !== null && findAuthorById(db, input.value.authorId) === null)
      return c.json({ error: 'That author is no longer in the list.' }, 400);

    return c.json({ asset: createAsset(db, input.value, keyEncryptionSecret) }, 201);
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

    if (input.value.authorId !== null && findAuthorById(db, input.value.authorId) === null)
      return c.json({ error: 'That author is no longer in the list.' }, 400);

    const asset = updateAsset(db, id, input.value, keyEncryptionSecret);
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

  /** How many keys the winners asked for, as typed in the admin table. */
  app.put('/api/admin/assets/:id/needed', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null)
      return c.json({ error: 'Unknown asset.' }, 404);

    const input = parseNeededInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const asset = updateNeeded(db, id, input.value.needed, keyEncryptionSecret);

    return asset === null ? c.json({ error: 'Unknown asset.' }, 404) : c.json({ asset });
  });

  /** The admin table's Hide/Unhide button: off the public page, still in the admin list. */
  app.put('/api/admin/assets/:id/hidden', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null)
      return c.json({ error: 'Unknown asset.' }, 404);

    const input = parseHiddenInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const asset = updateHidden(db, id, input.value.hidden, keyEncryptionSecret);

    return asset === null ? c.json({ error: 'Unknown asset.' }, 404) : c.json({ asset });
  });

  app.post('/api/admin/assets/:id/keys', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null || adminAsset(db, id, keyEncryptionSecret) === null)
      return c.json({ error: 'Unknown asset.' }, 404);

    const input = parseKeyValues(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const added = addKeys(db, id, input.value, keyEncryptionSecret);
    const skipped = input.value.length - added;

    return c.json({
      added,
      asset: adminAsset(db, id, keyEncryptionSecret),
      skipped,
    }, 201);
  });

  app.delete('/api/admin/assets/:id/keys/:keyId', (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    const keyId = parseId(c.req.param('keyId'));
    if (id === null || keyId === null || adminAsset(db, id, keyEncryptionSecret) === null)
      return c.json({ error: 'Unknown key.' }, 404);

    return c.json({ asset: deleteKey(db, id, keyId, keyEncryptionSecret) });
  });

  /** All of them, each with the prize count the author panel shows. */
  app.get('/api/admin/authors', (c) => {
    const denied = requireAdmin(c);
    return denied ?? c.json({ authors: listAuthors(db) });
  });

  app.post('/api/admin/authors', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const input = parseAuthorInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const clash = authorClash(db, input.value);
    if (clash !== null)
      return c.json({ error: clash }, 409);

    return c.json({ author: createAuthor(db, input.value) }, 201);
  });

  app.patch('/api/admin/authors/:id', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null)
      return c.json({ error: 'Unknown author.' }, 404);

    const input = parseAuthorInput(await readJson(c));
    if (!input.ok)
      return c.json({ error: input.error }, 400);

    const clash = authorClash(db, input.value, id);
    if (clash !== null)
      return c.json({ error: clash }, 409);

    const author = updateAuthor(db, id, input.value);

    return author === null ? c.json({ error: 'Unknown author.' }, 404) : c.json({ author });
  });

  /** Deletes the author only: the prizes stay, unlinked, and the count says how many. */
  app.delete('/api/admin/authors/:id', (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    const unlinked = id === null ? null : deleteAuthor(db, id);
    if (unlinked === null)
      return c.json({ error: 'Unknown author.' }, 404);

    return c.json({ assets: adminCatalogue(db, keyEncryptionSecret), unlinked });
  });

  /** Links every prize published under a publisher string, in one action. */
  app.post('/api/admin/authors/:id/attach', async (c) => {
    const denied = requireAdmin(c);
    if (denied)
      return denied;

    const id = parseId(c.req.param('id'));
    if (id === null || findAuthorById(db, id) === null)
      return c.json({ error: 'Unknown author.' }, 404);

    const publisher = (await readJson(c))?.publisher;
    if (typeof publisher !== 'string' || publisher.trim() === '')
      return c.json({ error: 'Give the publisher name to attach prizes by.' }, 400);

    const attached = attachAuthorByPublisher(db, id, publisher);

    return c.json({ assets: adminCatalogue(db, keyEncryptionSecret), attached });
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
