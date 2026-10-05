import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import process from 'node:process';

import type { Config } from './config.ts';

import { createApp } from './app.ts';
import { ConfigError, readConfig } from './config.ts';
import { connectDatabase } from './db.ts';
import { encryptLegacyKeys } from './repository.ts';

let config: Config;
try {
  config = readConfig();
}
catch (error) {
  if (!(error instanceof ConfigError))
    throw error;

  // The one failure worth a plain sentence: the server cannot start without it.

  console.error(error.message);
  process.exit(1);
}

const handle = connectDatabase(config.databasePath);

// Keys written before encryption existed are rewritten here, before the server
// takes a request. On a healthy database this does nothing.
const encrypted = encryptLegacyKeys(handle.db, config.keyEncryptionSecret);
if (encrypted > 0)
  // eslint-disable-next-line no-console
  console.log(`Encrypted ${encrypted} key${encrypted === 1 ? '' : 's'} that were stored in clear text`);

const app = createApp({ config, handle });

// In a deployment this process also serves the built client. In development
// Vite serves it and proxies /api here, so this block is inert unless dist/
// exists from an earlier build.
if (existsSync('./dist/index.html')) {
  app.use('/assets/*', serveStatic({ root: './dist' }));
  for (const route of ['/', '/admin', '/admin/*'])
    app.get(route, serveStatic({ path: './dist/index.html' }));
}

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  // The server's one startup line; console.warn would misreport it as a problem.
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${info.port}`);
});

function shutdown(): void {
  server.close();
  handle.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
