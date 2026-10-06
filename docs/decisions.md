# Decisions

Non-obvious decisions: what was decided, why, and which alternatives were
rejected. Replace an entry when a decision is reversed. Mechanism belongs in the
code's own comments, `AGENTS.md` and the tests: an entry here holds the decision
and its why, plus what it rejected.

## One app with two faces

The catalogue is one application with two faces: a private admin that writes and a public read-only
page, over one database. Public responses are built server-side from an explicit field list, so hiding
a field in the UI is never what keeps Discord handles, key values or notes private.

Rejected: two apps, or a static export of the public list. Both duplicate the data model and turn
"never publish private fields" into a matter of discipline rather than design.

## Vite + React client, Hono API, SQLite

Chosen so the whole app is one Node process with a SQLite file beside it: cheap to host anywhere,
backups are a file copy once the write-ahead log is checkpointed, and a one-admin login is a password
plus a signed `HttpOnly` cookie instead of an auth framework.

Rejected: **Next.js full-stack**, which the brainstorm recommended — Vercel's ephemeral filesystem
forces a hosted SQL service (more accounts, more moving parts) and NextAuth is heavy for a single
user. Also rejected: **Vite + vanilla TypeScript**, the template's default, because the public gallery
and the admin form need real component state.

## Metadata from the JSON-LD, the list price from the page's own product data

`POST /api/metadata` is one fetch of the asset page and one parse of its schema.org `Product` block, no
headless browser, because Unity serves that markup to a plain HTTP client. Category is the exception —
absent from the markup, so it comes from the page path and stays editable.

The price needs a second source: `offers.price` is the **discounted** price, so the page's own embedded
copy of the product, keyed by Unity's asset id, supplies the list price beside it. Those amounts are in
the visitor's currency, so the entry is read as a **ratio** and applied to the offer's price, which
keeps the catalogue in USD; an offer in another currency counts as no price at all. Anything unexpected
leaves the offer's price as it stands, so a parse failure degrades to a discounted price rather than a
wrong one.

Rejected: a headless browser, unnecessary while the markup is in the served HTML. The brainstorm held
the price to be client-side only; checking a live page settled it.

## `better-sqlite3` rather than `node:sqlite`

The native module has a prebuilt binary for Node 24 and pairs with Drizzle for typed queries.

Rejected: Node's built-in `node:sqlite`, the fallback if no binary had been available.

## Money in cents, identifiers as text

`assets.priceCents` is an integer number of cents, null when the page gave no price; prices are USD, so
no currency is stored beside them. Unity's `assetId` is text — a label, never arithmetic — carrying the
unique index that turns re-importing a sheet row into an update instead of a duplicate.

Rejected: floats — money rounding ends up as cents that never add up.

## Migrations run on every connect

`connectDatabase` applies the generated migrations, so a stale database cannot happen and a fresh clone
just works; `db:migrate` remains for a deploy that prefers an explicit step, and the options let a
non-app caller opt out of writing or migrating.

Rejected: migrating by hand before each run, which surfaces as a "no such table" error while serving a
request.

## Assets are a flat list, with no quantities

The catalogue lists every asset with its image, name and price, and the header totals the prices.
There is no donated count and no "N left" number: the count an author promised and the codes actually
received drift apart, and the number went unused. The `keys` table stays, but a key is stock for its
prize and nothing more (see "A key is just stock").

## Timestamp defaults live in the application, not the database

`created_at` / `updated_at` are runtime defaults with no SQL `DEFAULT`, deliberately: this app is the
only writer and writes through Drizzle, and SQLite cannot add a default to an existing column without
rebuilding the table. The cost is that a raw-SQL writer must supply the timestamps itself. Revisit if a
second writer ever appears.

## The server runs on Node's native TypeScript support

`dev:api` is `node --watch server/index.ts` and `start` is `node server/index.ts`, so `tsx` is not a
dependency — Node ≥ 23.6 strips types natively, with the explicit `.ts` extension kept on the server's
relative imports.

