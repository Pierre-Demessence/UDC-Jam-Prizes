import { compareOptional } from '@/sort';

import type { AdminAuthor } from '../../server/payloads.ts';

/** The authors table's columns and how each one orders the rows. */

export type SortDirection = 'ascending' | 'descending';
export type SortKey = 'discordId' | 'handle' | 'prizes' | 'publisher' | 'publisherId';

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

/**
 * Publisher first: it is the name a prize matches on, and the one label every
 * record that came from a page has.
 */
export const DEFAULT_SORT: Sort = { direction: 'ascending', key: 'publisher' };

export const COLUMNS: Column[] = [
  { key: 'publisher', label: 'Publisher', title: 'The publisher name on the store page, which is what a prize matches on.' },
  { key: 'publisherId', label: 'Publisher id', title: 'Unity\'s own id for that publisher, the number in the store address, /publishers/3918; the store link is built from it. Read from the page when a prize was scraped.' },
  { key: 'handle', label: 'Handle', title: 'Private: the Discord handle, which the author can change, and which names them on screen.' },
  { key: 'discordId', label: 'Discord id', title: 'Private: the Discord id, which does not change when the handle does.' },
  { alignEnd: true, key: 'prizes', label: 'Prizes', title: 'How many prizes are attached.' },
  { key: null, label: 'Actions', title: 'Edit the author, attach prizes by publisher, or delete it.' },
];

/** Clicking the sorted column again turns it around; another column starts ascending. */
export function nextSort(sort: Sort, key: SortKey): Sort {
  if (sort.key !== key)
    return { direction: 'ascending', key };

  return { direction: sort.direction === 'ascending' ? 'descending' : 'ascending', key };
}

/**
 * Digits compare as counts — longer means larger, and equal lengths compare as
 * text, which for digits is the numeric order. Anything else falls back to text.
 * A number would lose the last digits of a Discord snowflake.
 */
function compareIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right))
    return left.length - right.length || left.localeCompare(right);

  return left.localeCompare(right);
}

/** A copy, sorted; the caller's array is left alone. */
export function sortAuthors(authors: AdminAuthor[], sort: Sort): AdminAuthor[] {
  const direction = sort.direction === 'ascending' ? 1 : -1;
  const text = (left: string, right: string): number => left.localeCompare(right);
  // Ties follow how the record is named, then how it is named on the store, then
  // its id: two authors with no handle and no publisher still have a fixed order.
  const byLabel = (left: AdminAuthor, right: AdminAuthor): number =>
    left.label.localeCompare(right.label)
    || (left.publisher ?? '').localeCompare(right.publisher ?? '')
    || left.id - right.id;

  return [...authors].sort((left, right) => {
    switch (sort.key) {
      case 'publisherId':
        return compareOptional(left.publisherId, right.publisherId, compareIds, direction) || byLabel(left, right);
      case 'handle':
        return compareOptional(left.discordHandle, right.discordHandle, text, direction) || byLabel(left, right);
      case 'discordId':
        return compareOptional(left.discordId, right.discordId, compareIds, direction) || byLabel(left, right);
      case 'prizes':
        return direction * (left.assetCount - right.assetCount) || byLabel(left, right);
      case 'publisher':
      default:
        return compareOptional(left.publisher, right.publisher, text, direction) || byLabel(left, right);
    }
  });
}
