import { describe, expect, it } from 'vitest';

import { DEFAULT_SORT, keySummary, nextSort, sortAssets } from '@/admin/asset-table';

import type { AdminAsset } from '../../server/payloads.ts';

function asset(overrides: Partial<AdminAsset> & { name: string }): AdminAsset {
  return {
    id: 1,
    assetId: overrides.name,
    assetUrl: 'https://assetstore.unity.com/packages/tools/a-prize-1',
    category: null,
    contact: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    currency: 'USD',
    imageUrl: null,
    keys: [],
    notes: null,
    priceCents: null,
    publisher: null,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function keys(...statuses: string[]): AdminAsset['keys'] {
  return statuses.map((status, index) => ({
    id: index + 1,
    assignedTo: null,
    keyValue: `KEY-${index + 1}`,
    sentAt: null,
    status,
  }));
}

const prizes: AdminAsset[] = [
  asset({ id: 1, name: 'Bee UI', category: 'tools/gui', keys: keys('available', 'sent'), priceCents: 2000, publisher: 'Febucci' }),
  asset({ id: 2, name: 'Mountain Lake', category: '3d/environments/landscapes', keys: keys('available'), priceCents: 5999, publisher: 'VIVID Arts' }),
  asset({ id: 3, name: 'Apple Kit', category: 'tools/gui', contact: { contactNotes: null, discordHandle: 'priya' }, keys: keys('available', 'sent', 'sent'), priceCents: 100, publisher: 'Someone' }),
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

describe('nextSort', () => {
  it('starts ascending on a new column and turns the current one around', () => {
    expect(nextSort({ direction: 'descending', key: 'name' }, 'keys')).toEqual({ direction: 'ascending', key: 'keys' });
    expect(nextSort({ direction: 'ascending', key: 'name' }, 'name')).toEqual({ direction: 'descending', key: 'name' });
    expect(nextSort({ direction: 'descending', key: 'name' }, 'name')).toEqual({ direction: 'ascending', key: 'name' });
  });
});

describe('keySummary', () => {
  it('says what a count is made of, in a fixed order', () => {
    expect(keySummary(prizes[2])).toBe('1 available · 2 sent');
    expect(keySummary(prizes[0])).toBe('1 available · 1 sent');
  });

  it('says so when there are no keys', () => {
    expect(keySummary(prizes[3])).toBe('No keys stored yet.');
  });
});
