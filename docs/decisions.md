# Decisions

Non-obvious decisions: what was decided, why, and which alternatives were
rejected. Replace an entry when a decision is reversed.

## One app with two faces

The catalogue is a single application: a private admin (write) and a public read-only page (read)
over one database. Private fields — Discord handles, key values, internal notes — are removed
server-side when public responses are built, so the UI is never what keeps them private.

Rejected: two separate apps, or a static export of the public list. Both duplicate the data model
and turn "never publish private fields" into a matter of discipline rather than design.

## Vite + React client, Hono API, SQLite

Chosen so the whole app is one Node process with a SQLite file beside it: cheap to host anywhere,
backups are a file copy once the write-ahead log is checkpointed, and a one-admin login is a password
plus a signed `HttpOnly` cookie instead of an auth framework. The house template's ESLint config,
strict tsconfig, Vitest setup, `brand.json` injection and `docs/` scaffolding are kept as-is.

Rejected: **Next.js full-stack**, which the brainstorm recommended, because Vercel's ephemeral
filesystem forces a hosted SQL service (more accounts, more moving parts) and NextAuth is heavy for
a single user. Also rejected: **Vite + vanilla TypeScript**, the template's default, because the
public gallery and the admin form need real component state.

## Metadata from the JSON-LD, the list price from the page's own product data

The page carries a schema.org `Product` in an `application/ld+json` block: `name`, `image`,
`description`, `brand.name`, and an `offers` object with a `price`. Unity serves that
same markup to a plain HTTP client, so `POST /api/metadata` is one fetch and one parse — no headless
browser, no internal API. Category is the exception: it is not in the markup, so it comes from the page
path (`/packages/tools/gui/…` → `tools/gui`) and stays editable in the form.

The catalogue is USD, which is what a server-side request gets from Unity. The offer's
`priceCurrency` is read only to check that: an offer that declares another currency is treated as no
price at all, so the admin types the right one by hand instead of a foreign amount entering the
totals as dollars. An offer that declares no currency is taken at face value.

The price needs one more source: `offers.price` is the **discounted** price, so a prize imported during
a sale would be valued at the price of the week. The page also embeds its own copy of the product, keyed
by Unity's asset id, and that copy holds the list price beside the sale price. Its amounts are in the
visitor's own currency, which a server has no say in, so the entry is read as a **ratio** — a ratio
holds whatever the currency — and applied to the offer's price: 4.87 USD at 29.90/4.48 becomes 32.50,
the list price, and the catalogue stays in USD. Reading the entry means locating `"<id>":{"id":"<id>"`
and matching braces to its end (a few kB out of an 870 kB page, no second request).

Anything unexpected — no entry, another kind of item, a missing or zero amount, markup that changed
shape — leaves the offer's price as it stands, so a parse failure degrades to the old behaviour rather
than to no price or a wrong one. `scripts/capture-fixtures.mjs` trims that entry into the test fixture
for the discounted page, so both prices stay covered by a test.

The brainstorm concluded the opposite — that the price was only available client-side. Checking a live
page settled it: `offers.price` is present in the served HTML, and so is the list price.

## `better-sqlite3` rather than `node:sqlite`

The native module has a prebuilt binary for Node 24 and pairs with Drizzle for typed queries.
Node's built-in `node:sqlite` was the fallback if no binary was available.

## Money in cents, identifiers as text

`assets.priceCents` is an integer number of cents and it stays null when the page did not provide a
price; prices are USD, which is what a server-side request gets from Unity, so no currency is stored
beside them. Floats were rejected: money rounding ends up as cents that never add
up. Unity's `assetId` is text — it labels an asset and is never arithmetic — and it carries the unique
index that turns re-importing a sheet row into an update instead of a duplicate.

## Migrations run on every connect

`connectDatabase` applies the generated migrations, so a stale database cannot happen and a fresh clone
just works. `npm run db:generate` writes the SQL after a schema change; `npm run db:migrate` remains for
a deploy that prefers an explicit step. Rejected: migrating by hand before each run, which surfaces as a
"no such table" error while serving a request.

## Assets are a flat list, with no quantities

The catalogue lists every asset with its image, name and price, and the header totals the prices. There
is no donated count and no "N left" number: the count an author promised and the codes actually received
drift apart, and the number went unused. The `keys` table stays, to know which code went to which winner
— a key's `status` describes that one key, it is not an availability calculation.

## Two constraints live in the application, not in the database

`keys.status` is a TypeScript union with no SQL `CHECK`, and `created_at` / `updated_at` are runtime
defaults with no SQL `DEFAULT`. Both are deliberate: this app is the only writer and it writes through
Drizzle, and SQLite cannot add either to an existing column without rebuilding the table. The cost is
that a raw-SQL writer — the deferred CSV import, a `sqlite3` session — must respect the enum and supply
the timestamps itself. Revisit if a second writer ever appears.

