import { describe, expect, it } from 'vitest';

import { DEFAULT_SORT, keyNeed, keySummary, needClass, needLabel, nextSort, sortAssets } from '@/admin/asset-table';

import type { AdminAsset } from '../../server/payloads.ts';

function asset(overrides: Partial<AdminAsset> & { name: string }): AdminAsset {
  return {
    id: 1,
    assetId: overrides.name,
    assetUrl: 'https://assetstore.unity.com/packages/tools/a-prize-1',
    category: null,
    contact: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    imageUrl: null,
    keys: [],
    needed: 0,
    notes: null,
    priceCents: null,
    publisher: null,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** n stored keys: a key holds nothing but its value. */
function stored(count: number): AdminAsset['keys'] {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1, keyValue: `KEY-${index + 1}` }));
}

const prizes: AdminAsset[] = [
  asset({ id: 1, name: 'Bee UI', category: 'tools/gui', keys: stored(2), priceCents: 2000, publisher: 'Febucci' }),
  asset({ id: 2, name: 'Mountain Lake', category: '3d/environments/landscapes', keys: stored(1), priceCents: 5999, publisher: 'VIVID Arts' }),
  asset({ id: 3, name: 'Apple Kit', category: 'tools/gui', contact: { contactNotes: null, discordHandle: 'priya' }, keys: stored(3), priceCents: 100, publisher: 'Someone' }),
  asset({ id: 4, name: 'Zebra Kit', category: null, keys: [], priceCents: null, publisher: null }),
];

const names = (list: AdminAsset[]): string[] => list.map(prize => prize.name);

describe('sortAssets', () => {
  it('sorts by name by default, and climbs or descends on demand', () => {
    expect(names(sortAssets(prizes, DEFAULT_SORT))).toEqual(['Apple Kit', 'Bee UI', 'Mountain Lake', 'Zebra Kit']);
    expect(names(sortAssets(prizes, { direction: 'descending', key: 'name' }))).toEqual(['Zebra Kit', 'Mountain Lake', 'Bee UI', 'Apple Kit']);
  });

  it('sorts by author, leaving an unknown author last in either direction', () => {
    expect(names(sortAssets(prizes, { direction: 'ascending', key: 'author' })))
      .toEqual(['Bee UI', 'Apple Kit', 'Mountain Lake', 'Zebra Kit']);
    // Two prizes by the same author keep the name order, the same way the public gallery does.
    expect(names(sortAssets(prizes, { direction: 'descending', key: 'author' })))
      .toEqual(['Mountain Lake', 'Apple Kit', 'Bee UI', 'Zebra Kit']);
  });

  it('sorts by price, leaving an unknown price last in either direction', () => {
    expect(names(sortAssets(prizes, { direction: 'ascending', key: 'price' })))
      .toEqual(['Apple Kit', 'Bee UI', 'Mountain Lake', 'Zebra Kit']);
    expect(names(sortAssets(prizes, { direction: 'descending', key: 'price' })))
      .toEqual(['Mountain Lake', 'Bee UI', 'Apple Kit', 'Zebra Kit']);
  });

  it('sorts by category, by the label the table shows rather than the slug', () => {
    expect(names(sortAssets(prizes, { direction: 'ascending', key: 'category' })))
      .toEqual(['Mountain Lake', 'Apple Kit', 'Bee UI', 'Zebra Kit']);
  });

  it('sorts by how many keys are stored', () => {
    expect(names(sortAssets(prizes, { direction: 'ascending', key: 'keys' })))
      .toEqual(['Zebra Kit', 'Mountain Lake', 'Bee UI', 'Apple Kit']);
    expect(names(sortAssets(prizes, { direction: 'descending', key: 'keys' })))
      .toEqual(['Apple Kit', 'Bee UI', 'Mountain Lake', 'Zebra Kit']);
  });

  it('sorts by contact, leaving a prize with no contact last in either direction', () => {
    expect(names(sortAssets(prizes, { direction: 'ascending', key: 'contact' })))
      .toEqual(['Apple Kit', 'Bee UI', 'Mountain Lake', 'Zebra Kit']);
    expect(names(sortAssets(prizes, { direction: 'descending', key: 'contact' })))
      .toEqual(['Apple Kit', 'Bee UI', 'Mountain Lake', 'Zebra Kit']);
  });

  it('breaks a tie on the column with the name, so the order never wobbles', () => {
    const sameEverything = [
      asset({ id: 1, name: 'Second', priceCents: 100, publisher: 'Someone' }),
      asset({ id: 2, name: 'First', priceCents: 100, publisher: 'Someone' }),
    ];

    expect(names(sortAssets(sameEverything, { direction: 'ascending', key: 'price' }))).toEqual(['First', 'Second']);
    expect(names(sortAssets(sameEverything, { direction: 'ascending', key: 'author' }))).toEqual(['First', 'Second']);
    // A tie stays A to Z even when the column itself runs the other way.
    expect(names(sortAssets(sameEverything, { direction: 'descending', key: 'price' }))).toEqual(['First', 'Second']);
  });

  it('does not reorder the list it was given', () => {
    const input = [...prizes];
    sortAssets(input, { direction: 'descending', key: 'keys' });

    expect(names(input)).toEqual(['Bee UI', 'Mountain Lake', 'Apple Kit', 'Zebra Kit']);
  });
});

