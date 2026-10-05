# UDC Jam Prizes

Prize catalogue for UDC game jams, replacing the two Google Spreadsheets: a private admin to
maintain the donated Unity assets, and a public read-only page to browse them. Private fields —
Discord handles, key values, internal notes — never reach the public side.

Scaffolded with [create-corniflex](https://github.com/Pierre-Demessence/create-corniflex).

## Getting started

```sh
npm install
Copy-Item .env.example .env   # then set ADMIN_PASSWORD, KEY_ENCRYPTION_SECRET and SESSION_SECRET
npm run dev
```

`npm run dev` starts the client on <http://localhost:5173> and the API on
<http://localhost:3001> (proxied under `/api`). The SQLite file is created in `data/` on first run.

`ADMIN_PASSWORD` is the admin login; `SESSION_SECRET` (16+ characters) signs the session cookie
together with it, so changing either one ends the sessions already issued.
`KEY_ENCRYPTION_SECRET` (32+ characters) encrypts donated key values at rest, so a copy of the
SQLite file is useless without it: keep it safe, it is the only thing that can open the stored keys.
All three are read from `.env`, which is gitignored. `npm start` runs one process serving the built
client and the API, which is what a deployment would run.

## Scripts

| Script                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `npm run dev`           | Client and API in watch mode.                        |
| `npm run dev:api`       | API only.                                            |
| `npm run build`         | Type-check, then build the client.                    |
| `npm start`             | Serve the built client and the API from one process.  |
| `npm run preview`       | Preview the production build.                        |
| `npm run db:generate`   | Write a migration after editing `server/schema.ts`.  |
| `npm run db:migrate`    | Apply pending migrations explicitly.                 |
| `npm run typecheck`     | Type-check only.                                     |
| `npm run lint`          | Lint with ESLint.                                    |
| `npm run lint:fix`      | Lint and auto-fix.                                   |
| `npm test`              | Run Vitest once.                                     |
| `npm run test:watch`    | Run Vitest in watch mode.                            |
| `npm run test:coverage` | Run Vitest with coverage.                            |

## What it does

- **Public page** (`/`) — every donated asset with its image, publisher, category and price, plus a
  search box, a category filter, sorting and a totals line. No login, and no private field is ever
  sent to the browser.
- **Admin** (`/admin`) — sign in with `ADMIN_PASSWORD`, paste an Asset Store URL and have the name,
  image, publisher, category, price and Unity id filled in from the page, keep the author's Discord
  handle and internal notes, and paste the keys the author sends — the count is what the row reports,
  and the *Needed* field says how many you asked for.
  The prize list is a table — every column sorts, and each row opens its own keys and contact. Type how
  many keys a prize needs and the row says whether they have arrived: plain when nothing was asked for,
  marked up while the request is unfilled, and marked up differently once it is filled.
  *Paste several links* adds a whole batch at once (up to 20, read a few at a time), reporting per
  link whether it was added, already there, or unreadable. Key values are encrypted on the way in and
  decrypted for the admin screen only; they never leave the server in a public response.
- The price is an ordinary field: read from the page when it offers one, editable, and allowed to stay
  empty when the page has none. A sale price is not what a prize is worth, so the page's list price is
  the one that fills the form — in USD, however the page happens to localise its own amounts.

The admin side can also be pinned to known addresses: set `ADMIN_IP_ALLOWLIST` to a comma-separated
list of addresses or CIDR blocks, and everything under `/api/session`, `/api/admin/*` and
`/api/metadata` refuses any other address. Left empty, the password is the only door. Behind a reverse
proxy, set `TRUSTED_PROXY_ALLOWLIST` to the proxy's own addresses so the app reads the caller from
`X-Forwarded-For` instead of treating every visitor as the proxy; left empty, nothing is trusted.

## Deploying

The app runs on the Corniland Kubernetes cluster through ArgoCD. On a green CI run,
`.github/workflows/deploy.yml` builds the image, pushes it to GHCR and pins its immutable tag in
`k8s/prod/deployment.yaml`; the ArgoCD `Application` that syncs that path lives in the cluster's GitOps
repository. The image is one process serving the API and the built client.

Three things about the deployment are deliberate:

- **One replica, `Recreate` strategy.** SQLite is a single writer on a `ReadWriteOnce` volume, so a
  second pod would be a fault rather than redundancy.
- **The database is on a PersistentVolumeClaim** at `/data/prizes.sqlite`, and the pod's `fsGroup`
  makes that volume writable by the non-root user the app runs as.
- **The three secrets come from 1Password** through an `ExternalSecret`. `KEY_ENCRYPTION_SECRET` is the
  one that cannot be regenerated: losing it makes every stored key unreadable, so a restored database
  without it is worthless.

Checking a deployment: `kubectl -n jam-prizes-prod get pods` and
`kubectl -n jam-prizes-prod logs deploy/jam-prizes`. An image goes back by reverting the pin commit in
`k8s/prod/deployment.yaml` — ArgoCD would undo a bare `rollout undo` at its next sync. Secrets,
rollbacks and what a restore needs: [docs/deployment.md](docs/deployment.md).

## Docs

- [docs/decisions.md](docs/decisions.md) — non-obvious decisions and why.
- [docs/deployment.md](docs/deployment.md) — the deployed shape, its secrets and restores.
- [docs/backlog.md](docs/backlog.md) — everything not done yet.
- [AGENTS.md](AGENTS.md) — commands, layout and conventions for agents.