## The server runs on Node's native TypeScript support

`npm run dev:api` is `node --watch server/index.ts` and `npm start` is `node server/index.ts`, so
`tsx` is not a dependency. That needs Node ≥ 23.6, where type stripping is on by default, and the
server keeps the explicit `.ts` extension on its relative imports (`tsconfig.json` sets
`erasableSyntaxOnly` and `allowImportingTsExtensions` to keep that honest).

Rejected: `tsx watch`, which starts nothing when its output is a pipe unless `CI` is set — under
`concurrently` it silently never launched the API. Also rejected: no watcher at all, which means
restarting the API by hand after every edit.

## Parsing without a DOM library

`server/unity.ts` pulls the `ld+json` block out with a regex and parses it with `JSON.parse`, rather
than adding cheerio or jsdom. The block is one script tag holding a flat object, so a DOM parser would
buy nothing. `server/fixtures/asset-page.html` keeps the real metadata portion of a captured page —
every `<meta>` tag and the JSON-LD blocks verbatim — so the tests stay honest about Unity's markup.

## Admin auth: one password, no session table

`ADMIN_PASSWORD` comes from the environment and is compared in constant time; on success the cookie
carries an expiry plus its HMAC, `HttpOnly`, `SameSite=Strict`, and `Secure` in production. That HMAC
key is derived from `SESSION_SECRET` **and the password**, so changing the password ends every session
already issued — the moment revoking them matters — instead of leaving a cookie valid for its full
twelve hours. Login attempts are limited per client address, in memory. Rejected: an auth framework or
a session table — there is exactly one admin and no user records to keep, so the whole gate is thirty
lines, and the derived key is what a session table would otherwise be needed for. One accepted
consequence, in `docs/backlog.md`: the limiter resets when the process restarts.

## A batch of links is read on the server, a few at a time

`POST /api/admin/import` reads every pasted link with the same code the single-asset form uses, three
at a time with a short pause between them, and adds each prize as it arrives. One unreadable link never
stops the batch: it comes back with its reason, and the response carries the whole list so the admin
screen needs no second request. Capped at 20 links per paste, so a request cannot turn into a long
crawl of somebody else's site — which is also why the links are fetched server-side at all (a browser
fetch of the Asset Store is blocked by CORS, as the app's own testing confirmed).

Rejected: a CSV import of the old spreadsheet — links are what the admin actually has.

## Shutdown waits for the requests in flight

On SIGTERM the process stops taking new connections, closes the idle keep-alive sockets, and lets the
requests already running finish before the database is closed and the process exits. A 10 s backstop
drops whatever is left, and a second signal means "now". The Deployment's 30 s grace is the real
limit: this makes the pod use it instead of cutting a response in half. Rejected: exiting at once,
which dropped a response mid-write on every deploy.

## The admin can be pinned to known addresses

`ADMIN_IP_ALLOWLIST` (addresses, CIDR blocks, IPv6 literals) closes `/api/session`, `/api/admin/*` and
`/api/metadata` to every other address, the login included; an empty list leaves the admin reachable
from anywhere. It matches the **socket** address, which a header cannot spoof, and local addresses stay
allowed outside production so a dev machine cannot lock itself out.

The consequence to know: behind a reverse proxy every visitor arrives from the proxy's address, so the
list, like the rate limiter, sees one address for everyone (`docs/backlog.md`).

## Key values are encrypted at rest

A donated key is worth money, so a copy of `data/prizes.sqlite` — a backup, a synced folder, a stolen
laptop — should not hand out working keys. Values are stored as AES-256-GCM ciphertext in
`keys.key_value`, with the key derived from `KEY_ENCRYPTION_SECRET` (scrypt, then cached, because a
paste of twenty keys would otherwise pay the derivation cost forty times).

GCM authenticates as well as encrypts: a value that was edited in the database fails to open instead
of coming back as garbage. The admin screen then prints "unreadable: KEY_ENCRYPTION_SECRET cannot open
this value" for that row rather than base64 nobody would notice. A value only counts as ciphertext
when it has the shape ours do — the `v1:` prefix, valid base64, and long enough to hold an iv and an
auth tag — so a donated key that literally starts with `v1:` is encrypted like any other instead of
being mistaken for a broken row.

Encryption is randomised, so the same key stored twice has two different ciphertexts and the old
`UNIQUE` index on `key_value` can no longer spot a duplicate. A second column, `key_fingerprint`, holds
an HMAC-SHA256 of the key — deterministic, one-way, and salted with the same secret, so fingerprints
only compare within one deployment. It is nullable, and the app rewrites any row that lacks one at
startup: that is how keys stored in clear text before this change get encrypted, and it is why the
migration could be additive.

