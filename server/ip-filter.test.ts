// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { addressMatches, isLoopback, isValidPattern, normalizeAddress } from './ip-filter.ts';

describe('normalizeAddress', () => {
  it('unwraps the IPv4-in-IPv6 form Node reports on some hosts', () => {
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeAddress('::FFFF:10.0.0.5')).toBe('10.0.0.5');
  });

  it('lower-cases and trims, and treats nothing as nothing', () => {
    expect(normalizeAddress('  2001:DB8::1 ')).toBe('2001:db8::1');
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress(undefined)).toBeNull();
  });
});

describe('isLoopback', () => {
  it('knows the local addresses', () => {
    for (const address of ['127.0.0.1', '::1', 'localhost'])
      expect(isLoopback(address)).toBe(true);

    for (const address of ['10.0.0.1', null, '127.0.0.2'])
      expect(isLoopback(address)).toBe(false);
  });
});

describe('isValidPattern', () => {
  it('accepts addresses, blocks and IPv6 literals', () => {
    for (const pattern of ['127.0.0.1', '203.0.113.7', '10.0.0.0/8', '192.168.1.0/24', '0.0.0.0/0', '2001:db8::1'])
      expect(isValidPattern(pattern)).toBe(true);
  });

  it('refuses anything that is not one of those', () => {
    for (const pattern of ['', 'localhost', 'example.com', '10.0.0.0/33', '10.0.0.0/-1', '10.0.0', '300.0.0.1', '1.2.3.4 5.6.7.8'])
      expect(isValidPattern(pattern)).toBe(false);
  });
});

describe('addressMatches', () => {
  it('matches an exact address', () => {
    expect(addressMatches('203.0.113.7', ['203.0.113.7'])).toBe(true);
    expect(addressMatches('203.0.113.8', ['203.0.113.7'])).toBe(false);
  });

  it('matches inside a CIDR block', () => {
    expect(addressMatches('10.4.5.6', ['10.0.0.0/8'])).toBe(true);
    expect(addressMatches('11.4.5.6', ['10.0.0.0/8'])).toBe(false);
    expect(addressMatches('192.168.1.255', ['192.168.1.0/24'])).toBe(true);
    expect(addressMatches('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
  });

  it('treats /32 as one address and /0 as everything', () => {
    expect(addressMatches('1.2.3.4', ['1.2.3.4/32'])).toBe(true);
    expect(addressMatches('1.2.3.5', ['1.2.3.4/32'])).toBe(false);
    expect(addressMatches('8.8.8.8', ['0.0.0.0/0'])).toBe(true);
  });

  it('matches an IPv6 literal exactly and does nothing else with it', () => {
    expect(addressMatches('2001:db8::1', ['2001:db8::1'])).toBe(true);
    expect(addressMatches('2001:db8::2', ['2001:db8::1'])).toBe(false);
    expect(addressMatches('2001:db8::1', ['2001:db8::/64'])).toBe(false);
  });

  it('has nothing to match without an address', () => {
    expect(addressMatches(null, ['0.0.0.0/0'])).toBe(false);
  });

  it('matches if any pattern matches', () => {
    expect(addressMatches('10.0.0.5', ['203.0.113.7', '10.0.0.0/8'])).toBe(true);
    expect(addressMatches('10.0.0.5', [])).toBe(false);
  });
});
