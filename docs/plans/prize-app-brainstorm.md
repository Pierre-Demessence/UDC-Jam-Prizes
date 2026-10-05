# Prize app — brainstorm and plan

Working document: the original request, the technical findings behind it, and the step-by-step plan.
Its §2 stack recommendation and its quantity fields (donated counts, availability) were superseded when
the scaffold was built — see `../decisions.md` for what was chosen and why. The actionable plan is
`mvp.md`. This file is deleted once the MVP ships.

## 1. The original request

> I organize gamejams about Unity. For gamejams I have prizes, which are Unity assets. Assets creators contact me, I add their prizes to a private Google Spreadsheet, and with some formula I try to autofill some informations (name, price, image, etc...). Then I have another spreadsheet which is public, which takes info from this first page.
>
> Winners can choose 1-2 keys among the possible assets in the prize list. When a gamejam occurs, winners tell which assets they want, I contact the authors, they give me the keys, and I distribute them.
>
> I want a webpage/app instead of the sheet. Goals:
> 1) Easier to maintain, with easier automation: I just add a Unity Asset Store link (and author discord name) and it should auto fetch details (price, name, image...).
> 2) Easier to browse: a public site to browse assets. The admin side is private (adding/modifying data), while the public side is read-only and hides private info (Discord, keys).
>
> Please brainstorm a webpage/app.

## 2. Recommendation

Build **one full-stack app** (single codebase) with two faces: a **private admin** interface for
adding and maintaining prizes, and a **public read-only** interface that hides every private field.

| Concern | Choice |
| --- | --- |
| Framework | Next.js (TypeScript, App Router) — frontend and server routes in one codebase |
| Storage | SQLite; a small hosted SQL (Turso, D1, PlanetScale) if deployed |
| Hosting | Vercel, or Cloudflare Pages + Functions |
| Server-side work | API routes fetch and parse Unity pages, and guard admin operations |

Core capability: paste an Asset Store URL → the app pulls name, image, publisher, category and
asset ID from the page metadata, tries to get the price, and asks you to confirm. You add the
Discord handle (private) and the donated key count. Keys are stored but never public.

## 3. Scope

### 3.1 Admin side (private)

- Add an asset by pasting an Asset Store URL; the form is prefilled with the fetched metadata
  (name, image, publisher, category, asset ID) and every field stays editable.
- Price is fetched when possible, otherwise typed by hand; manual entry always wins (see §5.1).
- Record the author's Discord handle, contact notes, and the number of donated keys.
- Store the actual keys when the author sends them; assign them to winners and mark them sent.
- Dashboard: totals, available keys, recent additions, warnings for duplicates or broken links.
- Winner management: record winners per jam, assign keys, mark them as sent.
- CSV export for internal records.

### 3.2 Public side (read-only)

- Gallery/grid: image, name, publisher, price, availability ("2 of 3 available"), link to the
  official asset page.
- Search, filters (category, price range, availability), sorting (price, name, newest).
- Totals header: donated keys and estimated total value.

### 3.3 Field visibility

| Field | Public | Admin |
| --- | --- | --- |
| name, image, publisher, category, asset URL | yes | yes |
| price, donated count, availability | yes | yes |
| internal notes, contact notes | no | yes |
| Discord handle | no | yes |
| key values and their assignment | no | yes |

## 4. Data model (conceptual)

**assets** — `id`, `assetId` (Unity ID, e.g. 169047), `assetUrl`, `name`, `imageUrl`, `category`,
`publisher`, `price` (decimal + currency), `donatedAmount` (number of keys donated),
`available` (computed: `donatedAmount` − claimed), `notes`, `createdAt` / `updatedAt`.

**contacts** — `id`, `assetId` (FK), `discordHandle` (private), `contactNotes`.

**keys** — `id`, `assetId` (FK), `keyValue` (sensitive, encrypted at rest ideally),
`status` (available / assigned / revoked), `assignedTo` (winner id or email), `assignedAt`.

**jams** *(optional)* — `id`, `name`, `winners`, `assignments`.

Derived totals, computed by query for the dashboard and the public header: asset count, sum of
`donatedAmount`, estimated total value = Σ(`price` × `donatedAmount`).

## 5. What the Unity Asset Store lets us fetch

Validated against a real asset page on 2026-10-05.

| Field | Source | Reliability |
| --- | --- | --- |
| name, description, image(s), publisher/brand, category | `application/ld+json` Product block, plus Open Graph tags | reliable, cheap to parse |
| asset ID | trailing number in the slug or canonical URL | reliable |
| price | not in the static HTML — loaded client-side from an internal Unity API | fragile, undocumented |

Parsing: read the `<script type="application/ld+json">` Product object (`name`, `image[]`,
`description`, `brand.name`) with a server-side HTML parser such as cheerio, and fall back to the
Open Graph tags for anything missing. JSON-LD and OG parsing is the part that should keep working
long-term; the price is the part that will need maintenance.