Rejected: `tsx watch`, which starts nothing when its output is a pipe unless `CI` is set, so under
`concurrently` it silently never launched the API; and no watcher at all, which means restarting by
hand after every edit.

## Parsing without a DOM library

`server/unity.ts` pulls the `ld+json` block out with a regex and parses it with `JSON.parse`: the block
is one script tag holding a flat object, so a DOM parser would buy nothing.

Rejected: cheerio or jsdom, for that reason.

## Admin auth: one password, no session table

`ADMIN_PASSWORD` comes from the environment and is compared in constant time; the cookie carries an
expiry plus its HMAC, `HttpOnly`, `SameSite=Strict`, and `Secure` in production. The HMAC key is
derived from `SESSION_SECRET` **and the password**, so changing the password ends every session already
issued. Its rate limit shares the store described in "The rate limiter's window lives in SQLite".

Rejected: an auth framework or a session table — there is exactly one admin and no user records, so
the whole gate is thirty lines, and the derived key is what a session table would otherwise provide.

## A batch of links is read on the server, a few at a time

`POST /api/admin/import` reads every pasted link with the same code the single-asset form uses, three at
a time with a short pause, and adds each prize as it arrives. One unreadable link never stops the batch:
it comes back with its reason, and the response carries the whole list. Capped at 20 links per paste, so
a request cannot become a long crawl of somebody else's site.

Rejected: fetching in the browser (the Asset Store blocks it by CORS, as the app's own testing
confirmed), and a CSV import of the old spreadsheet — links are what the admin actually has.

## Shutdown waits for the requests in flight

On SIGTERM the process stops taking new connections, closes the idle keep-alive sockets, and lets the
requests already running finish before the database is closed and the process exits; a 10 s backstop
drops whatever is left, and a second signal means "now". The Deployment's 30 s grace is the real limit:
this makes the pod use it instead of cutting a response in half.

Rejected: exiting at once, which dropped a response mid-write on every deploy.

## The rate limiter's window lives in SQLite

The login endpoint is the only unauthenticated writer, and a lockout a restart clears is no lockout
against anyone able to restart the process, so its window is kept in the database rather than in a
`Map`. The admin-only limiters share that store, so one rule covers all three.

Rejected: keeping the window in memory and persisting only the lockout — two rules for one guarantee.

## The admin can be pinned to known addresses

`ADMIN_IP_ALLOWLIST` (addresses, CIDR blocks, IPv6 literals) closes `/api/session`, `/api/admin/*` and
`/api/metadata` to every other address, the login included; an empty list leaves the admin reachable
from anywhere, and local addresses stay allowed outside production so a dev machine cannot lock itself
out. The address matched is the socket's, which no header can spoof.

Behind a reverse proxy that would be the proxy for every visitor, so `TRUSTED_PROXY_ALLOWLIST` names
the proxies whose `X-Forwarded-For` counts (the walk is in `AGENTS.md`); it never widens the control,
only lets a listed proxy name the caller. List the ingress that sets the header, not a whole pod
network. Empty trusts nobody.

In the cluster that pin lives at the edge instead (`k8s/prod/ingress-admin.yaml`, admin paths only): the
edge sees the real client, where the app would see the proxy, and it is the one place a *path* can be
restricted — the middleware attaches to a router, not to a path inside one, which is why the admin has
its own Ingress rather than another path in the gallery's. Accepted consequence: the admin stops working
from any network but the listed ones, and the way back in is the middleware in the GitOps repository.

Rejected: also setting `ADMIN_IP_ALLOWLIST` in the cluster. It matches the socket address, so behind
Traefik it would see one address for every visitor — an in-app second rule where the edge already
decides.

## Key values are encrypted at rest

A donated key is worth money, so a copy of `data/prizes.sqlite` — a backup, a synced folder, a stolen
laptop — should not hand out working keys. `keys.key_value` holds AES-256-GCM ciphertext under a key
derived from `KEY_ENCRYPTION_SECRET`, which authenticates as well as encrypts: an edited value fails to
open instead of coming back as garbage.

