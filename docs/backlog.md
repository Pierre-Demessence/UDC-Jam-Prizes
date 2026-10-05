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
- The public page is client-rendered; add a prerender or static export if it ever needs to be
  crawlable or link-preview friendly.
- No automated accessibility check: `eslint-plugin-jsx-a11y` caps at ESLint 9 (`eslint.config.ts`).
- `shutdown()` closes the server and then calls `process.exit(0)` at once, so in-flight requests are
  dropped and the Deployment's 30s termination grace is never used (`server/index.ts`).
- No way back from a schema change: migrations run forward on every connect, so rolling the image back
  to an older build leaves the newer schema in place (`server/db.ts`).

## Ideas

- A WAL-safe backup routine for `data/prizes.sqlite`: the cluster's Velero covers the volume, but a
  consistent copy of a write-ahead-log database needs a checkpoint (`VACUUM INTO` in a CronJob).
- Behind a reverse proxy every visitor shares one rate-limit key, so an attacker can lock the admin
  out for the window; consider trusting a proxy header from a known address (`server/app.ts`).
