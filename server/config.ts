import process from 'node:process';

import { isValidPattern } from './ip-filter.ts';

/**
 * Environment configuration, read once at startup and validated there: a missing
 * admin password should stop the server with a readable message, not surface as
 * a 500 on the first login.
 */

export interface AdminIpSettings {
  /** Local addresses stay allowed outside production, so dev cannot lock itself out. */
  allowLoopback: boolean;
  /** Empty means the admin area is reachable from anywhere. */
  patterns: string[];
}

export interface Config {
  adminIp: AdminIpSettings;
  adminPassword: string;
  cookieSecure: boolean;
  databasePath: string | undefined;
  /** Encrypts donated key values at rest. Losing it makes every stored key unreadable. */
  keyEncryptionSecret: string;
  port: number;
  sessionSecret: string;
  /** Proxies whose `X-Forwarded-For` is believed. Empty trusts nobody. */
  trustedProxies: string[];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const MIN_SECRET_LENGTH = 16;
/** Longer than the session secret: this one protects data at rest, not a cookie. */
const MIN_ENCRYPTION_SECRET_LENGTH = 32;
const DEFAULT_PORT = 3001;

/** A comma-separated address list from the environment, validated entry by entry. */
function addressList(raw: string | undefined, name: string): string[] {
  const patterns = (raw ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '');

  const malformed = patterns.find(pattern => !isValidPattern(pattern));
  if (malformed !== undefined) {
    throw new ConfigError(
      `${name} has an entry that is not an address, a block or a CIDR range: "${malformed}".`,
    );
  }

  return patterns;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.ADMIN_PASSWORD?.trim() ?? '';
  const keyEncryptionSecret = env.KEY_ENCRYPTION_SECRET?.trim() ?? '';
  const sessionSecret = env.SESSION_SECRET?.trim() ?? '';

  const missing = [
    adminPassword === '' ? 'ADMIN_PASSWORD' : null,
    keyEncryptionSecret === '' ? 'KEY_ENCRYPTION_SECRET' : null,
    sessionSecret === '' ? 'SESSION_SECRET' : null,
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`,
    );
  }

  if (sessionSecret.length < MIN_SECRET_LENGTH)
    throw new ConfigError(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);

  // A short secret here would make the stored keys cheap to brute-force offline.
  if (keyEncryptionSecret.length < MIN_ENCRYPTION_SECRET_LENGTH) {
    throw new ConfigError(
      `KEY_ENCRYPTION_SECRET must be at least ${MIN_ENCRYPTION_SECRET_LENGTH} characters. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  const port = Number.parseInt(env.PORT ?? String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new ConfigError('PORT must be a port number.');

  const patterns = addressList(env.ADMIN_IP_ALLOWLIST, 'ADMIN_IP_ALLOWLIST');
  const trustedProxies = addressList(env.TRUSTED_PROXY_ALLOWLIST, 'TRUSTED_PROXY_ALLOWLIST');

  return {
    adminIp: { allowLoopback: env.NODE_ENV !== 'production', patterns },
    adminPassword,
    // Secure cookies need https; a local http dev server would never send them.
    cookieSecure: env.NODE_ENV === 'production',
    databasePath: env.DATABASE_PATH?.trim() || undefined,
    keyEncryptionSecret,
    port,
    sessionSecret,
    trustedProxies,
  };
}