Encryption is randomised, so `key_fingerprint` holds a deterministic HMAC of the key, to recognise a
duplicate where a `UNIQUE` index on the ciphertext cannot. It is nullable, and rows lacking one are
backfilled at start-up, which is how keys stored in clear text before encryption existed get encrypted.
Losing `KEY_ENCRYPTION_SECRET` makes every stored key unreadable, and the admin API is the only place a
key is ever in clear.

Rejected: storing keys in a separate encrypted file (one more thing to back up, no gain) and a
passphrase-derived key entered at start-up (the server would sit waiting for a human).

## The admin list is a table, sorted by hand

The admin is a tool, not a shop window: one row per prize and one column per fact rather than a card per
prize, which hid the columns that could be compared. Keys stay behind a row's own panel instead of in a
cell, while the author is a column of its own.

Sorting is one comparator per column (`src/admin/asset-table.ts`), matching the public gallery: a
missing value sorts last in **both** directions, because an unpriced asset is not "the cheapest", and a
tie breaks on the name. The column shows a ▲/▼ glyph and carries `aria-sort`, so direction is never
colour alone.

Rejected: a table library, a dependency for what one comparator per column does.

## The author is an entity, not a column on the prize

A prize's donor lives in `authors`, one record per person, and `assets.author_id` points at it. The
catalogue comes from a dozen people for sixty-odd prizes, so a handle copied onto every row was the
same fact repeated, and it made two prizes by one person impossible to see as one. The author also
carries `discord_id` beside the handle: the handle is a mutable display name and the id is the
snowflake that never changes, so a rename would otherwise split one person into two records.

`authors.publisher` is the store publisher string, unique among authors and matched
case-insensitively. It is what makes the record pay off: reading a page, importing a batch or pressing
*Attach every matching prize* finds the author unasked, and a preselect is only trustworthy if a
publisher can mean one person — so the second author claiming one is refused with a sentence rather
than making the match quietly ambiguous.

The link is `ON DELETE SET NULL`, the opposite of the cascade `contacts` had from the asset: deleting
an author leaves every prize, key and price in place, unattached.

An author carries no name of its own: it is labelled by the Discord handle, falling back to the store
publisher, so the label cannot drift from either and there is no field to fill twice. At least one of
publisher / handle / id is required, because a record with none of them could not be found again or
told apart from the next one. Nothing else lives on the record: a free-text note belongs on the prize
(`assets.notes`) or nowhere, and the contact notes the author inherited were per prize to begin with.

Rejected: keeping the per-prize `contacts` row (the duplication this fixes, and no way to treat a
repeated donor as one person); identifying an author by the handle alone (a rename orphans their
prizes); a stored free-text name (a third label to keep in step with the handle and the publisher),
and with it a free-text name and no publisher link at all (sixty prizes would still need sixty manual
picks, and nothing could be preselected).

## A key is just stock

A key is a value in stock for a prize, and nothing else: it is not assigned to anyone, it has no status,
and the app does not record who received it. The *Needed* field took over the planning.

## A prize says how many keys it needs

At the end of a jam the demand is known before any key is: winners say which assets they want, the
publishers are asked for that many keys, and the keys arrive later. `assets.needed` records that
request, typed straight into the admin table's field rather than the edit form because it covers a
whole batch at once, and it stays on the admin side.

A row is tinted and glyph-marked only when `needed` is greater than zero, comparing keys stored against
keys asked for; publishers sometimes send keys before anything is requested, and an unasked-for prize
should not look like a problem. The glyph carries the meaning as well as the tint, since short and
covered are red and green, the pair the admin cannot tell apart by colour.

## One switch instead of a router

`App.tsx` chooses between the gallery and the admin from `location.pathname` and follows `popstate`, and
the server serves `index.html` for both paths, so a link or bookmark works on a cold load.

