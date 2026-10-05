import type { PublicAsset } from '../server/payloads.ts';

/** Searching, filtering and sorting the public list. Pure, so it is testable. */

export type SortKey = 'name' | 'price-asc' | 'price-desc';

export interface Filters {
  category: string;
  query: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = { category: '', query: '', sort: 'name' };

export const SORT_LABELS: Record<SortKey, string> = {
  'name': 'Name',
  'price-asc': 'Price, cheapest first',
  'price-desc': 'Price, dearest first',
};

export function categoriesOf(assets: PublicAsset[]): string[] {
  const categories = new Set<string>();
  for (const asset of assets) {
    if (asset.category !== null && asset.category !== '')
      categories.add(asset.category);
  }

  return [...categories].sort((left, right) => left.localeCompare(right));
}

function matchesQuery(asset: PublicAsset, query: string): boolean {
  const haystack = [asset.name, asset.publisher ?? '', asset.category ?? ''].join(' ').toLowerCase();
  return haystack.includes(query);
}

/** A missing price sorts last in both directions: it is not a cheap asset. */
function byPrice(left: PublicAsset, right: PublicAsset, direction: 1 | -1): number {
  if (left.priceCents === null || right.priceCents === null) {
    if (left.priceCents === right.priceCents)
      return left.name.localeCompare(right.name);

    return left.priceCents === null ? 1 : -1;
  }

  return (left.priceCents - right.priceCents) * direction || left.name.localeCompare(right.name);
}

export function filterAssets(assets: PublicAsset[], filters: Filters): PublicAsset[] {
  const query = filters.query.trim().toLowerCase();
  const filtered = assets.filter(asset =>
    (filters.category === '' || asset.category === filters.category)
    && (query === '' || matchesQuery(asset, query)),
  );

  return filtered.sort((left, right) => {
    if (filters.sort === 'name')
      return left.name.localeCompare(right.name);

    return byPrice(left, right, filters.sort === 'price-asc' ? 1 : -1);
  });
}
