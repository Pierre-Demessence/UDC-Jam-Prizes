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

export interface RateLimiterOptions {
  limit: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Counts attempts per key in a sliding window, in memory: enough for a
 * single-process app with one admin, and it keeps the password endpoint from
 * being guessable at speed. A blocked attempt is not counted, so a client
 * cannot lock itself out forever.
 */
export function createRateLimiter({ limit, now = Date.now, windowMs = RATE_WINDOW_MS }: RateLimiterOptions): RateLimiter {
  const attempts = new Map<string, number[]>();

  return {
    check(key) {
      const current = now();
      const recent = (attempts.get(key) ?? []).filter(at => current - at < windowMs);

      if (recent.length >= limit) {
        attempts.set(key, recent);
        return { allowed: false, retryAfterMs: windowMs - (current - recent[0]) };
      }

      recent.push(current);
      attempts.set(key, recent);
      return { allowed: true, retryAfterMs: 0 };
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}

/** Tests read the same defaults as the server. */
export const rateLimits = {
  import: { limit: 20, windowMs: RATE_WINDOW_MS },
  login: { limit: 10, windowMs: RATE_WINDOW_MS },
  metadata: { limit: 30, windowMs: RATE_WINDOW_MS },
};

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}