Rejected: a router dependency for two screens.

## No JSX accessibility lint plugin

`eslint-plugin-jsx-a11y` declares support up to ESLint 9 and this project is on ESLint 10, so it is not
installed; accessibility is checked in review and in the browser instead.

## One stateful pod, synced from GitOps

The app deploys to a Kubernetes cluster as a single replica of an image that serves the API and the
built client, with the SQLite file on a `ReadWriteOnce` PVC, and `Recreate` rather than `RollingUpdate`:
SQLite is a single writer, so a second pod would either wait for a volume only one may hold or mount the
same file twice. That is also why there is no second replica, no PodDisruptionBudget and no autoscaler.

The image is built per commit, pushed to GHCR, and its immutable tag is committed into
`k8s/prod/deployment.yaml` by CI, the path ArgoCD watches.

Rejected: `latest` with a manual `kubectl apply` (the cluster runs no image updater, and a tag nobody
records makes rollback a guess) and PostgreSQL for several replicas, which trades the reason SQLite was
chosen for redundancy a one-admin catalogue does not need. Secrets come from 1Password through External
Secrets rather than a Kubernetes Secret committed to the GitOps repository, which the cluster can read;
`KEY_ENCRYPTION_SECRET` is irreplaceable, so the 1Password entry, not a volume snapshot, is what makes
a restored volume readable.

`TRUSTED_PROXY_ALLOWLIST` is set to the node's pod range, so the app reads the caller the ingress named;
`ADMIN_IP_ALLOWLIST` stays unset because the pin lives at the edge instead (see "The admin can be
pinned to known addresses").

## The publisher id lives on the author, and the public catalogue joins it

Unity renders the publisher of an asset as an anchor beside the title, `/publishers/<id>`, and its
JSON-LD `brand` carries a name only, so the scrape reads that anchor and stores the id on the author
(`authors.publisher_id`). An author is already one record per publisher, so a per-prize copy would
repeat the same number on every prize they donated, and the link it builds is the same for all of
them.

Rejected: **the id on the asset.** It would keep the public catalogue a single-table read, but it
duplicates a publisher-level fact on every prize and gives one column two meanings.

Rejected: **the id on the author *and* the publisher name moved there**, so the asset row holds no
store identity at all. The publisher string on the asset is what `attachAuthorByPublisher` matches on
and what a prize shows before any author exists; moving it would break attaching a back catalogue in
one click and blank the publisher on every unmatched prize.

The public payload carries the id (`publisherId`), not a built URL: the id is the store's fact, and
building a link from it is a display concern the client does in one place (`publisherPageUrl`). The
catalogue therefore LEFT JOINs `authors`, so a public response reads one column from a private table —
the publisher id alone, the name it belongs to being public already. Rejected: **matching authors on
the id as well**, which the id would allow; the name stays the only matching rule for now.

## Reading a page creates the author it can name

A Unity page names its publisher, and that name is the key a prize matches an author by, so the record
can be made without the admin: `resolveAuthorId` finds the author for a publisher, makes one from the
store name and id when there is none, and fills in an id an existing record was missing. Both scrape
paths use it — the metadata lookup that prefills the prize form, and the bulk import — so a prize
arrives attached instead of waiting for someone to type the publisher in again. The Discord handle and
id stay null until the admin learns them: the panel is still where a store name becomes a person.

Rejected: **creating the author only when the prize is saved.** That keeps the metadata lookup a pure
read, but the form then shows "no author attached" for a prize that is about to get one, and the batch
path would need the rule written a second time.

Rejected: **leaving creation to the admin**, which is what the list did. Reading twenty links from ten
publishers then meant ten typing stops for information the pages had already given.

The lookup comes first — one synchronous call, with no await between the find and the insert — so a
batch, or a second prize from the same publisher, resolves to one record. An id another author already
holds is left where it is and the new record goes without it: a rename leaves the old record keeping
the id while the store serves a new name, and the unique index refuses a second holder.
