import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import process from 'node:process';

export const SESSION_COOKIE = 'prizes_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const RATE_WINDOW_MS = 15 * 60 * 1000;

/** Compares two secrets without leaking their length or where they differ. */
function sameSecret(left: string, right: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(left).digest(),
    createHash('sha256').update(right).digest(),
  );
}

export function passwordMatches(provided: unknown, expected: string): boolean {
  return typeof provided === 'string' && provided !== '' && sameSecret(provided, expected);
}

function sign(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/**
 * The key session cookies are signed with. Deriving it from the admin password as
 * well as `SESSION_SECRET` means changing the password ends every session already
 * issued — the moment revoking them matters — without a session table: an old
 * cookie simply stops verifying. The password stays hidden (an HMAC is one-way),
 * and guessing it offline needs `SESSION_SECRET`, which a stolen cookie is not.
 */
export function deriveSessionKey(sessionSecret: string, adminPassword: string): string {
  return sign(sessionSecret, adminPassword);
}

/**
 * The cookie holds only an expiry and its HMAC: the password never travels to
 * the client, and a tampered expiry cannot be re-signed without the key.
 */
export function createSessionToken(key: string, now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const expiry = String(now + ttlMs);
  return `${expiry}.${sign(key, expiry)}`;
}

export function verifySessionToken(key: string, token: string | undefined, now = Date.now()): boolean {
  if (!token)
    return false;

  const [expiry, signature] = token.split('.');
  if (!expiry || !signature || !sameSecret(signature, sign(key, expiry)))
    return false;

  const expiresAt = Number.parseInt(expiry, 10);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  check: (key: string) => RateLimitVerdict;
  reset: (key: string) => void;
}

/**
 * Where a limiter keeps its window. It is a keyed list of timestamps rather than
 * a table of its own, because a window never holds more than `limit` attempts:
 * the SQLite implementation replaces a key's rows wholesale.
 */
export interface AttemptStore {
  /** This key's attempts, oldest first. */
  load: (bucket: string, clientKey: string) => number[];
  /** Drops the attempts that have aged out of one limiter's window. */
  prune: (bucket: string, before: number) => void;
  save: (bucket: string, clientKey: string, attempts: number[]) => void;
}

export interface RateLimiterOptions {
  /** Names this limiter's own window in the store. */
  bucket: string;
  limit: number;
  store: AttemptStore;
  windowMs?: number;
  now?: () => number;
}

/**
 * Counts attempts per key in a sliding window. A blocked attempt is not counted,
 * so a client cannot lock itself out forever. The window lives in the store, and
 * the server passes one backed by SQLite: a limit that a restart clears would be
 * no limit at all against anyone able to restart the process.
 */
export function createRateLimiter({ bucket, limit, now = Date.now, store, windowMs = RATE_WINDOW_MS }: RateLimiterOptions): RateLimiter {
  return {
    check(key) {
      const current = now();
      store.prune(bucket, current - windowMs);

      const recent = store.load(bucket, key).filter(at => current - at < windowMs);
      if (recent.length >= limit)
        return { allowed: false, retryAfterMs: windowMs - (current - recent[0]) };

      recent.push(current);
      store.save(bucket, key, recent);
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key) {
      store.save(bucket, key, []);
    },
  };
}

/** Tests read the same defaults as the server. */
export const rateLimits = {
  import: { bucket: 'import', limit: 20, windowMs: RATE_WINDOW_MS },
  login: { bucket: 'login', limit: 10, windowMs: RATE_WINDOW_MS },
  metadata: { bucket: 'metadata', limit: 30, windowMs: RATE_WINDOW_MS },
};

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}
