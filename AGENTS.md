# AGENTS.md

Agent operating notes for **UDC Jam Prizes**: a Vite + React (strict TypeScript) client with a
small Hono API and a SQLite database.

## Commands

- Dev, client + API together: `npm run dev` — Vite on :5173, API on :3001, `/api` proxied.
- API only: `npm run dev:api` (Node's own watcher, no dev-time transpiler)
- Type-check: `npm run typecheck` (also the first half of `build`)
- Build: `npm run build` (runs `tsc --noEmit`, then `vite build`)
- Production: `npm start` — one Node process serving `dist/` and the API
- Database: edit `server/schema.ts`, then `npm run db:generate`. Dev applies migrations on connect;
  `npm run db:migrate` is for a deploy that would rather migrate explicitly. `DATABASE_PATH`
  overrides the file (default `data/prizes.sqlite`).
- Lint: `npm run lint` / `npm run lint:fix`
- Test: `npm test` / `npm run test:watch` / `npm run test:coverage`

Requires Node ≥ 23.6: the server runs on Node's native TypeScript support, so there is no `tsx`.

First run: copy `.env.example` to `.env` and set `ADMIN_PASSWORD`, `KEY_ENCRYPTION_SECRET` and
`SESSION_SECRET`. The dev and start scripts load `.env` themselves; a missing value stops the server
with a readable message. `ADMIN_IP_ALLOWLIST` is optional and pins the admin side (login included) to
known addresses. Run typecheck, lint, test and build before considering work done.

## Layout

- `src/` — the React client; `main.tsx` mounts `<App>` into `#app`. `App.tsx` switches between the
  public gallery (`src/gallery/`) and the admin (`src/admin/`); API calls live in `src/api.ts`, and
  the testable logic in `src/catalogue.ts`, `src/format.ts`, `src/sort.ts` and
  `src/admin/asset-table.ts` (the admin table's columns and sorting).
- `server/` — the API; `index.ts` (server + static `dist/`), `app.ts` (routes), `db.ts` (SQLite),
  `schema.ts` (the Drizzle tables), `repository.ts` (queries), `payloads.ts` (public and admin
  response shapes), `validate.ts` (input rules), `auth.ts` (session cookie + rate limits),
  `secrets.ts` (key encryption), `config.ts` (environment), `unity.ts` + `unity-fetch.ts` (reading an
  Asset Store page); `drizzle/` holds the generated SQL migrations.
- `server/fixtures/` — a captured Asset Store page the parser tests run against; refresh it with
  `node scripts/capture-fixtures.mjs`.
- `data/` — the SQLite file at runtime; gitignored, never committed.
- `index.html` — Vite HTML entry; `%APP_NAME%` is replaced from `brand.json` at build time.
- `docs/` — `backlog.md` (everything not done), `decisions.md` (non-obvious
  decisions and why), `plans/` (work in progress).

## Conventions

- Import from `@/…` in the client and with relative `./…` paths in the server.
- The server is executed directly by Node, so its relative imports keep the explicit `.ts`
  extension and only erasable TypeScript syntax is allowed (both enforced by `tsconfig.json`).
- Co-locate tests with source as `<name>.test.ts(x)`; the server's tests run in the same Vitest config.
- 2-space indent, single quotes, semicolons (enforced by ESLint).
- ESLint (`@antfu/eslint-config`, with `react: true`) sorts object and interface keys with `id` and
  `name` first, and imports as one flat list; a comment line starts a new
  sorting partition. Tests must not depend on object key order. `server/api.test.ts`
  pins the public field list; keep it in sync when the shape changes.
- Every `/api/admin/*` route and `/api/metadata` sits behind the admin gate; `GET /api/assets` is the
  only unauthenticated data route. When `ADMIN_IP_ALLOWLIST` is set, the same three path groups refuse
  other addresses first — the gate is `gateAddress` in `server/app.ts`, next to the password check.
- `/api/metadata` fetches `https://assetstore.unity.com` only (the allow-list in `unity-fetch.ts` is
  the SSRF guard — do not widen it without a reason).
- `import-x/no-unresolved` checks every import, including the `@/` alias.

## Invariants

- Private data (Discord handles, key values, internal notes, how many keys a prize needs) never leaves
  the API: public responses are shaped server-side from an explicit field list, so hiding fields in the
  UI is not the safeguard. `assets.notes` is private too — never hand a whole row to a public payload.
- Key values are ciphertext at rest (`server/secrets.ts`, AES-256-GCM, key from
  `KEY_ENCRYPTION_SECRET`): never write a key with a plain insert, and never compare `key_value` for
  duplicates — encryption is randomised. `keys.key_fingerprint` is what recognises a repeated key, and
  `encryptLegacyKeys` fills it in at startup for rows that predate encryption.
- All writes go through Drizzle: `created_at` / `updated_at` are runtime defaults with no SQL
  `DEFAULT`, so a raw-SQL insert fails the `NOT NULL` constraint.
- `PRAGMA foreign_keys` is per connection. Anything that does not go through `connectDatabase` —
  `npm run db:migrate`, a `sqlite3` session — runs at SQLite's default, which is off.
- Keep the `@/*` alias in sync across `tsconfig.json`, `vite.config.ts` and
  `vitest.config.ts`.
- The app name comes from `brand.json`; never hard-code it in `index.html`.
- The API listens on 3001 and the Vite dev proxy targets it; change both together.
