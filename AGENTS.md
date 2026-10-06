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
- Container: `docker build -t udc-jam-prizes .`, then run it with `NODE_ENV=production`, the three
  secrets and a **writable volume at `/data`** owned by uid 1001 — the app cannot start without one.

Requires Node ≥ 23.6: the server runs on Node's native TypeScript support, so there is no `tsx`.

First run: copy `.env.example` to `.env` and set `ADMIN_PASSWORD`, `KEY_ENCRYPTION_SECRET` and
`SESSION_SECRET`. The dev and start scripts load `.env` themselves; a missing value stops the server
with a readable message. `ADMIN_IP_ALLOWLIST` is optional and pins the admin side (login included) to
known addresses; `TRUSTED_PROXY_ALLOWLIST` names the proxies whose `X-Forwarded-For` may stand in for
the socket address. Run typecheck, lint, test and build before considering work done.

## Layout

- `src/` — the React client; `main.tsx` mounts `<App>` into `#app`. `App.tsx` switches between the
  public gallery (`src/gallery/`) and the admin (`src/admin/`); API calls live in `src/api.ts`, and
  the testable logic in `src/catalogue.ts`, `src/format.ts`, `src/sort.ts`, and
  `src/admin/asset-table.ts` and `src/admin/author-table.ts` (each admin table's columns and sorting).
- `server/` — the API; `index.ts` (server + static `dist/`), `app.ts` (routes), `db.ts` (SQLite),
  `schema.ts` (the Drizzle tables), `repository.ts` (queries), `payloads.ts` (public and admin
  response shapes), `validate.ts` (input rules), `auth.ts` (session cookie + rate limits),
  `secrets.ts` (key encryption), `config.ts` (environment), `unity.ts` + `unity-fetch.ts` (reading an
  Asset Store page); `drizzle/` holds the generated SQL migrations.
- `server/fixtures/` — captured Asset Store pages the parser tests run against, one of them an asset on
  sale; refresh with `node scripts/capture-fixtures.mjs [name]`.
- `data/` — the SQLite file at runtime; gitignored, never committed.
- `index.html` — Vite HTML entry; `%APP_NAME%` is replaced from `brand.json` at build time.
- `docs/` — `backlog.md` (everything not done), `decisions.md` (non-obvious
  decisions and why), `deployment.md` (the deployed shape, its secrets and restores; update it when any
  of those change), `plans/` (work in progress).
- `k8s/prod/` — the deployed manifests (Deployment, Service, Ingress, PVC, ExternalSecret) that
  ArgoCD syncs. `.github/workflows/deploy.yml` builds the image and pins its tag in `deployment.yaml`;
  the ArgoCD `Application` that points at this path lives in the GitOps repository, not here.

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
  `TRUSTED_PROXY_ALLOWLIST` never widens those controls: it only lets a listed proxy name the caller,
  reading `X-Forwarded-For` from the right past hops that are themselves listed. List the ingress that
  sets the header — anything inside a listed network may then name the caller. The login limiter's
  window is in SQLite (`rate_limit_attempts`), so a restart cannot clear a lockout.
- `/api/metadata` fetches `https://assetstore.unity.com` only (the allow-list in `unity-fetch.ts` is
  the SSRF guard — do not widen it without a reason).
- `import-x/no-unresolved` checks every import, including the `@/` alias.

## Invariants

- Private data never leaves the API: the Discord handle and id on an author record, key values, internal
  notes, and how many keys a prize needs. Public responses are shaped server-side from an explicit field
  list, so hiding fields in the UI is not the safeguard. `assets.notes` is private too — never hand a
  whole row to a public payload. A publisher name or id is not private: the name is published from
  `assets.publisher`, and the id is the one column a public response reads from `authors` (see the
  author invariant below).
- `assets.hidden` keeps a prize off the public catalogue: `publicCatalogue` filters it out, totals
  included, while the admin list keeps it marked "Hidden" with its keys and author. Editing a prize
  through the form never changes the flag; only the table's Hide/Unhide button does.
- An author is one record shared by their prizes (`authors`, `assets.author_id`), never a field copied
  onto each. It has no name column: it is labelled by `discordHandle`, then `publisher`
  (`authorLabel`), and `parseAuthorInput` requires at least one of publisher / handle / id so a row
  stays findable. `authors.publisher` is the store string a prize matches on: unique among authors,
  compared case-insensitively by `findAuthorByPublisher`, and the only matching rule — the metadata
  prefill, the bulk import and the attach endpoint all use it. `author_id` is `ON DELETE SET NULL`, so
  deleting an author leaves every prize, key and price in place, merely unattached. Both the Discord
  handle (mutable) and the Discord id (a snowflake, kept as text) are stored for that reason.
  `authors.publisher_id` is Unity's own id for that publisher, digits kept as text and unique like the
  name: the store link is built from it, and it is the only author column a public response carries —
  `publicCatalogue` LEFT JOINs `authors` for it, so a prize with no author keeps its name and simply
  has no link. It is not a matching rule: matching is by `publisher` in the preselect, in the find that
  decides whether to create the record, and in the attach action alike.
  An author is also made without the admin: reading a page whose publisher the list does not know
  creates the record from the store name and id alone (`resolveAuthorId`, used by the metadata lookup
  and the bulk import), leaving `discordHandle` and `discordId` null until someone fills them in. The
  lookup comes first, which is what keeps a batch, or a second prize from the same publisher, to one
  record.
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
- The Deployment is one replica with the `Recreate` strategy on purpose: SQLite is a single writer on
  a `ReadWriteOnce` volume. Raising the replica count, or switching to `RollingUpdate`, either blocks
  on the volume or corrupts the database.
- The image must carry `drizzle/` beside `server/`, and `package.json` with `"type": "module"`:
  migrations are resolved relative to `server/db.ts`, and the module type is what makes Node read the
  server's `.ts` files as ESM. Losing either one breaks the pod at startup.
