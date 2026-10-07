import { useEffect, useMemo, useRef, useState } from 'react';

import type { Catalogue } from '@/api';

import { api } from '@/api';
import { DEFAULT_FILTERS, filterAssets } from '@/catalogue';
import { ancestorsOf, buildCategoryTree } from '@/category-tree';
import { formatCategory, formatPrizeCount } from '@/format';
import { CategoryDialog } from '@/gallery/CategoryDialog';
import { CategoryTree } from '@/gallery/CategoryTree';
import { ChevronDownIcon, SearchIcon } from '@/gallery/icons';
import { PrizeCard } from '@/gallery/PrizeCard';
import { SortControl } from '@/gallery/SortControl';
import { useTheme } from '@/gallery/theme';
import { ThemeSelector } from '@/gallery/ThemeSelector';

import brand from '../../brand.json';

import '@/gallery/gallery.css';

const SPONSOR_CONTACT = '@uristdoomhammer';

export function Gallery() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [openPaths, setOpenPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const categoryButtonRef = useRef<HTMLButtonElement>(null);
  const dialogWasOpenRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    api.catalogue()
      .then((next) => {
        if (!cancelled)
          setCatalogue(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = brand.name;
  }, []);

  // Unmounting an open modal dialog skips the browser's own focus return, so hand focus back to the opener.
  useEffect(() => {
    if (dialogWasOpenRef.current && !dialogOpen)
      categoryButtonRef.current?.focus();

    dialogWasOpenRef.current = dialogOpen;
  }, [dialogOpen]);

  const assets = useMemo(() => catalogue?.assets ?? [], [catalogue]);
  const tree = useMemo(() => buildCategoryTree(assets.map(asset => asset.category)), [assets]);
  const visible = useMemo(() => filterAssets(assets, filters), [assets, filters]);
  // The tree counts follow the search, but not the picked category: they say what a click would show.
  const searchedCategories = useMemo(
    () => filterAssets(assets, { ...filters, category: '' }).map(asset => asset.category),
    [assets, filters],
  );

  function showPaths(paths: string[]): void {
    setOpenPaths(current => new Set([...current, ...paths]));
  }

  function selectCategory(path: string): void {
    setFilters(current => ({ ...current, category: path }));
    showPaths([path]);
    setDialogOpen(false);
  }

  function toggleCategory(path: string): void {
    setOpenPaths((current) => {
      const next = new Set(current);
      if (!next.delete(path))
        next.add(path);

      return next;
    });
  }

  function openDialog(): void {
    showPaths(ancestorsOf(filters.category));
    setDialogOpen(true);
  }

  const categoryLabel = formatCategory(filters.category) ?? 'All categories';
  const treeProps = {
    categories: searchedCategories,
    nodes: tree,
    onSelect: selectCategory,
    onToggle: toggleCategory,
    open: openPaths,
    selected: filters.category,
  };

  return (
    <div className="gallery">
      <div className="gallery-inner">
        <header className="gallery-header">
          <div className="gallery-topbar">
            <p className="gallery-eyebrow">Unity Developer Community</p>
            <ThemeSelector onChange={setTheme} theme={theme} />
          </div>
          <h1>{brand.name}</h1>
        </header>

        {error === null
          ? null
          : <p className="notice notice-error" role="alert">{error}</p>}

        {catalogue === null && error === null
          ? <p className="notice" role="status">Loading the prize list…</p>
          : null}

        {catalogue === null
          ? null
          : (
              <div className="gallery-body">
                <aside className="gallery-aside">
                  <div className="aside-tree">
                    <h2 className="aside-heading">Categories</h2>
                    <CategoryTree {...treeProps} />
                  </div>
                  <div className="sponsor">
                    <h2>Want to sponsor the next jams?</h2>
                    <p>
                      To have your assets offered here as prizes, contact
                      {' '}
                      <span className="sponsor-contact">{SPONSOR_CONTACT}</span>
                      {' '}
                      on Discord.
                    </p>
                  </div>
                </aside>

                <main className="gallery-main">
                  <div className="gallery-toolbar">
                    <label className="search">
                      <span className="search-icon"><SearchIcon size={18} /></span>
                      <input
                        aria-label="Search prizes"
                        onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}
                        placeholder="Search by name, publisher or category"
                        type="search"
                        value={filters.query}
                      />
                    </label>
                    <button aria-haspopup="dialog" className="category-button" onClick={openDialog} ref={categoryButtonRef} type="button">
                      <span className="category-button-text">{categoryLabel}</span>
                      <ChevronDownIcon size={14} />
                    </button>
                    <SortControl onChange={sort => setFilters(current => ({ ...current, sort }))} sort={filters.sort} />
                  </div>

                  <p aria-live="polite" className="results">
                    <span className="results-category">{categoryLabel}</span>
                    <span className="results-count">{formatPrizeCount(visible.length)}</span>
                  </p>

                  {visible.length === 0
                    ? (
                        <p className="notice">
                          {assets.length === 0
                            ? 'No prizes yet. The admin can add them.'
                            : 'Nothing matches those filters.'}
                        </p>
                      )
                    : (
                        <div className="prize-grid">
                          {visible.map(asset => <PrizeCard asset={asset} key={asset.id} />)}
                        </div>
                      )}

                  <p className="gallery-footnote">Prices come from the Unity Asset Store and can change.</p>
                </main>
              </div>
            )}
      </div>

      {dialogOpen
        ? <CategoryDialog onClose={() => setDialogOpen(false)}><CategoryTree {...treeProps} /></CategoryDialog>
        : null}
    </div>
  );
}
