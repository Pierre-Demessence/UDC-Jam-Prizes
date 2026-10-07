import { inCategory } from '@/category-tree';
import { compareOptional } from '@/sort';

import type { PublicAsset } from '../server/payloads.ts';

/** Searching, filtering and sorting the public list. Pure, so it is testable. */

export type SortKey = 'name' | 'publisher';

export interface Filters {
  category: string;
  query: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = { category: '', query: '', sort: 'name' };

export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  publisher: 'Publisher',
};

function matchesQuery(asset: PublicAsset, query: string): boolean {
  const haystack = [asset.name, asset.publisher ?? '', asset.category ?? ''].join(' ').toLowerCase();
  return haystack.includes(query);
}

/** Publishers sort by name, and a prize whose publisher is unknown sorts last. */
function byPublisher(left: PublicAsset, right: PublicAsset): number {
  return compareOptional(left.publisher, right.publisher, (a, b) => a.localeCompare(b))
    || left.name.localeCompare(right.name);
}

export function filterAssets(assets: PublicAsset[], filters: Filters): PublicAsset[] {
  const query = filters.query.trim().toLowerCase();
  const filtered = assets.filter(asset =>
    inCategory(asset.category, filters.category)
    && (query === '' || matchesQuery(asset, query)),
  );

  return filtered.sort((left, right) =>
    filters.sort === 'publisher' ? byPublisher(left, right) : left.name.localeCompare(right.name),
  );
}
