import { describe, expect, it } from 'vitest';

import { DEFAULT_FILTERS, filterAssets } from '@/catalogue';

import type { PublicAsset } from '../server/payloads.ts';

function asset(overrides: Partial<PublicAsset>): PublicAsset {
  return {
    id: 1,
    name: 'A Tool',
    assetId: '1',
    assetUrl: 'https://assetstore.unity.com/packages/tools/a-tool-1',
    category: 'tools',
    imageUrl: null,
    priceCents: 1000,
    publisher: 'Someone',
    publisherId: null,
    ...overrides,
  };
}

const catalogue: PublicAsset[] = [
  asset({ name: 'Bee UI', assetId: '1', category: 'tools/gui', priceCents: 2000, publisher: 'Febucci' }),
  asset({ name: 'Apple Kit', assetId: '2', category: '2d', priceCents: 500, publisher: 'Someone Else' }),
  asset({ name: 'Cherry Kit', assetId: '3', category: '2d', priceCents: null, publisher: 'Someone Else' }),
];

describe('filterAssets', () => {
  it('searches names, publishers and categories', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: 'febucci' }).map(a => a.name)).toEqual(['Bee UI']);
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: 'kit' }).map(a => a.name)).toEqual(['Apple Kit', 'Cherry Kit']);
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: '2d' }).map(a => a.name)).toEqual(['Apple Kit', 'Cherry Kit']);
  });

  it('narrows to one category', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, category: '2d' }).map(a => a.name)).toEqual(['Apple Kit', 'Cherry Kit']);
  });

  it('includes the categories below the picked one', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, category: 'tools' }).map(a => a.name)).toEqual(['Bee UI']);
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, category: 'tools/gui' }).map(a => a.name)).toEqual(['Bee UI']);
  });

  it('ignores case and surrounding spaces in the query', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: '  APPLE  ' }).map(a => a.name)).toEqual(['Apple Kit']);
  });

  it('returns everything when the filters are empty', () => {
    expect(filterAssets(catalogue, DEFAULT_FILTERS)).toHaveLength(3);
  });
});

describe('sorting', () => {
  const alsoUnknownPublisher = [
    ...catalogue,
    asset({ id: 4, name: 'Zebra Kit', assetId: '4', publisher: null }),
  ];

  it('sorts by name by default', () => {
    expect(filterAssets(catalogue, DEFAULT_FILTERS).map(a => a.name)).toEqual(['Apple Kit', 'Bee UI', 'Cherry Kit']);
  });

  it('sorts by publisher, and leaves an unknown publisher for last', () => {
    expect(filterAssets(alsoUnknownPublisher, { ...DEFAULT_FILTERS, sort: 'publisher' }).map(a => a.name))
      .toEqual(['Bee UI', 'Apple Kit', 'Cherry Kit', 'Zebra Kit']);
  });

  it('breaks a tie on the publisher by name', () => {
    const twoBySamePublisher = [
      asset({ id: 1, name: 'Second', assetId: '1', publisher: 'Someone' }),
      asset({ id: 2, name: 'First', assetId: '2', publisher: 'Someone' }),
    ];

    expect(filterAssets(twoBySamePublisher, { ...DEFAULT_FILTERS, sort: 'publisher' }).map(a => a.name))
      .toEqual(['First', 'Second']);
  });

  it('does not mutate the list it was given', () => {
    const input = [...catalogue];
    filterAssets(input, { ...DEFAULT_FILTERS, sort: 'publisher' });

    expect(input.map(a => a.name)).toEqual(['Bee UI', 'Apple Kit', 'Cherry Kit']);
  });
});
