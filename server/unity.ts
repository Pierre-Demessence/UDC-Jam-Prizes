/**
 * Reading an Asset Store page.
 *
 * The page carries a schema.org `Product` in a `application/ld+json` block —
 * name, image, description, brand and an `Offer` with `price` and
 * `priceCurrency` — so the whole autofill is a parse, no browser and no
 * undocumented API. Unity also serves that same markup to a plain HTTP client.
 */

/** The catalogue fields an Asset Store page can fill in. */
export interface AssetMetadata {
  name: string;
  assetId: string;
  assetUrl: string;
  category: string | null;
  currency: string;
  imageUrl: string | null;
  priceCents: number | null;
  publisher: string | null;
}

/** A page that could not be read, with a message worth showing to the admin. */
export class MetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataError';
  }
}

const LD_JSON_BLOCK = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
const CENTS = 100;
const DEFAULT_CURRENCY = 'USD';
const TRAILING_ID = /(\d+)\/?$/;

const ENTITIES: Record<string, string> = {
  '&#39;': '\'',
  '&amp;': '&',
  '&gt;': '>',
  '&lt;': '<',
  '&nbsp;': ' ',
  '&quot;': '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|gt|lt|nbsp|quot|#39);/g, match => ENTITIES[match] ?? match);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string')
    return null;

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `"32.50"` → `3250`. Cents, because money in floats does not add up. */
function toCents(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0)
    return null;

  return Math.round(amount * CENTS);
}

function firstImage(value: unknown): string | null {
  if (!Array.isArray(value))
    return null;

  for (const entry of value) {
    if (typeof entry === 'string')
      return entry;

    const nested = asNonEmptyString((entry as { url?: unknown } | null)?.url);
    if (nested)
      return nested;
  }

  return null;
}

function offerPrice(offers: unknown): { currency: string | null; priceCents: number | null } {
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (typeof first !== 'object' || first === null)
    return { currency: null, priceCents: null };

  const offer = first as { price?: unknown; priceCurrency?: unknown };
  return {
    currency: asNonEmptyString(offer.priceCurrency)?.toUpperCase() ?? null,
    priceCents: toCents(offer.price),
  };
}

function findProduct(html: string): Record<string, unknown> {
  for (const match of html.matchAll(LD_JSON_BLOCK)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    }
    catch {
      continue;
    }

    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      if (typeof item === 'object' && item !== null && (item as { '@type'?: unknown })['@type'] === 'Product')
        return item as Record<string, unknown>;
    }
  }

  throw new MetadataError('That page has no asset metadata. Check that it is a Unity Asset Store asset page.');
}

/** `…/packages/tools/gui/nice-tool-123456` → `tools/gui`. */
function categoryFromPath(url: URL): string | null {
  const segments = url.pathname.split('/').filter(Boolean);
  const start = segments.indexOf('packages');
  if (start === -1)
    return null;

  const category = segments.slice(start + 1, -1).join('/');
  return category === '' ? null : category;
}

function assetIdFrom(url: URL, offerUrl: unknown): string | null {
  const fromOffer = asNonEmptyString(offerUrl);
  // The offer URL is preferred, but it is not always the page address: fall back
  // to the path rather than failing to identify the asset.
  const match = TRAILING_ID.exec(fromOffer ?? '') ?? TRAILING_ID.exec(url.pathname);
  return match?.[1] ?? null;
}

/**
 * Parses the fields the catalogue needs. `pageUrl` is the canonical address of
 * the page: relative image URLs and the asset id are resolved against it.
 */
export function parseAssetPage(html: string, pageUrl: string): AssetMetadata {
  const url = new URL(pageUrl);
  const product = findProduct(html);
  const name = asNonEmptyString(product.name);
  if (!name)
    throw new MetadataError('That page has no asset name.');

  const assetId = assetIdFrom(url, (product.offers as { url?: unknown } | undefined)?.url);
  if (!assetId)
    throw new MetadataError('That page has no asset id, so the asset cannot be identified.');

  const image = firstImage(product.image);
  const { currency, priceCents } = offerPrice(product.offers);

  url.search = '';
  url.hash = '';

  return {
    name: decodeEntities(name),
    assetId,
    assetUrl: url.href,
    category: categoryFromPath(url),
    currency: currency ?? DEFAULT_CURRENCY,
    imageUrl: image ? new URL(image, url).href : null,
    priceCents,
    publisher: asNonEmptyString((product.brand as { name?: unknown } | undefined)?.name),
  };
}
