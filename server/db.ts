import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_FILE = 'data/prizes.sqlite';
// Resolved from this module, so the server can be started from any directory.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/**
 * Opens the SQLite file and returns both clients: `db` for typed Drizzle
 * queries and `sqlite` for pragmas and health probes.
 *
 * Migrations are applied on every connect, so a stale database is impossible;
 * `npm run db:migrate` stays available for deploys. Use `npm run db:generate`
 * after changing `schema.ts`.
 */
export function connectDatabase(file = process.env.DATABASE_PATH ?? resolve(DEFAULT_FILE)) {
  if (file !== ':memory:')
    mkdirSync(dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    file,
    sqlite,
    close: () => sqlite.close(),
  };
}

export type DatabaseHandle = ReturnType<typeof connectDatabase>;
