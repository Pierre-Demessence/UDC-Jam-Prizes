import { describe, expect, it } from 'vitest';

import { DEFAULT_SORT, nextSort, sortAuthors } from '@/admin/author-table';

import type { AdminAuthor } from '../../server/payloads.ts';

function author(overrides: Partial<AdminAuthor> & { label: string }): AdminAuthor {
  return {
    id: 1,
    assetCount: 0,
    discordHandle: null,
    discordId: null,
    publisher: null,
    publisherId: null,
    ...overrides,
  };
}

const names = (rows: AdminAuthor[]): string[] => rows.map(row => row.label);

// Named differently from their publisher, so a test cannot pass by sorting either.
const febucci = author({ id: 1, label: 'prima', publisher: 'Febucci', publisherId: '45737' });
const codeStage = author({ id: 2, assetCount: 3, label: 'priya', publisher: 'Code Stage', publisherId: '3918' });
const unnamed = author({ id: 3, label: 'Author #3' });

describe('the default order', () => {
  it('is the publisher name, ascending', () => {
    expect(DEFAULT_SORT).toEqual({ direction: 'ascending', key: 'publisher' });
    expect(names(sortAuthors([febucci, codeStage], DEFAULT_SORT))).toEqual(['priya', 'prima']);
  });

  it('leaves a record with no publisher last, whichever way the column runs', () => {
    const rows = [unnamed, febucci, codeStage];

    expect(names(sortAuthors(rows, DEFAULT_SORT))).toEqual(['priya', 'prima', 'Author #3']);
    expect(names(sortAuthors(rows, { direction: 'descending', key: 'publisher' })))
      .toEqual(['prima', 'priya', 'Author #3']);
  });

  it('leaves the array it was handed alone', () => {
    const rows = [febucci, codeStage];
    sortAuthors(rows, DEFAULT_SORT);

    expect(names(rows)).toEqual(['prima', 'priya']);
  });
});

describe('the id columns', () => {
  it('reads store ids as counts, so the shorter id comes first', () => {
    expect(names(sortAuthors([febucci, codeStage], { direction: 'ascending', key: 'publisherId' })))
      .toEqual(['priya', 'prima']);
  });

  it('does the same for a Discord id, which no number holds exactly', () => {
    const rows = [
      author({ id: 1, discordId: '123456789012345678', label: 'long' }),
      author({ id: 2, discordId: '99999999999999999', label: 'short' }),
    ];

    expect(names(sortAuthors(rows, { direction: 'ascending', key: 'discordId' }))).toEqual(['short', 'long']);
  });
});

describe('sorting by another column', () => {
  it('counts the prizes', () => {
    expect(names(sortAuthors([febucci, codeStage], { direction: 'ascending', key: 'prizes' })))
      .toEqual(['prima', 'priya']);
  });

  it('sorts the handle, with the records that have none last', () => {
    const rows = [author({ id: 1, discordHandle: 'zoe', label: 'z' }), author({ id: 2, label: 'nobody' }), author({ id: 3, discordHandle: 'adam', label: 'a' })];

    expect(names(sortAuthors(rows, { direction: 'ascending', key: 'handle' }))).toEqual(['a', 'z', 'nobody']);
  });

  it('falls back to how a record is named when the column ties', () => {
    const rows = [author({ id: 1, label: 'zoe', publisher: 'One Studio' }), author({ id: 2, label: 'adam', publisher: 'One Studio' })];

    expect(names(sortAuthors(rows, DEFAULT_SORT))).toEqual(['adam', 'zoe']);
  });
});

describe('nextSort', () => {
  it('starts a new column ascending, and turns the sorted one around', () => {
    expect(nextSort({ direction: 'descending', key: 'prizes' }, 'handle')).toEqual({ direction: 'ascending', key: 'handle' });
    expect(nextSort({ direction: 'ascending', key: 'handle' }, 'handle')).toEqual({ direction: 'descending', key: 'handle' });
    expect(nextSort({ direction: 'descending', key: 'handle' }, 'handle')).toEqual({ direction: 'ascending', key: 'handle' });
  });
});
