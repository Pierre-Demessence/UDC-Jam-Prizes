# Decisions

Non-obvious decisions: what was decided, why, and which alternatives were
rejected. Replace an entry when a decision is reversed. Mechanism belongs in the
code's own comments, `AGENTS.md` and the tests: an entry here holds the decision
and its why, plus what it rejected. Only add one when a reader would ask "why this
way and not another?".

## Vite + React client, Hono API, SQLite

One Node process with a SQLite file beside it: cheap to host, backups are a file copy, and a one-admin
login is a password plus a signed cookie rather than an auth framework. `better-sqlite3` over
`node:sqlite` because it pairs with Drizzle.

Rejected: **Next.js** (Vercel's ephemeral filesystem forces a hosted SQL service, NextAuth is heavy for
one user) and **vanilla TypeScript** (the gallery and admin form need component state).

## Metadata from the JSON-LD, the list price from the page's own product data

`POST /api/metadata` is one fetch and one parse of the schema.org `Product` block; Unity serves it to a
plain HTTP client, so no headless browser. Category is absent from the markup and comes from the page
path.

`offers.price` is the **discounted** price, so the list price comes from the page's embedded product
data, keyed by asset id. Those amounts are in the visitor's currency, so the entry is read as a
**ratio** applied to the offer's price, which keeps the catalogue in USD. Anything unexpected falls back
to the offer's price: a parse failure degrades to a discounted price, never a wrong one.

The JSON-LD is pulled out with a regex rather than cheerio or jsdom: it is one script tag holding a flat
object.

## The server runs on Node's native TypeScript support

No `tsx`: Node ≥ 23.6 strips types itself. `tsx watch` starts nothing when its output is a pipe unless
`CI` is set, so under `concurrently` it silently never launched the API.

## Admin auth: one password, no session table

The cookie carries an expiry plus its HMAC. The HMAC key is derived from `SESSION_SECRET` **and the
password**, so changing the password ends every session already issued; that is what a session table
would otherwise provide.

## A batch of links is read on the server, a few at a time

`POST /api/admin/import` reads pasted links server-side, three at a time, capped at 20 per paste so a
request cannot become a crawl of somebody else's site. One unreadable link never stops the batch.

Rejected: fetching in the browser (the Asset Store blocks it by CORS) and a CSV import of the old
spreadsheet (links are what the admin actually has).

## The admin is pinned to known addresses at the edge in the cluster

`ADMIN_IP_ALLOWLIST` pins the admin in the app, matching the socket address (which no header can spoof).
In the cluster the pin lives at the edge instead (`k8s/prod/ingress-admin.yaml`): the edge sees the real
client, and it is the one place a *path* can be restricted, which is why the admin has its own Ingress.
Consequence: the admin stops working from any network but the listed ones, and the way back in is the
middleware in the GitOps repository.

Rejected: also setting `ADMIN_IP_ALLOWLIST` in the cluster. Behind Traefik it would see one address for
every visitor.

## Key values are encrypted at rest

A donated key is worth money, so a copy of the database file must not hand out working keys. AES-256-GCM
authenticates as well as encrypts, so an edited value fails to open. Encryption is randomised, so
`key_fingerprint` (a deterministic HMAC) is what recognises duplicates. Losing `KEY_ENCRYPTION_SECRET`
makes every stored key unreadable.

Rejected: a separate encrypted file (one more thing to back up) and a passphrase entered at start-up
(the server would wait for a human).

## The author is an entity, not a column on the prize

The catalogue is a dozen people for sixty-odd prizes, so a handle copied onto every row repeated one
fact and hid that two prizes share a donor. The author also stores `discord_id` beside the handle: the
handle is a mutable display name, the id never changes.

`authors.publisher` is unique and matched case-insensitively, which is what lets reading a page, an
import or *Attach every matching prize* find the author unasked; a second author claiming one is refused
rather than making the match ambiguous. The link is `ON DELETE SET NULL`, so deleting an author leaves
prizes, keys and prices in place.

