/**
 * Presenting prices and counts. A price can legitimately be unknown — the Asset
 * Store page did not offer one and nobody typed it in — so every formatter here
 * has something to say about that instead of showing `null`. Prices are USD.
 */

const LOCALE = 'en-US';
const CURRENCY = 'USD';

export function formatPrice(priceCents: number | null): string {
  if (priceCents === null)
    return '';

  return new Intl.NumberFormat(LOCALE, { currency: CURRENCY, style: 'currency' }).format(priceCents / 100);
}

export function formatAssetCount(count: number): string {
  return count === 1 ? '1 asset' : `${count} assets`;
}

/** Total is a sum of prices; unknown prices simply do not contribute. */
export function describeTotals(totals: { count: number; priceCents: number }): string {
  return `${formatAssetCount(totals.count)} · ${formatPrice(totals.priceCents)} in total`;
}

export function totalsTooltip(totals: { count: number; priceCents: number }): string {
  return `${formatAssetCount(totals.count)} listed, adding up to ${formatPrice(totals.priceCents)}. `
    + 'Assets without a known price add nothing to the total.';
}

const ACRONYMS = new Set(['2d', '3d', 'ai', 'ar', 'gui', 'ui', 'vfx', 'vr', 'xr']);

/**
 * The category is the Asset Store path, which is readable but technical:
 * `3d/environments/landscapes` becomes `3D › Environments › Landscapes`.
 */
export function formatCategory(category: string | null): string | null {
  const segments = (category ?? '')
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment !== '')
    .map(segment => segment
      .split('-')
      .map((word) => {
        const lower = word.toLowerCase();
        return ACRONYMS.has(lower) ? lower.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
      })
      .join(' '));

  return segments.length === 0 ? null : segments.join(' › ');
}
