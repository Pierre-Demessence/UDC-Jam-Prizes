// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createRateLimiter, createSessionToken, passwordMatches, verifySessionToken } from './auth.ts';

const SECRET = 'a-test-session-secret-long-enough';
const NOW = 1_700_000_000_000;

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

describe('the rate limiter', () => {
  it('allows attempts up to the limit, then blocks', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1_000, now: () => NOW });

    expect([1, 2, 3].map(() => limiter.check('a').allowed)).toEqual([true, true, true]);
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterMs: 1_000 });
  });

  it('counts each address separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => NOW });
    limiter.check('a');

    expect(limiter.check('b').allowed).toBe(true);
  });

  it('lets an address through again after its window has passed', () => {
    let now = NOW;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
    limiter.check('a');
    now += 1_001;

    expect(limiter.check('a').allowed).toBe(true);
  });

  it('does not extend the block when it is already blocking', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => NOW });
    limiter.check('a');
    limiter.check('a');

    expect(limiter.check('a').retryAfterMs).toBe(1_000);
  });

  it('forgets an address after a successful sign-in', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => NOW });
    limiter.check('a');
    limiter.reset('a');

    expect(limiter.check('a').allowed).toBe(true);
  });
});
