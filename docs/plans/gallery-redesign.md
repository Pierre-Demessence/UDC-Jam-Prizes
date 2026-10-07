# Gallery redesign

## Goal

Replace the public gallery with the approved "B" design (Claude Design canvas, light and dark themes):
a category tree in a sidebar, a larger search, an explicit "Sort by Name | Publisher" control, image-led
cards, a theme selector (System / Light / Dark, default System) and a "sponsor a jam" note. The admin is untouched.

## Acceptance criteria

- WHEN the gallery loads, THE SYSTEM SHALL show the title, a search field, the category tree, a sort control, the prize count and one card per visible prize.
- WHEN the user picks a category at any depth, THE SYSTEM SHALL show the prizes in that category and in every category below it, and mark the picked row with more than colour (bold, fill and a check).
- WHEN the user expands or collapses a tree row, THE SYSTEM SHALL change nothing outside the tree (no layout shift of the grid or toolbar).
- WHEN the user types in the search field, THE SYSTEM SHALL filter by name, publisher and category, and the tree counts SHALL reflect the search.
- WHEN the user picks a sort, THE SYSTEM SHALL order by name or by publisher; a prize with an unknown publisher SHALL sort last under Publisher.
- WHILE the viewport is 720px wide or less, THE SYSTEM SHALL show the category tree in a full-screen dialog opened from a Category button, instead of the sidebar.
- WHEN the theme is System, THE SYSTEM SHALL follow `prefers-color-scheme`; WHEN the user picks Light or Dark, THE SYSTEM SHALL use it and remember it across visits.
- IF storage is unavailable, THEN THE SYSTEM SHALL still render and fall back to System.
- WHEN a prize has a price, THE SYSTEM SHALL show it in a bordered tag on the image that stays visible on any image colour in both themes; WHEN it has none, THE SYSTEM SHALL show no tag.
- WHEN a prize has no image, THE SYSTEM SHALL show a labelled placeholder; images SHALL be cropped to 3:2 with `object-fit: cover`.
- THE SYSTEM SHALL keep every private field out of the public response (no change to the API).

## Design

- **Scope.** Gallery only. The new light/dark tokens apply while the gallery is mounted (`data-theme` on `<html>`, removed on unmount); the admin keeps its current dark tokens in `:root`. Gallery styles move to `src/gallery/gallery.css`, imported by the component; shared rules (`.field`, inputs) stay in `styles.css` and the old gallery-only rules (`.grid`, `.card*`, `.controls`, `.totals`, `.result-count`) are deleted.
- **Category tree.** New pure module `src/category-tree.ts`: `buildCategoryTree(assets)` from the stored paths (`tools/gui` etc.), `countIn(...)`, and `inCategory(asset, path)` (prefix match on whole segments). Labels go through the existing `formatCategory` rules per segment. `filterAssets` switches from exact to subtree matching. Component state: selected path + expanded set; picking a parent expands it; opening on mobile expands the ancestors of the selection.
- **Sort.** `SortKey` `'author'` becomes `'publisher'` and is labelled "Publisher" (this also closes the backlog item about the "Author" label).
- **Theme.** `src/gallery/theme.ts`: `readTheme` / `saveTheme` with try/catch around `localStorage`, key `jam-prizes-theme`, plus a `useTheme` hook. Applied before first render so there is no flash in the chosen theme.
- **Components** (in `src/gallery/`): `Gallery.tsx` (page, data loading), `CategoryTree.tsx`, `PrizeCard.tsx`, `ThemeSelector.tsx`, `SortControl.tsx` (small, optional split if `Gallery.tsx` stays short without it).
- **Cards.** Title and image link to the asset page, the publisher links to the store page when the id is known: same behaviour as today.
- **Sponsor note.** Constant in the gallery: "Publisher? Sponsor a jam. To have your assets offered here as prizes, contact @uristdoomhammer on Discord."
- **Fonts.** Geist and Geist Mono, self-hosted as woff2 under `src/assets/fonts/` (no runtime dependency, no third-party request). System font stack as fallback.
- **Totals.** The design drops the "N assets · $X in total" line. The API still returns `totals`; the gallery shows only the prize count.
- **Not changed:** API, schema, admin, deployment.

## Checklist

- [x] Baseline: lint, typecheck, tests, build noted
- [x] `category-tree.ts` + tests (build, counts, subtree match, empty/no-category prizes)
- [x] `catalogue.ts`: subtree filter, `publisher` sort key + tests updated
- [x] `theme.ts` + tests (storage failure, invalid value)
- [x] Fonts added under `src/assets/fonts/`
- [x] `gallery.css` (light, dark, system tokens; responsive) and old gallery rules removed from `styles.css`
- [x] Gallery components
- [x] Mobile dialog for the tree
- [x] Lint, typecheck, test, build clean against baseline
- [x] Verified in a real browser: light, dark, system, mobile width, 3-level category, no-image prize, no-price prize
- [x] Docs: `AGENTS.md` layout, `docs/decisions.md`, `docs/backlog.md` (sort label item removed), README if it describes the gallery
- [x] Peer review round(s)
- [ ] Plan deleted in the final commit (when committing is requested)
