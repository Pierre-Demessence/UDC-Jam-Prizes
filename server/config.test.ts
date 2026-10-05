// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { ConfigError, readConfig } from './config.ts';

const BASE = {
  ADMIN_PASSWORD: 'a-password',
  KEY_ENCRYPTION_SECRET: 'a-key-encryption-secret-32-characters',
  SESSION_SECRET: 'a-session-secret-long-enough',
};

describe('the address lists', () => {
  it('reads both lists, trimmed, without the empty entries', () => {
    const config = readConfig({
      ...BASE,
      ADMIN_IP_ALLOWLIST: ' 203.0.113.7 , 10.0.0.0/8, ',
      TRUSTED_PROXY_ALLOWLIST: '10.42.0.7',
    });

    expect(config.adminIp.patterns).toEqual(['203.0.113.7', '10.0.0.0/8']);
    expect(config.trustedProxies).toEqual(['10.42.0.7']);
  });

  it('trusts nobody by default', () => {
    expect(readConfig({ ...BASE }).trustedProxies).toEqual([]);
  });

  it('refuses a trusted proxy that is not an address, naming the list', () => {
    expect(() => readConfig({ ...BASE, TRUSTED_PROXY_ALLOWLIST: 'traefik.local' }))
      .toThrow(/TRUSTED_PROXY_ALLOWLIST/);
  });

  it('still refuses a malformed admin allow-list', () => {
    expect(() => readConfig({ ...BASE, ADMIN_IP_ALLOWLIST: '10.0.0.0/33' }))
      .toThrow(ConfigError);
  });
});
