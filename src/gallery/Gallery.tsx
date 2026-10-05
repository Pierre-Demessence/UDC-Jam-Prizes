import { useEffect, useMemo, useState } from 'react';

import type { Catalogue } from '@/api';
import type { SortKey } from '@/catalogue';

import { api } from '@/api';
import { categoriesOf, DEFAULT_FILTERS, filterAssets, SORT_LABELS } from '@/catalogue';
import { describeTotals, formatCategory, formatPrice, totalsTooltip } from '@/format';

import brand from '../../brand.json';

function AssetCard({ asset }: { asset: Catalogue['assets'][number] }) {
  const category = formatCategory(asset.category);

  return (
    <article className="card">
      <a className="card-media" href={asset.assetUrl} rel="noreferrer" target="_blank">
        {asset.imageUrl === null
          ? <span className="card-media-empty">No image</span>
          : <img alt="" loading="lazy" src={asset.imageUrl} />}
      </a>
      <div className="card-body">
        <h3 className="card-title">
          <a href={asset.assetUrl} rel="noreferrer" target="_blank">{asset.name}</a>
        </h3>
        <p className="card-meta">
          <span>{asset.publisher ?? 'Unknown publisher'}</span>
          {category === null ? null : <span className="chip">{category}</span>}
        </p>
        <p className="card-price">{formatPrice(asset.priceCents)}</p>
      </div>
    </article>
  );
}

export function Gallery() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

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

  const assets = useMemo(() => catalogue?.assets ?? [], [catalogue]);
  const visible = useMemo(() => filterAssets(assets, filters), [assets, filters]);
  const categories = useMemo(() => categoriesOf(assets), [assets]);

  return (
    <div className="page">
      <header className="site-header">
        <div>
          <p className="eyebrow">Prize catalogue</p>
          <h1>{brand.name}</h1>
        </div>
      </header>

      {error === null
        ? null
        : (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}

      {catalogue === null && error === null
        ? <p className="notice" role="status">Loading the prize list…</p>
        : null}

      {catalogue === null
        ? null
        : (
            <>
              <section className="totals" aria-label="Totals">
                <p className="total" title={totalsTooltip(catalogue.totals)}>
                  <strong>{describeTotals(catalogue.totals)}</strong>
                </p>
              </section>

              <section className="controls" aria-label="Search and sort">
                <label className="field">
                  <span>Search</span>
                  <input
                    onChange={event => setFilters(current => ({ ...current, query: event.target.value }))}
                    placeholder="Name, publisher, category"
                    type="search"
                    value={filters.query}
                  />
                </label>

                <label className="field">
                  <span>Category</span>
                  <select
                    onChange={event => setFilters(current => ({ ...current, category: event.target.value }))}
                    value={filters.category}
                  >
                    <option value="">All categories</option>
                    {categories.map(category => (
                      <option key={category} value={category}>{formatCategory(category)}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Sort by</span>
                  <select
                    onChange={event => setFilters(current => ({ ...current, sort: event.target.value as SortKey }))}
                    value={filters.sort}
                  >
                    {Object.entries(SORT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
              </section>

              <p aria-live="polite" className="result-count">
                {visible.length === assets.length
                  ? `Showing all ${assets.length}`
                  : `Showing ${visible.length} of ${assets.length}`}
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
                    <div className="grid">
                      {visible.map(asset => <AssetCard asset={asset} key={asset.id} />)}
                    </div>
                  )}
            </>
          )}
    </div>
  );
}
