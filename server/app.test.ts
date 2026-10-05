// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createApp } from './app.ts';
import { connectDatabase } from './db.ts';
import { testConfig } from './testing.ts';

const handle = connectDatabase(':memory:');
const app = createApp({ config: testConfig(), handle });

describe('get /api/health', () => {
  it('reports the API and the database as ok', async () => {
    const response = await app.request('/api/health');
    const body = await response.json() as { database: string; status: string; uptime: number };

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.database).toBe('ok');
  });
});

describe('unknown routes', () => {
  it('answers an unknown API path with JSON', async () => {
    const response = await app.request('/api/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
