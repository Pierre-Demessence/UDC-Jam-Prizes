# Backlog

Everything not done yet. One line per item; delete an item in the same commit
that completes it.

## Bugs

- The prize form's URL field re-reads the page on Enter even while a read is still running: the
  button is disabled, the keydown handler is not (`src/admin/AssetForm.tsx`).

## Tech debt

- No way back from a schema change: migrations run forward on every connect, so rolling the image back
  to an older build leaves the newer schema in place (`server/db.ts`).
- The Authors panel keeps its own copy of the authors, so deleting a prize from the table while the
  panel is open leaves a stale count in its Prizes column until it is closed and reopened
  (`src/admin/AuthorsPanel.tsx`).
- The prize form's author hint says "No author attached" for a moment after opening a prize whose
  author is preselected, until the author list arrives (`src/admin/AssetForm.tsx`).
- Publisher and handle matching folds case with SQLite's `lower()`, which only handles ASCII, while
  the JavaScript side uses `toLowerCase()`: a non-ASCII publisher or handle would not match
  case-insensitively (`server/repository.ts`). Reading a page now creates the author, so a spelling
  variance the matcher cannot fold makes a second record rather than merely missing the preselect.
- The self-hosted Geist fonts are the Latin subset only: a prize name in another script falls back to the
  system font (`src/gallery/gallery.css`).

## Ideas

- The metadata prefill and the attach action match an author by publisher name alone, though the store
  id is now stored: a publisher who renames themselves stops being preselected even though their id
  did not change (`server/repository.ts:171`).
