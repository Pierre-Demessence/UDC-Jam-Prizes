# Plan — the donor is an author entity

## Goal

Replace the 1:1 `contacts` table with an `authors` table that one author shares across their
prizes, carrying the Discord **handle** (mutable) and the Discord **ID** (stable snowflake), plus
the store publisher string that lets a prize find its author automatically. A dozen authors,
63 prizes, one record per author.

## Acceptance criteria

- WHEN the admin reads an Asset Store page whose publisher matches an existing author, THE SYSTEM
  SHALL preselect that author in the prize form.
- WHEN the admin imports several links in one paste, THE SYSTEM SHALL link each prize to the author
  whose publisher matches the page, without being asked.
- WHEN the admin attaches author A to a prize, THE SYSTEM SHALL store the link on that prize only,
  leaving A's other prizes untouched.
- WHEN the admin asks to attach every prize published by P to author A, THE SYSTEM SHALL link every
  prize whose publisher matches P (case-insensitively) and report how many it linked.
- WHEN an author is deleted, THE SYSTEM SHALL delete only the author record and set their prizes'
  author link to null (IF the author has prizes, THEN no prize, key or price SHALL be lost).
- WHEN a Discord id is supplied, THE SYSTEM SHALL store it as text and reject anything that is not
  17–20 digits; WHEN the same id or handle is claimed twice, THE SYSTEM SHALL refuse the second
  with a readable error.
- WHEN two authors would claim the same publisher string (any case), THE SYSTEM SHALL refuse the
  second with a readable error.
- WHEN the migration runs on the existing database, THE SYSTEM SHALL produce one author per distinct
  handle, link every prize to it, and leave every prize, key and price intact.
