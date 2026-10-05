import { describe, expect, it } from 'vitest';

import { categoriesOf, DEFAULT_FILTERS, filterAssets } from '@/catalogue';

import type { PublicAsset } from '../server/payloads.ts';

function asset(overrides: Partial<PublicAsset>): PublicAsset {
  return {
    id: 1,
    name: 'A Tool',
    assetId: '1',
    assetUrl: 'https://assetstore.unity.com/packages/tools/a-tool-1',
    category: 'tools',
    currency: 'USD',
    imageUrl: null,
    priceCents: 1000,
    publisher: 'Someone',
    ...overrides,
  };
}

const catalogue: PublicAsset[] = [
  asset({ name: 'Bee UI', assetId: '1', category: 'tools/gui', priceCents: 2000, publisher: 'Febucci' }),
  asset({ name: 'Apple Kit', assetId: '2', category: '2d', priceCents: 500, publisher: 'Someone Else' }),
  asset({ name: 'Cherry Kit', assetId: '3', category: '2d', priceCents: null, publisher: 'Someone Else' }),
];

describe('categoriesOf', () => {
  it('lists each category once, in order', () => {
    expect(categoriesOf(catalogue)).toEqual(['2d', 'tools/gui']);
  });
});

describe('filterAssets', () => {
  it('searches names, publishers and categories', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: 'febucci' }).map(a => a.name)).toEqual(['Bee UI']);
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: 'kit' }).map(a => a.name)).toEqual(['Apple Kit', 'Cherry Kit']);
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: '2d' }).map(a => a.name)).toEqual(['Apple Kit', 'Cherry Kit']);
  });

  it('narrows to one category', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, category: '2d' }).map(a => a.name)).toEqual(['Apple Kit', 'Cherry Kit']);
  });

  it('ignores case and surrounding spaces in the query', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, query: '  APPLE  ' }).map(a => a.name)).toEqual(['Apple Kit']);
  });

  it('returns everything when the filters are empty', () => {
    expect(filterAssets(catalogue, DEFAULT_FILTERS)).toHaveLength(3);
  });
});

describe('sorting', () => {
  it('sorts by name by default', () => {
    expect(filterAssets(catalogue, DEFAULT_FILTERS).map(a => a.name)).toEqual(['Apple Kit', 'Bee UI', 'Cherry Kit']);
  });

  it('sorts by price with the unknown price last', () => {
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, sort: 'price-asc' }).map(a => a.name))
      .toEqual(['Apple Kit', 'Bee UI', 'Cherry Kit']);
    expect(filterAssets(catalogue, { ...DEFAULT_FILTERS, sort: 'price-desc' }).map(a => a.name))
      .toEqual(['Bee UI', 'Apple Kit', 'Cherry Kit']);
  });

  it('does not mutate the list it was given', () => {
    const input = [...catalogue];
    filterAssets(input, { ...DEFAULT_FILTERS, sort: 'price-desc' });

    expect(input.map(a => a.name)).toEqual(['Bee UI', 'Apple Kit', 'Cherry Kit']);
  });
});