describe('keyNeed', () => {
  const prize = (needed: number, keys: number): AdminAsset =>
    asset({ name: 'Prize', keys: stored(keys), needed });

  it('leaves a prize nobody asked for alone, even with keys in stock', () => {
    const need = keyNeed(prize(0, 2));

    expect(need.state).toBe('none');
    // A publisher can send keys before the jam ends; that is not a state to report.
    expect(needClass(need)).toBeUndefined();
  });

  it('is short while the requested keys have not all arrived', () => {
    const need = keyNeed(prize(5, 3));

    expect(need).toMatchObject({ needed: 5, obtained: 3, state: 'short' });
    expect(needClass(need)).toBe('row-short');
    expect(needLabel(need)).toBe('3 of 5 keys');
  });

  it('is covered as soon as as many keys are stored as were asked for', () => {
    const exact = keyNeed(prize(3, 3));

    expect(exact.state).toBe('covered');
    expect(needClass(exact)).toBe('row-covered');
    expect(keyNeed(prize(3, 4)).state).toBe('covered');
    expect(keyNeed(prize(3, 2)).state).toBe('short');
  });
});

describe('sorting by the number of keys needed', () => {
  it('orders by the request, with the name as the tie-break', () => {
    const asked = [
      asset({ id: 1, name: 'Bee UI', keys: [], needed: 4 }),
      asset({ id: 2, name: 'Apple Kit', keys: [], needed: 4 }),
      asset({ id: 3, name: 'Zebra Kit', keys: [], needed: 0 }),
      asset({ id: 4, name: 'Mountain Lake', keys: [], needed: 2 }),
    ];

    expect(names(sortAssets(asked, { direction: 'ascending', key: 'needed' })))
      .toEqual(['Zebra Kit', 'Mountain Lake', 'Apple Kit', 'Bee UI']);
    expect(names(sortAssets(asked, { direction: 'descending', key: 'needed' })))
      .toEqual(['Apple Kit', 'Bee UI', 'Mountain Lake', 'Zebra Kit']);
  });
});

describe('nextSort', () => {
  it('starts ascending on a new column and turns the current one around', () => {
    expect(nextSort({ direction: 'descending', key: 'name' }, 'keys')).toEqual({ direction: 'ascending', key: 'keys' });
    expect(nextSort({ direction: 'ascending', key: 'name' }, 'name')).toEqual({ direction: 'descending', key: 'name' });
    expect(nextSort({ direction: 'descending', key: 'name' }, 'name')).toEqual({ direction: 'ascending', key: 'name' });
  });
});

describe('keySummary', () => {
  it('says how many keys are stored', () => {
    expect(keySummary(prizes[0])).toBe('2 keys stored.');
    expect(keySummary(asset({ name: 'One', keys: stored(1) }))).toBe('1 key stored.');
  });

  it('says so when there are no keys', () => {
    expect(keySummary(prizes[3])).toBe('No keys stored yet.');
  });
});
