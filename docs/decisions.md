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

## Everything comes from the page's JSON-LD, price included

The page carries a schema.org `Product` in an `application/ld+json` block: `name`, `image`,
`description`, `brand.name`, and an `offers` object with `price` and `priceCurrency`. Unity serves that
same markup to a plain HTTP client, so `POST /api/metadata` is one fetch and one parse — no headless
browser, no internal API. Category is the exception: it is not in the markup, so it comes from the page
path (`/packages/tools/gui/…` → `tools/gui`) and stays editable in the form.

The brainstorm concluded the opposite — that the price was only available client-side. Checking a live
page settled it: `offers.price` is `"32.50"` in the served HTML. The price therefore autofills like the
rest, and remains an ordinary editable field for a page that carries no offer.

## `better-sqlite3` rather than `node:sqlite`

The native module has a prebuilt binary for Node 24 and pairs with Drizzle for typed queries.
Node's built-in `node:sqlite` was the fallback if no binary was available.

## Money in cents, identifiers as text

`assets.priceCents` is an integer number of cents, with `currency` beside it, and it stays null when
the page did not provide a price. Floats were rejected: money rounding ends up as cents that never add
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
carries an expiry plus its HMAC (`SESSION_SECRET`), `HttpOnly`, `SameSite=Strict`, and `Secure` in
production. Login attempts are limited per client address, in memory. Rejected: an auth framework or a
session table — there is exactly one admin and no user records to keep, so the whole gate is thirty
lines. Two accepted consequences, both in `docs/backlog.md`: the limiter resets when the process
restarts, and changing the password does not invalidate a cookie already issued (they expire within
twelve hours).

## A batch of links is read on the server, a few at a time

`POST /api/admin/import` reads every pasted link with the same code the single-asset form uses, three
at a time with a short pause between them, and adds each prize as it arrives. One unreadable link never
stops the batch: it comes back with its reason, and the response carries the whole list so the admin
screen needs no second request. Capped at 20 links per paste, so a request cannot turn into a long
crawl of somebody else's site — which is also why the links are fetched server-side at all (a browser
fetch of the Asset Store is blocked by CORS, as the app's own testing confirmed).

Rejected: a CSV import of the old spreadsheet — links are what the admin actually has.

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

## One switch instead of a router

`App.tsx` chooses between the gallery and the admin from `location.pathname`, and follows `popstate`.
The server already serves `index.html` for `/` and `/admin`, so a link or a bookmark works on a cold
load. Rejected: a router dependency for two screens.

## No JSX accessibility lint plugin

`eslint-plugin-jsx-a11y` declares support up to ESLint 9 and this project is on ESLint 10, so it is
not installed. Accessibility is checked in review and in the browser instead.
