import { describe, expect, it } from 'vitest';

import { describeTotals, formatAssetCount, formatCategory, formatPrice, totalsTooltip } from '@/format';

describe('formatPrice', () => {
  it('renders cents as a currency amount', () => {
    expect(formatPrice(3250)).toBe('$32.50');
  });

  it('treats a free asset as a price, not as unknown', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });

  it('shows nothing when the price is unknown', () => {
    expect(formatPrice(null)).toBe('');
  });
});

describe('the totals line', () => {
  it('counts and sums', () => {
    expect(describeTotals({ count: 3, priceCents: 9750 })).toBe('3 assets · $97.50 in total');
  });

  it('reads naturally for a single asset', () => {
    expect(formatAssetCount(1)).toBe('1 asset');
  });

  it('explains what the numbers are, for the tooltip', () => {
    const tooltip = totalsTooltip({ count: 2, priceCents: 1000 });

    expect(tooltip).toContain('$10.00');
    expect(tooltip).toContain('without a known price');
  });
});

describe('formatCategory', () => {
  it('turns the store path into something readable', () => {
    expect(formatCategory('3d/environments/landscapes')).toBe('3D › Environments › Landscapes');
  });

  it('keeps the shorthands that are written in capitals', () => {
    expect(formatCategory('tools/gui')).toBe('Tools › GUI');
    expect(formatCategory('vfx/shaders')).toBe('VFX › Shaders');
  });

  it('turns dashes into spaces', () => {
    expect(formatCategory('tools/particles-effects')).toBe('Tools › Particles Effects');
  });

  it('has nothing to show for no category', () => {
    expect(formatCategory(null)).toBeNull();
    expect(formatCategory('')).toBeNull();
    expect(formatCategory('///')).toBeNull();
  });
});
