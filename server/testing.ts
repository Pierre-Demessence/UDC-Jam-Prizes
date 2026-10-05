import type { Config } from './config.ts';

/**
 * A configuration for tests: a known password, a known secret, and no https
 * requirement, so a cookie set by the app can be read back in assertions.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    adminIp: { allowLoopback: true, patterns: [] },
    adminPassword: 'test-password',
    cookieSecure: false,
    databasePath: undefined,
    keyEncryptionSecret: 'test-key-encryption-secret-32-chars-plus',
    port: 3001,
    sessionSecret: 'test-session-secret-long-enough',
    ...overrides,
  };
}
