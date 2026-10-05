# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

## Tech debt

- The login rate limiter is in memory and per process: it forgets everything when the server restarts
  (`server/auth.ts`).
- Changing `ADMIN_PASSWORD` does not invalidate sessions already issued, which stay valid for up to
  twelve hours (`server/auth.ts`).
- `connectDatabase` always creates the data directory, opens the file read-write and migrates it, so
  a read-only or second instance would fail at startup (`server/db.ts`).
- `src/styles.css` keeps a `.mono` rule nothing uses (`src/styles.css`).
- The public page is client-rendered; add a prerender or static export if it ever needs to be
  crawlable or link-preview friendly.
- No automated accessibility check: `eslint-plugin-jsx-a11y` caps at ESLint 9 (`eslint.config.ts`).

## Ideas

- Phase 2 from the brainstorm: full key management across jams, per-jam workflows with claim links,
  audit log, backup/restore, CSV import from the old sheet.
- Decide the deployment target (`npm start` fits a VPS, Fly or Render) and a backup routine for `data/`.
- Totals add up cents across currencies and label the sum with the first priced asset's currency;
  either group the sum by currency or state that a jam is single-currency (`server/repository.ts`).
- Behind a reverse proxy every visitor shares one rate-limit key, so an attacker can lock the admin
  out for the window; consider trusting a proxy header from a known address (`server/app.ts`).
