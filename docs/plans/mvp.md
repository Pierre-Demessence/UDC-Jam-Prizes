# MVP — a prize catalogue instead of the spreadsheets

## Goal

Replace the private and the public Google Spreadsheets with one app: paste an Asset Store URL to add
a prize with its metadata filled in automatically, keep the private fields (Discord handle, keys)
behind a login, and let winners browse a public read-only list.

## Acceptance criteria

- WHEN the admin pastes an Asset Store URL, THE SYSTEM SHALL prefill name, image, publisher,
  category and asset ID from the page metadata.
- IF the metadata fetch fails, THEN THE SYSTEM SHALL report the failure and keep every field editable
  instead of saving partial data.
- WHEN the admin saves an asset with no fetched price, THE SYSTEM SHALL accept a manually typed price.
- WHEN a visitor opens the public page, THE SYSTEM SHALL list assets with image, name and price, and
  SHALL NOT expose Discord handles, key values or internal notes.
- WHEN the totals header is displayed, THE SYSTEM SHALL show the number of assets and the sum of
  their prices.
- WHEN a request for an admin route or a write endpoint comes from someone who is not the admin,
  THE SYSTEM SHALL refuse it.

## Design

- Stack and reasoning: `../decisions.md`. Request and Unity findings: `prize-app-brainstorm.md`.
- Client: React, two areas — the public gallery at `/` and the admin at `/admin`.
- API: Hono routes under `/api`; public responses are built from an explicit field list, never by
  deleting keys from a full row.
- Data: tables for assets, contacts and keys (plus jams if winner tracking lands in the MVP). The
  three tables ship with the data model; the key *workflows* — assign, send — stay in the phase-2
  checklist item below.

## Checklist

- [x] Scaffold: template config, React client, Hono API, SQLite wiring, `GET /api/health`.
- [x] Data model: `assets`, `contacts` and `keys` in `server/schema.ts`, with Drizzle migrations
      applied on connect.
- [x] `POST /api/metadata`: parse the page's JSON-LD (and Open Graph), return the fields and either a
      price or the reason it could not be read.
- [x] Admin form: paste a URL, review the prefilled fields, set the Discord handle and notes, save.
- [x] Public gallery: grid with image, name and price; search, filters, sorting, totals.
- [x] Admin auth: password, signed `HttpOnly` cookie, rate-limited login, protected admin routes, and an
      optional address allow-list over the whole admin side.
- [x] Key tracking: store keys, assign them to winners, mark them as sent.
- [x] Paste several links at once: each is read and added, with a per-link result.
- [x] Tests for the parser, the public payload shape, the auth gate and the address allow-list; then
      lint, build, browser check.

Status: everything on this list is built and verified — 137 tests, lint, typecheck, build, and the
flows exercised in a browser against live Asset Store pages. Bringing the existing spreadsheet across is
a paste of its links; the private fields (keys, Discord handles) are re-entered by hand.