An author has no name column: it is labelled by handle, then publisher, so there is nothing to keep in
step. A free-text note belongs on the prize.

Rejected: a per-prize `contacts` row; identifying an author by handle alone (a rename orphans their
prizes); a stored free-text name.

## A key is just stock; a prize says how many it needs

A key is a value in stock for a prize, not assigned to anyone and without a status. There is no
donated count: the number an author promised and the codes received drift apart.

At the end of a jam the demand is known before any key is, so `assets.needed` records how many keys were
requested, typed straight into the admin table because it covers a batch at once. A row is tinted only
when `needed` > 0, since publishers sometimes send keys before anything is requested. The tint is paired
with a glyph because short and covered are red and green.

## No JSX accessibility lint plugin

`eslint-plugin-jsx-a11y` supports up to ESLint 9 and this project is on 10; accessibility is checked in
review and in the browser instead.

## One stateful pod, synced from GitOps

One replica with `Recreate` (see `AGENTS.md`). The image is built per commit, pushed to GHCR, and its
immutable tag is committed into `k8s/prod/deployment.yaml` by CI, the path ArgoCD watches.

Rejected: `latest` with a manual `kubectl apply` (a tag nobody records makes rollback a guess) and
PostgreSQL for several replicas (redundancy a one-admin catalogue does not need). Secrets come from
1Password through External Secrets, not a Kubernetes Secret in the GitOps repository.
`KEY_ENCRYPTION_SECRET` is irreplaceable, so the 1Password entry, not a volume snapshot, is what makes a
restored volume readable.

## The publisher id lives on the author, and the public catalogue joins it

Unity's publisher link is `/publishers/<id>` and the JSON-LD `brand` carries a name only, so the scrape
reads the anchor and stores the id on the author: a per-prize copy would repeat one number on every prize
the publisher donated. The public payload carries the id, not a built URL; the client builds the link in
one place (`publisherPageUrl`). The catalogue therefore LEFT JOINs `authors` for that one column.

Rejected: the id on the asset (duplicates a publisher-level fact); moving the publisher name to the
author too (`attachAuthorByPublisher` matches on the asset's string, and unmatched prizes would lose
their publisher); matching authors on the id as well (the name stays the only rule for now).

## Reading a page creates the author it can name

`resolveAuthorId` finds the author for a publisher, creates one from the store name and id when there is
none, and fills in an id a record was missing. The metadata lookup and the bulk import both use it, so a
prize arrives attached. The Discord handle and id stay null until the admin learns them. The find and the
insert run with no await between them, so a batch resolves to one record. An id another author already
holds is left there: a rename can leave the old record holding the id, and the unique index refuses a
second holder.

Rejected: creating the author only on save (the form would say "no author" for a prize about to get one,
and the batch path would need the rule twice) and leaving creation to the admin (twenty links from ten
publishers meant ten typing stops).

## The gallery has its own light and dark theme, scoped to the gallery

The public page offers System, Light and Dark. The tokens use `light-dark()` on `:root[data-theme]`, set by
`useTheme` only while the gallery is mounted, so the admin keeps its dark palette untouched. The choice is
kept in `localStorage` and falls back to System when storage is blocked.

Categories are a tree in a sidebar (a full-screen dialog on narrow screens), and picking a node shows
its whole subtree: stored paths are up to three levels deep, so a two-level chip row could not hold them,
and a popover would have moved the grid. Fonts are self-hosted because the CSP is `'self'` only. Theming
relies on `light-dark()` (Chrome 123, Firefox 120, Safari 17.5 and later), with no fallback.

Rejected: restyling the shared `:root` tokens (it would repaint the admin), a font CDN (blocked by the CSP
and a request to a third party per visit), and the old totals line (the design shows only the prize
count; the API still returns `totals`).
