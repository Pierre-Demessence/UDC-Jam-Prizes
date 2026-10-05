import { formatCategory } from '@/format';
import { compareOptional } from '@/sort';

import type { AdminAsset } from '../../server/payloads.ts';

/** The admin table's columns and how each one orders the rows. */

export type SortDirection = 'ascending' | 'descending';
export type SortKey = 'author' | 'category' | 'contact' | 'keys' | 'name' | 'price';

export interface Sort {
  direction: SortDirection;
  key: SortKey;
}

export interface Column {
  /** Numbers read better flush to the end of the cell. */
  alignEnd?: boolean;
  key: SortKey | null;
  label: string;
  /** What the column holds, kept as the header's tooltip. */
  title: string;
}

export const DEFAULT_SORT: Sort = { direction: 'ascending', key: 'name' };

export const COLUMNS: Column[] = [
  { key: 'name', label: 'Prize', title: 'The asset name, read from the Asset Store page.' },
  { key: 'author', label: 'Author', title: 'The publisher on the store page. The person who donated it is the contact beside it.' },
  { key: 'category', label: 'Category', title: 'Read from the address of the store page.' },
  { alignEnd: true, key: 'price', label: 'Price', title: 'What the asset costs, read from the page and editable.' },
  { alignEnd: true, key: 'keys', label: 'Keys', title: 'How many keys are stored for this prize, and where each one went.' },
  { key: 'contact', label: 'Contact', title: 'Discord handle of the person who donated the prize. Private.' },
  { key: null, label: 'Actions', title: 'Edit the prize, open its keys and contact, or delete it.' },
];

/** Clicking the sorted column again turns it around; another column starts ascending. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort.key !== key)
    return { direction: 'ascending', key };

  return { direction: sort.direction === 'ascending' ? 'descending' : 'ascending', key };
}

const KEY_STATUS_ORDER = ['available', 'sent'];

/** `2 available · 1 sent`, so a count of three says what it is made of. */
export function keySummary(asset: AdminAsset): string {
  const parts = KEY_STATUS_ORDER
    .map(status => ({ count: asset.keys.filter(key => key.status === status).length, status }))
    .filter(entry => entry.count > 0)
    .map(entry => `${entry.count} ${entry.status}`);

  return parts.length === 0 ? 'No keys stored yet.' : parts.join(' · ');
}

/** A copy, sorted; the caller's array is left alone. */
export function sortAssets(assets: AdminAsset[], sort: Sort): AdminAsset[] {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  const text = (left: string, right: string): number => left.localeCompare(right);
  const byName = (left: AdminAsset, right: AdminAsset): number => left.name.localeCompare(right.name);

  return [...assets].sort((left, right) => {
    switch (sort.key) {
      case 'author':
        return compareOptional(left.publisher, right.publisher, text, direction) || byName(left, right);
      case 'category':
        return compareOptional(formatCategory(left.category), formatCategory(right.category), text, direction) || byName(left, right);
      case 'contact':
        return compareOptional(left.contact?.discordHandle ?? null, right.contact?.discordHandle ?? null, text, direction) || byName(left, right);
      case 'keys':
        return direction * (left.keys.length - right.keys.length) || byName(left, right);
      case 'price':
        return compareOptional(left.priceCents, right.priceCents, (a, b) => a - b, direction) || byName(left, right);
      case 'name':
      default:
        return direction * byName(left, right);
    }
  });
}
