// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectOptions, DatabaseHandle } from './db.ts';

import { connectDatabase } from './db.ts';
import { assets } from './schema.ts';

let directory: string | undefined;
let open: DatabaseHandle[] = [];

/** A fresh temporary directory per test, removed afterwards. */
function tempDirectory(): string {
  directory = mkdtempSync(join(tmpdir(), 'prizes-db-'));
  return directory;
}

function connect(file: string, options?: ConnectOptions): DatabaseHandle {
  const handle = connectDatabase(file, options);
  open.push(handle);
  return handle;
}

function close(handle: DatabaseHandle): void {
  handle.close();
  open = open.filter(entry => entry !== handle);
}

function tables(handle: DatabaseHandle): string[] {
  return handle.sqlite
    .prepare('select name from sqlite_master where type = ? order by name')
    .all('table')
    .map(row => (row as { name: string }).name);
}

afterEach(() => {
  // A test that fails part-way can leave a handle open, and Windows refuses to
  // delete a directory holding an open SQLite file — which would hide the real
  // failure behind a cleanup error.
  for (const handle of open) {
    try {
      handle.close();
    }
    catch {
      // Already closed by the test; nothing left to do.
    }
  }

  open = [];

  if (directory !== undefined)
    rmSync(directory, { force: true, recursive: true });

  directory = undefined;
});

describe('connecting to the database', () => {
  it('creates the directory and migrates a fresh file', () => {
    expect(tables(connect(join(tempDirectory(), 'prizes.sqlite')))).toContain('assets');
  });

  it('creates nothing, not even the directory, for a read-only handle', () => {
    const file = join(tempDirectory(), 'nested', 'prizes.sqlite');

    expect(() => connectDatabase(file, { readonly: true })).toThrow();
    expect(existsSync(dirname(file))).toBe(false);
  });

  it('reads through a read-only handle, and refuses to write', () => {
    const file = join(tempDirectory(), 'prizes.sqlite');
    close(connect(file));

    const handle = connect(file, { readonly: true });
    expect(handle.db.select().from(assets).all()).toEqual([]);
    expect(() => handle.db.insert(assets).values({ name: 'A', assetId: '1', assetUrl: 'https://example.com' }).run())
      .toThrow(/readonly|read-only/i);
  });

  it('leaves the schema alone without the migrations', () => {
    expect(tables(connect(join(tempDirectory(), 'prizes.sqlite'), { migrate: false }))).toEqual([]);
  });
});
