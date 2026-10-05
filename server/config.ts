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
  port: number;
  sessionSecret: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const MIN_SECRET_LENGTH = 16;
const DEFAULT_PORT = 3001;

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.ADMIN_PASSWORD?.trim() ?? '';
  const sessionSecret = env.SESSION_SECRET?.trim() ?? '';

  const missing = [
    adminPassword === '' ? 'ADMIN_PASSWORD' : null,
    sessionSecret === '' ? 'SESSION_SECRET' : null,
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing ${missing.join(' and ')}. Copy .env.example to .env and fill it in.`,
    );
  }

  if (sessionSecret.length < MIN_SECRET_LENGTH)
    throw new ConfigError(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);

  const port = Number.parseInt(env.PORT ?? String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new ConfigError('PORT must be a port number.');

  const patterns = (env.ADMIN_IP_ALLOWLIST ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '');

  const malformed = patterns.find(pattern => !isValidPattern(pattern));
  if (malformed !== undefined) {
    throw new ConfigError(
      `ADMIN_IP_ALLOWLIST has an entry that is not an address, a block or a CIDR range: "${malformed}".`,
    );
  }

  return {
    adminIp: { allowLoopback: env.NODE_ENV !== 'production', patterns },
    adminPassword,
    // Secure cookies need https; a local http dev server would never send them.
    cookieSecure: env.NODE_ENV === 'production',
    databasePath: env.DATABASE_PATH?.trim() || undefined,
    port,
    sessionSecret,
  };
}
