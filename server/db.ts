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

export interface ConnectOptions {
  /** Skips the migrations: for a process that writes but should not change the schema. */
  migrate?: boolean;
  /**
   * Opens the database file for reading only: no migration, no journal-mode
   * change, no write to the file. SQLite still works in the directory beside it —
   * it recreates the `-wal` and `-shm` files of a database in WAL mode — so this
   * needs a writable directory, not a read-only filesystem.
   */
  readonly?: boolean;
}

/**
 * Opens the SQLite file and returns both clients: `db` for typed Drizzle
 * queries and `sqlite` for pragmas and health probes.
 *
 * The default is the app's: create the directory, open read-write, turn on WAL
 * and apply the migrations, so a stale database is impossible; `npm run
 * db:migrate` stays available for deploys, and `npm run db:generate` writes the
 * SQL after a schema change. `{ readonly: true }` is for a reader that must not
 * write the file, `{ migrate: false }` for a writer that must not change the
 * schema; the app passes neither.
 */
export function connectDatabase(
  file = process.env.DATABASE_PATH ?? resolve(DEFAULT_FILE),
  { migrate: applyMigrations = true, readonly = false }: ConnectOptions = {},
) {
  if (!readonly && file !== ':memory:')
    mkdirSync(dirname(file), { recursive: true });

  const sqlite = new Database(file, readonly ? { readonly: true } : {});
  sqlite.pragma('foreign_keys = ON');
  // WAL is a write, and a read-only handle cannot make one.
  if (!readonly)
    sqlite.pragma('journal_mode = WAL');

  const db = drizzle(sqlite);
  if (!readonly && applyMigrations)
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    file,
    sqlite,
    close: () => sqlite.close(),
  };
}

export type DatabaseHandle = ReturnType<typeof connectDatabase>;
