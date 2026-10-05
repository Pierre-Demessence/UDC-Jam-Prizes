# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

## Tech debt

- No way back from a schema change: migrations run forward on every connect, so rolling the image back
  to an older build leaves the newer schema in place (`server/db.ts`).

## Ideas
