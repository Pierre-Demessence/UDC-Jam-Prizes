import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/$1') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts'],
    coverage: {
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.ts', 'src/main.tsx', 'server/index.ts'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'server/**/*.ts'],
      provider: 'v8',
    },
  },
});
