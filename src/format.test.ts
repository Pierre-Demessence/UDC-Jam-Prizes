import { describe, expect, it } from 'vitest';

import { formatCategory, formatPrice, formatPrizeCount, publisherPageUrl } from '@/format';

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

describe('formatPrizeCount', () => {
  it('counts prizes', () => {
    expect(formatPrizeCount(3)).toBe('3 prizes');
    expect(formatPrizeCount(0)).toBe('0 prizes');
  });

  it('reads naturally for a single prize', () => {
    expect(formatPrizeCount(1)).toBe('1 prize');
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

describe('publisherPageUrl', () => {
  it('builds the publisher store page from the id', () => {
    expect(publisherPageUrl('45737')).toBe('https://assetstore.unity.com/publishers/45737');
  });

  it('has no link while the id is unknown', () => {
    expect(publisherPageUrl(null)).toBeNull();
  });
});
