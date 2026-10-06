# Publisher page link

## Goal

Read the store publisher id off an Asset Store page while scraping, keep it on the author record
(its only home), and derive a Unity publisher page link from it for the public gallery and the admin
authors panel.

## Acceptance criteria

- WHEN the admin reads an Asset Store URL whose page carries a publisher link, THE SYSTEM SHALL
  return the publisher id with the metadata lookup and prefill it in the author form.
- WHEN the public catalogue serves a prize whose author has a publisher id, THE SYSTEM SHALL include
  `publisherId`, and the gallery SHALL link the publisher name to
  `https://assetstore.unity.com/publishers/<id>`.
- IF the page carries no publisher link, THEN the metadata's publisher id SHALL be null and the parse
  SHALL still succeed.
- IF the attached author has no publisher id, THEN the public asset's `publisherId` SHALL be null and
  the gallery SHALL render the plain publisher name.
- WHEN two authors are given the same publisher id, THE SYSTEM SHALL refuse the second.
- WHILE a prize has no author row, THE SYSTEM SHALL still publish its `publisher` name (no
  regression), with a null `publisherId`.

## Design

**Where the id lives.** `authors.publisherId` — `text('publisher_id')`, nullable, unique. An author
is one record per publisher, so the id is 1:1 with it, while an asset-side copy would repeat per
prize. The publisher *string* deliberately stays on `assets.publisher`: it is what
`attachAuthorByPublisher` matches on (`server/repository.ts:212`), the only thing that associates a
scraped prize with an author, and what the gallery shows for an unattached prize. Moving it to the
author would break the attach action and blank the name on unattached or orphaned prizes.

**Reading it.** The JSON-LD block has no publisher link, so `parseAssetPage` reads the header anchor:
the first `href="/publishers/(\d+)"` after the `</h1>` title close. Both live pages carry it there
(`/publishers/45737`, `/publishers/54696`), and nothing else anchors a publisher id near the title.
The parsing stays inside a `try`-free, null-returning helper so a page without the anchor (or with
older markup) still yields every other field.

**Deriving the link.** The payload carries the raw `publisherId`, not a URL: it is a store fact, and a
URL derived from it would be a value we neither store nor own. The client builds the link in one
helper (`src/format.ts`), so Unity's URL shape appears once in the bundle. The id itself is exposed on
`AdminAuthor` too, because the form edits it.

**Interfaces.**

- `AssetMetadata.publisherId: string | null` (`server/unity.ts`).
- `MetadataPrefill = AssetInput & { publisherId: string | null }` — the metadata route's response
  shape. Not part of `AssetInput`: the id belongs to the author, not to a prize column.
- `AuthorInput.publisherId: string | null` (`server/validate.ts`), read by `parseAuthorInput` as text
  of at most 40 characters.
- `PublicAsset.publisherId: string | null`; `toPublicAsset(asset, publisherId)` takes the joined id.
- `AdminAuthor.publisherId: string | null`.

**Query.** `publicCatalogue` (`server/repository.ts:40`) becomes
`select({ asset: assets, publisherId: authors.publisherId }).from(assets).leftJoin(authors, eq(assets.authorId, authors.id))`.
A LEFT JOIN because `author_id` is nullable: an unattached prize keeps its name and gets no link. The
totals query is unchanged.

**Explicitly unchanged:** `findAuthorByPublisher` and the scrape's author preselect still match on
the publisher string; `assets.publisher` stays; `attachAuthorByPublisher` is untouched.

## Edge cases and failure modes

- No anchor, no `<h1>`, or a non-numeric id → `publisherId` is null, the rest of the parse stands.
- An asset *description* may contain its own `/publishers/<id>` link (one live page did) → the
  after-`<h1>` rule avoids it; a test pins that a description link is not picked up.
- A second author claiming the same publisher id → refused by the unique index, with wording
  matching the existing publisher/id clash.
- The stored fixtures predate the current markup (neither has a `/publishers/` anchor), so they are
  re-captured before the parser change is tested.

## Checklist

- [x] Re-capture both fixtures: the capture script now keeps the header slice too, and each fixture carries its anchor (`45737`, `54696`). The plain page is captured 50% off, so four expectations moved from 3250 to 6500 — real data, lifted as designed
- [x] `server/unity.ts`: `AssetMetadata.publisherId` and the header-anchor reader
- [x] `server/unity.test.ts`: id from both real pages, null cases, description-link decoy
- [x] `server/schema.ts`: `authors.publisherId` column with a comment; `npm run db:generate` → `0011_sweet_justin_hammer.sql`
- [x] `server/validate.ts`: `AuthorInput.publisherId` + `parseAuthorInput` digit rule; `MetadataPrefill` type
- [x] `server/app.ts`: the metadata route returns `publisherId` beside `authorId`
- [x] `server/payloads.ts`: `PublicAsset.publisherId`, `toPublicAsset(asset, publisherId)`, `AdminAuthor.publisherId`
- [x] `server/repository.ts`: `publicCatalogue` LEFT JOIN
- [x] Server tests: `api.test.ts` `PUBLIC_FIELDS` + prefill and catalogue assertions, `schema.test.ts` unique publisher id
- [x] Client: `src/api.ts` lookup type, `AuthorForm` field and props, `AssetForm` pass-through, `AuthorsPanel` link cell, `Gallery` link, `src/format.ts` link helper
- [x] Client test fixtures gain the required `publisherId`; `format.test.ts` covers the link helper
- [x] Docs: `README.md`, `AGENTS.md` (private-data line corrected, author invariant), `docs/decisions.md`, `docs/backlog.md` (the id is not used for matching)
- [x] Verify: typecheck, lint, 249 tests and build all clean; the public gallery rendered in the browser. No author in the dev database has an id yet, so no link shows there — the join and the link branch are covered by tests
