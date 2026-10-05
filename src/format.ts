import type { PublicAsset } from '../server/payloads.ts';

/**
 * Presenting prices and counts. A price can legitimately be unknown — the Asset
 * Store page did not offer one and nobody typed it in — so every formatter here
 * has something to say about that instead of showing `null`.
 */

const LOCALE = 'en-US';

export function formatPrice(priceCents: number | null, currency: string): string {
  if (priceCents === null)
    return 'price unknown';

  try {
    return new Intl.NumberFormat(LOCALE, { currency, style: 'currency' }).format(priceCents / 100);
  }
  catch {
    // An unexpected currency code should not blank the whole card.
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}

export function formatAmount(priceCents: number, currency: string): string {
  return formatPrice(priceCents, currency);
}

export function formatAssetCount(count: number): string {
  return count === 1 ? '1 asset' : `${count} assets`;
}

/** Total is a sum of prices; unknown prices simply do not contribute. */
export function describeTotals(totals: { count: number; priceCents: number }, currency: string): string {
  return `${formatAssetCount(totals.count)} · ${formatAmount(totals.priceCents, currency)} in total`;
}

export function totalsTooltip(totals: { count: number; priceCents: number }, currency: string): string {
  return `${formatAssetCount(totals.count)} listed, adding up to ${formatAmount(totals.priceCents, currency)}. `
    + 'Assets without a known price add nothing to the total.';
}

export function assetCurrency(assets: PublicAsset[], fallback = 'USD'): string {
  return assets.find(asset => asset.priceCents !== null)?.currency ?? fallback;
}