- WHILE author data is private, THE SYSTEM SHALL NOT include it in `GET /api/assets`.
- WHEN an author's publisher is corrected, THE SYSTEM SHALL leave the prizes' own scraped publisher
  strings alone (the author's string is the matching key, not catalogue data).

## Design

### Data

```
authors
  id              integer PK
  publisher       text unique (nullable)  -- the store publisher string; the matching key
  discord_handle  text unique (nullable)  -- mutable, and the author's on-screen label
  discord_id      text unique (nullable)  -- snowflake, TEXT: exceeds Number.MAX_SAFE_INTEGER
  created_at / updated_at                 -- runtime defaults, as everywhere else

assets
  + author_id     integer (nullable) REFERENCES authors(id) ON DELETE SET NULL
                  index assets_author_id_index

contacts          -- dropped, after its rows are moved
```

- There is no name column: an author is labelled by `discordHandle`, then `publisher`
  (`authorLabel` in `server/payloads.ts`), so the label cannot drift from either. At least one of
  publisher / handle / id is required, which is what keeps a row findable.

- `author_id` is nullable and **`SET NULL`**, the opposite direction from today's contact: deleting
  an author must never delete a prize. Deleting a *prize* still cascades its keys.
- Handle, id and publisher are unique when non-null (SQLite treats NULLs as distinct, so partial
  records are fine). Publisher matching is case-insensitive and enforced in the repository, with an
  exact unique index as the backstop.
- `assets.publisher` stays: it is scraped catalogue data and the table's "Publisher" column.
  `authors.publisher` is the matching key. They agree when a prize was matched; a rename at the store
  does not rewrite asset rows (accepted, listed under Edge cases).
- An author carries only what identifies the person — publisher, handle, id. Its notes were dropped
  with migration `0010`: a free-text note belongs on the prize (`assets.notes`) or nowhere, and the
  `contacts.contact_notes` it inherited was per prize anyway.

### Migration `0008_*`

Generated for the schema, then hand-written for the data move, in one migration:

1. Create `authors`, add `assets.author_id`.
2. `INSERT INTO authors (name, discord_handle, notes, created_at, updated_at)` grouped by
   `lower(trim(discord_handle))`: name = the group's publisher when the group maps to exactly one
   distinct publisher, else the handle; notes = the group's first non-null contact note; timestamps
   from the earliest contact.
3. Set `authors.publisher` from the group's publisher **only** when that group maps to exactly one
   distinct publisher, so an ambiguous group stays null.
4. `UPDATE assets SET author_id` by joining through the old `contacts.asset_id`.
5. `DROP TABLE contacts`.

Because this runs on real data, take a copy of `data/prizes.sqlite` (with its `-wal` / `-shm`) to
`data/prizes.sqlite.bak-<date>` before starting the app, and keep it until the catalogue is reviewed.
`data/` is gitignored, so the copy never reaches a commit. **Ask the user before running it.**

### API

| Route | Meaning |
| --- | --- |
| `GET /api/admin/authors` | every author, each with its prize count |
| `POST /api/admin/authors` | create one |
| `PATCH /api/admin/authors/:id` | edit publisher / handle / id / notes |
| `DELETE /api/admin/authors/:id` | delete; prizes are unlinked, count reported |
| `POST /api/admin/authors/:id/attach` | `{ publisher }` — link every prize with that publisher, report how many |
| `PUT /api/admin/assets/:id/author`, then removed | replaced by `authorId` on the asset payload |

- `AssetInput` gains `authorId: number | null`. It is validated for shape in `parseAssetInput` and
  for existence in the route (the same place the Unity-id clash is checked), so create and update set
  the author in the one request the form already makes. `assetInputFromMetadata` returns `null`.
- `POST /api/metadata` gains `author` (the match for the page's publisher, or null) so the form can
  preselect. `PUT /api/admin/assets/:id/contact` is deleted with `contacts`.
- `importAssets` looks the publisher up and passes the matched `authorId` to `createAsset`, so a
  pasted batch arrives already linked.
- `AdminAsset.contact` becomes `AdminAsset.author: AdminAuthor | null`
  (`{ id, label, assetCount, publisher, discordHandle, discordId }`). The public payload does
  not change: authors are private, and public shapes are built field by field.

### Client

- `AssetForm`: an **Author** select of existing authors plus an inline "New author" (publisher,
  handle, id) that creates and selects in one step; prefilled from the metadata match. This is
  where an author is chosen, because a new prize needs one at creation time.
- `KeyPanel`: keeps keys; the author is shown read-only with a link to the author panel.
- New `AuthorsPanel` (opened from the admin toolbar): the dozen authors as a table like the prize
  list, one column per field plus the prize count, with edit / delete and
  **Attach every prize by this publisher** — the action that clears the existing 63 in one click per
  author.
- `asset-table.ts`: the existing keys are renamed so the words match the domain — `'author'`
  (the publisher) becomes `'publisher'` / "Publisher", and `'contact'` becomes `'author'` / "Author"
  sorted by the author's label. Cell shows the label with the handle/ID in its tooltip.

### Edge cases and failure modes

- Handle present, ID unknown: allowed (all existing rows). Both nullable, neither required.
- Two authors, one publisher string: refused with a readable error rather than an ambiguous preselect.
- Store publishes under a new name: the author's publisher string is updated by hand; existing prize
  rows keep the old string, so bulk-attach then serves for re-linking.
- Author deleted while prizes are attached: link goes null, prize list unchanged, UI says how many.
- Public page: untouched. Hidden prizes and totals behave exactly as before.
- Tests that pin the shape (`server/api.test.ts`, `server/schema.test.ts`, `src/admin/asset-table.test.ts`)
  must be updated with the rename, not deleted.

## Checklist

- [x] Back up `data/prizes.sqlite` (`-wal` / `-shm` too) and record the row counts of `assets`, `contacts`, `keys`
- [x] `server/schema.ts`: add `authors`, add `assets.authorId`, drop `contacts`, update exported types
- [x] `npm run db:generate`, then hand-write the data move into `drizzle/0008_*`; verify on a copy first
- [x] `server/payloads.ts`: `AdminAuthor`, `AdminAsset.author`, remove `AdminContact`
- [x] `server/validate.ts`: `parseAuthorInput` (at least one of publisher / handle / id; handle ≤ 100; `discordId` `^\d{17,20}$`; publisher bounded), `authorId` in `parseAssetInput`
- [x] `server/repository.ts`: author CRUD, `authorByPublisher`, `attachAuthorByPublisher`, `deleteAuthor` (unlink first); drop `saveContact`; load authors in `adminCatalogue` / `adminAsset`
- [x] `server/app.ts`: the five `/api/admin/authors*` routes, `authorId` existence check on asset create/update, metadata match, drop `/contact`
- [x] `server/import-assets.ts`: attach the author matched by publisher
- [x] `src/api.ts`: authors CRUD + attach; drop `saveContact`
- [x] `src/admin/AssetForm.tsx`: author select + inline create + prefill
- [x] `src/admin/AuthorsPanel.tsx` (new) + wire into `Admin.tsx`; `KeyPanel.tsx` read-only author
- [x] `src/admin/asset-table.ts` + `AssetTable.tsx`: `publisher` / `author` rename, author cell
- [x] Tests: schema FK + `SET NULL`, repository author CRUD/attach/delete, validate Discord id, api admin shape + private-field check, asset-table sort; update the pinned fixtures
- [x] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- [x] Docs: `AGENTS.md` invariant (author entity, private, `SET NULL`), `docs/decisions.md` entry with the rejected alternatives (per-asset contact; author identified by handle alone)
- [ ] Delete this plan with the feature's final commit

## Status

Implemented, verified and peer-reviewed; left uncommitted. The plan stays until the feature is
committed. Migrations `0008` (the data move) and `0009` (dropping `authors.name`, once the label
became derived) have both run against the local `data/prizes.sqlite`, because the `--watch` dev server
restarts onto the new schema; the pre-migration copy is `data/backup-20261006-014642/`.

A peer review found two blocking problems, both fixed: the data move aborted on the unique publisher
index when two handles shared one publisher string (such an author is now left with no publisher
instead), and Enter inside the inline author form submitted the prize form around it (Enter is now
blocked in the author fields, and only there). The move was then rehearsed against four hand-built
shapes: two handles sharing a publisher, one handle with two publishers, the ordinary case, and an
empty `contacts` table.

A second review followed the decision to drop `authors.name` in favour of the derived `label`: it
found no blocking problem, and its two worthwhile notes — the label repeating itself beside the
handle, and a tooltip that listed what the label already said — are fixed (`authorExtras`).

Then the author's `notes` were dropped too (`0010`), and the panel became a table like the prize
list: one column per field, the prize count, and the actions. Migrations `0009` and `0010` have run
against the local `data/prizes.sqlite` for the same reason as `0008`.
