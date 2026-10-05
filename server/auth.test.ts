// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { AttemptStore, RateLimiter } from './auth.ts';

import { createRateLimiter, createSessionToken, deriveSessionKey, passwordMatches, verifySessionToken } from './auth.ts';

const SECRET = 'a-test-session-secret-long-enough';
const NOW = 1_700_000_000_000;

const PASSWORD = 'correct horse';

describe('the session key', () => {
  it('is stable for one secret and password', () => {
    expect(deriveSessionKey(SECRET, PASSWORD)).toBe(deriveSessionKey(SECRET, PASSWORD));
  });

  it('changes with the password, so a cookie from before stops verifying', () => {
    const token = createSessionToken(deriveSessionKey(SECRET, PASSWORD), NOW);

    expect(verifySessionToken(deriveSessionKey(SECRET, `${PASSWORD} (changed)`), token, NOW)).toBe(false);
  });

  it('changes with the session secret too', () => {
    const key = deriveSessionKey(SECRET, PASSWORD);
    const other = deriveSessionKey('another-session-secret-long', PASSWORD);

    expect(key).not.toBe(other);
  });
});

describe('session tokens', () => {
  it('accepts a token it has just signed', () => {
    expect(verifySessionToken(SECRET, createSessionToken(SECRET, NOW), NOW)).toBe(true);
  });

  it('refuses a token whose time has passed', () => {
    const token = createSessionToken(SECRET, NOW, 1_000);

    expect(verifySessionToken(SECRET, token, NOW + 1_001)).toBe(false);
  });

  it('refuses a token signed with another secret', () => {
    expect(verifySessionToken('another-secret-entirely', createSessionToken(SECRET, NOW), NOW)).toBe(false);
  });

  it('refuses an expiry that was pushed into the future', () => {
    const [, signature] = createSessionToken(SECRET, NOW).split('.');

    expect(verifySessionToken(SECRET, `${NOW + 10 ** 9}.${signature}`, NOW)).toBe(false);
  });

  it('refuses something that is not a token at all', () => {
    for (const token of [undefined, '', 'x', '1', '.', '123.', '.abc', 'a.b.c', 'null.undefined'])
      expect(verifySessionToken(SECRET, token, NOW)).toBe(false);
  });
});

describe('passwords', () => {
  it('accepts the exact password', () => {
    expect(passwordMatches('correct horse', 'correct horse')).toBe(true);
  });

  it('refuses a wrong, empty or non-string password', () => {
    for (const provided of ['correct hors', 'Correct horse', '', 'correct horse ', null, 42, { password: 'x' }])
      expect(passwordMatches(provided, 'correct horse')).toBe(false);
  });
});

/** A stand-in for the SQLite store: these tests are about the rule, not the storage. */
function memoryStore(): AttemptStore {
  const windows = new Map<string, number[]>();
  const entry = (bucket: string, clientKey: string): string => `${bucket}/${clientKey}`;

  return {
    load: (bucket, clientKey) => [...(windows.get(entry(bucket, clientKey)) ?? [])],
    prune: (bucket, before) => {
      for (const [name, attempts] of windows) {
        if (name.startsWith(`${bucket}/`))
          windows.set(name, attempts.filter(at => at >= before));
      }
    },
    save: (bucket, clientKey, attempts) => {
      windows.set(entry(bucket, clientKey), [...attempts]);
    },
  };
}

function limiter(limit: number, windowMs = 1_000, now: () => number = () => NOW): RateLimiter {
  return createRateLimiter({ bucket: 'test', limit, now, store: memoryStore(), windowMs });
}

describe('the rate limiter', () => {
  it('allows attempts up to the limit, then blocks', () => {
    const subject = limiter(3);

    expect([1, 2, 3].map(() => subject.check('a').allowed)).toEqual([true, true, true]);
    expect(subject.check('a')).toEqual({ allowed: false, retryAfterMs: 1_000 });
  });

  it('counts each address separately', () => {
    const subject = limiter(1);
    subject.check('a');

    expect(subject.check('b').allowed).toBe(true);
  });

  it('lets an address through again after its window has passed', () => {
    let now = NOW;
    const subject = limiter(1, 1_000, () => now);
    subject.check('a');
    now += 1_001;

    expect(subject.check('a').allowed).toBe(true);
  });

  it('does not extend the block when it is already blocking', () => {
    const subject = limiter(1);
    subject.check('a');
    subject.check('a');

    expect(subject.check('a').retryAfterMs).toBe(1_000);
  });

  it('forgets an address after a successful sign-in', () => {
    const subject = limiter(1);
    subject.check('a');
    subject.reset('a');

    expect(subject.check('a').allowed).toBe(true);
  });

  it('keeps two limiters apart inside one store', () => {
    const store = memoryStore();
    const login = createRateLimiter({ bucket: 'login', limit: 1, store, windowMs: 1_000, now: () => NOW });
    const metadata = createRateLimiter({ bucket: 'metadata', limit: 1, store, windowMs: 1_000, now: () => NOW });

    login.check('a');

    expect(metadata.check('a').allowed).toBe(true);
  });
});
