# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

## Tech debt

- `connectDatabase` always creates the data directory, opens the file read-write and migrates it, so
  a read-only or second instance would fail at startup (`server/db.ts`).
- No way back from a schema change: migrations run forward on every connect, so rolling the image back
  to an older build leaves the newer schema in place (`server/db.ts`).

## Ideas
