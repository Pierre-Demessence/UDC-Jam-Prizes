import { describe, expect, it } from 'vitest';

import { assetCurrency, describeTotals, formatAssetCount, formatPrice, totalsTooltip } from '@/format';

import type { PublicAsset } from '../server/payloads.ts';

function asset(overrides: Partial<PublicAsset> = {}): PublicAsset {
  return {
    id: 1,
    name: 'A Tool',
    assetId: '1',
    assetUrl: 'https://assetstore.unity.com/packages/tools/a-tool-1',
    category: 'tools',
    currency: 'USD',
    imageUrl: null,
    priceCents: null,
    publisher: 'Someone',
    ...overrides,
  };
}

describe('formatPrice', () => {
  it('renders cents as a currency amount', () => {
    expect(formatPrice(3250, 'USD')).toBe('$32.50');
  });

  it('treats a free asset as a price, not as unknown', () => {
    expect(formatPrice(0, 'USD')).toBe('$0.00');
  });

  it('says so when the price is unknown', () => {
    expect(formatPrice(null, 'USD')).toBe('price unknown');
  });

  it('shows a currency code it does not recognise rather than failing', () => {
    // Intl separates the code from the amount with a non-breaking space.
    expect(formatPrice(1000, 'XYZ')).toMatch(/^XYZ\s10\.00$/);
  });

  it('falls back to plain text for a currency code that is not a code', () => {
    expect(formatPrice(1000, 'US$')).toBe('10.00 US$');
  });
});

describe('the totals line', () => {
  it('counts and sums', () => {
    expect(describeTotals({ count: 3, priceCents: 9750 }, 'USD')).toBe('3 assets · $97.50 in total');
  });

  it('reads naturally for a single asset', () => {
    expect(formatAssetCount(1)).toBe('1 asset');
  });

  it('explains what the numbers are, for the tooltip', () => {
    const tooltip = totalsTooltip({ count: 2, priceCents: 1000 }, 'USD');

    expect(tooltip).toContain('$10.00');
    expect(tooltip).toContain('without a known price');
  });
});

describe('assetCurrency', () => {
  it('takes the currency of the first asset that has a price', () => {
    const assets = [asset({ currency: 'EUR' }), asset({ currency: 'USD', priceCents: 500 })];

    expect(assetCurrency(assets)).toBe('USD');
  });

  it('falls back when nothing is priced', () => {
    expect(assetCurrency([asset()])).toBe('USD');
  });
});