### 5.1 Price is the fragile field

Unity serves the price from an internal API (GraphQL or similar) after the page loads. The endpoint
is reachable but undocumented, and returned `400` to a naive query during testing. Three options:

1. Call the internal API with the right query — cheap server-side, brittle, needs occasional upkeep.
2. Render the page in a headless browser (Playwright) and read the price — robust, heavier, costlier.
3. Treat price as a confirmable auto-fill: try, and if it fails, show the detected fields and let
   the admin type the price.

Recommended for now: option 3, and keep options 1–2 behind a feature flag later (§7). The UX is
"price unknown" plus a one-click *Try fetch price* button, with the field always editable.

## 6. MVP

Goal: replace the two spreadsheets with one app, without automating the fragile price.

- [ ] 1. Simple Next.js app with a local SQLite DB.
- [ ] 2. Admin page: an "Add asset" input (URL) that fetches and parses server-side, then shows a
      confirmation form with editable fields, and saves to the DB.
- [ ] 3. Public grid listing the saved assets (image / name / price / available), with totals computed
      from the DB.
- [ ] 4. Admin fields for `donatedAmount` and the Discord handle, never exposed publicly.

Acceptance criteria (EARS):

- WHEN the admin pastes an Asset Store URL, THE SYSTEM SHALL prefill name, image, publisher, category
  and asset ID from the page metadata.
- IF the metadata fetch fails, THEN THE SYSTEM SHALL report the failure and keep every field editable
  instead of saving partial data.
- WHEN the admin saves an asset with no fetched price, THE SYSTEM SHALL accept a manually typed price.
- WHEN a visitor opens the public page, THE SYSTEM SHALL list assets with image, name, price and
  availability, and SHALL NOT expose Discord handles, key values or internal notes.
- WHEN the totals header is displayed, THE SYSTEM SHALL compute the totals from the stored data.

## 7. Phase 2 (optional)

- Automatic price fetch via the Unity API, with the Playwright fallback, behind a feature flag.
- Full key management: paste keys, assign them to winners, email the winner a token to claim.
- Per-jam workflows and winner claim links.
- Audit log, backup/restore, CSV import from the existing Google Sheet (§10).

## 8. Security and privacy

- Admin auth: password-protected accounts — NextAuth (email + magic link), or a single password gate
  behind an environment variable for the smallest possible setup.
- Keys encrypted at rest (application-level AES, or a DB-level option) and readable by admins only.
- Rate-limit the auto-fetch endpoint, against abuse and to stay within Unity's site usage rules.
- Validate and sanitize pasted URLs; store the canonical URL and ID only.
- Credentials via environment variables; never committed.

## 9. Implementation plan (single developer)

Rough estimates, assuming familiarity with Next.js and basic DB setup.

- [ ] **Scaffold** (4–6 h) — Next.js + TypeScript, SQLite via Prisma or Drizzle, base layout,
      environment variables for auth, git repo.
- [ ] **Data model + DB** (2–4 h) — models and migrations for assets, contacts and keys; seed script
      for the initial CSV rows.
- [ ] **Auto-fetch endpoint** (6–10 h) — `POST /api/fetch-metadata`: accepts a URL, fetches the HTML
      server-side, parses JSON-LD and OG tags, returns structured metadata; error handling and
      duplicate detection. The price attempt returns `null` plus a reason when it fails.
- [ ] **Admin add/edit UI** (6–10 h) — form driven by that endpoint, editable fields, validation, save.
- [ ] **Public listing + search** (6–8 h) — grid, search input, filters, totals header, responsive layout.
- [ ] **Auth + admin protection** (2–4 h) — NextAuth, or a password-protected middleware on the admin routes.
- [ ] **Testing, polish, deploy** (4–8 h) — unit/integration checks, deploy to Vercel, env vars, DNS.

Total: **~30–50 h**. Automating the price with a headless browser inside the MVP adds ~8–12 h.

## 10. Migrating from the Google Sheet

Export the sheet to CSV and add an import route that maps rows to `assetUrl`, `name`, `imageUrl`,
`donatedAmount` and `price`. Match on `assetId` so that re-importing updates rows instead of creating
duplicates.

## 11. Open questions

- Stack and host: the table in §2 is a recommendation, not a commitment.
- Price automation in the MVP, or manual price with the auto-fill later?
- Auth: magic link, or a single password gate?
- Key tracking level: individual key values assigned one per winner, or only a count per asset
  (the current MVP scope in §6 only stores the count)?
- Do availability and the public totals need to be live during a jam, or is a snapshot fine?

## 12. Next step

1. Scaffold the full Next.js + SQLite app and implement the paste → autofetch → save flow.
   *(recommended)*
2. Prototype only the server-side autofetch and the price strategies.
3. Pause and refine the spec (add fields or workflows).
