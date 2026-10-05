import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dbCredentials: { url: 'data/prizes.sqlite' },
  dialect: 'sqlite',
  out: 'drizzle',
  schema: './server/schema.ts',
});