Consequences worth knowing: losing `KEY_ENCRYPTION_SECRET` makes every stored key unreadable (the
fingerprints cannot be reversed either); the admin API decrypts, so it is the only place a key is ever
in clear, and the public payload has no key fields at all. Rejected: storing keys in a separate
encrypted file (one more thing to back up, no gain) and a passphrase-derived key entered at start-up
(the server would sit waiting for a human).

## The admin list is a table, sorted by hand

The admin is a tool, not a shop window: what matters is seeing every prize and its state at once. The
list is therefore a table — one row per prize, one column per fact (prize, author, category, price,
keys, contact) — rather than a card per prize, which spent three lines of vertical space per asset and
hid the columns that could be compared. Keys and the author's contact stay behind a row's own panel: a
status select per key does not belong in a cell.

Every column sorts, and sorting is thirty lines of plain code (`src/admin/asset-table.ts`), so no table
library was added; the alternative would have been a dependency for what one comparator per column
does. The rules match the public gallery: a missing value — no author, no price, no contact — sorts
last in **both** directions, because an unpriced asset is not "the cheapest", and a tie breaks on the
name so the order never wobbles between renders. The column shows a ▲/▼ glyph and carries `aria-sort`,
so the direction is never colour alone.

## A key is just stock

A key is a value in stock for a prize, and nothing else: it is not assigned to anyone, it has no status,
and the app does not record who received it. Those fields went once the *Needed* field took over the
planning — knowing how many keys a prize requires and how many are stored is what the delivery work
needs, and the recipient list lived in a spreadsheet nobody consulted again. They are gone from the
table too, so the shape of a key is the shape of the work.

## A prize says how many keys it needs

At the end of a jam the demand is known before any key is: winners say which assets they want, the
publishers are asked for that many keys, and the keys arrive later. `assets.needed` records that
request, typed straight into the admin table's own field rather than through the edit form, because it
is entered for a whole batch of prizes at once.

A row is tinted and marked with a glyph only when `needed` is greater than zero: publishers sometimes
send keys before anything is requested, and an unasked-for prize should not look like a problem. The
mark compares the two counts directly — as many keys stored as asked for means covered — so the row
needs no third state. The glyph carries the meaning as well as the tint, since short and covered are
red and green, the pair the admin cannot tell apart by colour; the counts live in its tooltip.

`needed` is planning information and stays on the admin side; the public payload has no such field.

## One switch instead of a router

`App.tsx` chooses between the gallery and the admin from `location.pathname`, and follows `popstate`.
The server already serves `index.html` for `/` and `/admin`, so a link or a bookmark works on a cold
load. Rejected: a router dependency for two screens.

## No JSX accessibility lint plugin

`eslint-plugin-jsx-a11y` declares support up to ESLint 9 and this project is on ESLint 10, so it is
not installed. Accessibility is checked in review and in the browser instead.

## One stateful pod, synced from GitOps

The app deploys to the Corniland cluster as a single replica of an image that serves the API and the
built client, with the SQLite file on a `ReadWriteOnce` PersistentVolumeClaim. `Recreate` rather than
the default `RollingUpdate`, because SQLite is a single writer: a second pod would either wait for a
volume only one may hold or mount the same file twice. That is also why the usual production hardening
is absent here — no second replica, no PodDisruptionBudget, no autoscaler: none of it can help a
workload whose database is a file beside it.

The image is built per commit, pushed to GHCR, and its immutable tag is committed into
`k8s/prod/deployment.yaml` by CI, which is the path ArgoCD watches. Rejected: `latest` with a manual
`kubectl apply` — the cluster runs no image updater, and a tag nobody records makes a rollback a guess.
Also rejected: moving to PostgreSQL to allow several replicas, which trades the reason SQLite was
chosen at all (see "Vite + React client, Hono API, SQLite") for redundancy a one-admin catalogue does
not need.

Secrets come from 1Password through External Secrets rather than from a Kubernetes Secret committed to
the GitOps repository: that repository is the deployment's source of truth and is readable by the
cluster, and `KEY_ENCRYPTION_SECRET` is the one value whose loss makes every stored key unreadable, so
it belongs where access and rotation are controlled. The consequence to know: the 1Password entry is
what makes a restored volume readable, and no snapshot of the volume can replace it.

`ADMIN_IP_ALLOWLIST` stays unset in the cluster. Behind Traefik the app sees the proxy's socket address,
so the list would see one address for every visitor (see "The admin can be pinned to known addresses").
Pinning the admin at the edge is possible and deliberately not done: it would bar the admin from every
network but the listed one.
