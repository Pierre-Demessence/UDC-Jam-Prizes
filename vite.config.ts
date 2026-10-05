import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const brand = JSON.parse(readFileSync(resolve(import.meta.dirname, 'brand.json'), 'utf8')) as { name: string };

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-brand',
      transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', () => brand.name),
    },
  ],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: resolve(import.meta.dirname, 'src/$1') },
    ],
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
