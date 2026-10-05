/**
 * Reading an Asset Store page.
 *
 * The page carries a schema.org `Product` in a `application/ld+json` block —
 * name, image, description, brand and an `Offer` with a `price` — so the whole
 * autofill is a parse, no browser and no undocumented API. Unity also serves
 * that same markup to a plain HTTP client. Prices are USD: a server-side request
 * gets USD from Unity, so no currency is stored with them — an offer that declares
 * another currency is refused rather than valued as dollars.
 */

/** The catalogue fields an Asset Store page can fill in. */
export interface AssetMetadata {
  name: string;
  assetId: string;
  assetUrl: string;
  category: string | null;
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
const USD = 'USD';
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

/**
 * The offer's price in cents, or nothing when the page offers no usable amount.
 * The catalogue is USD, so an offer that declares another currency is read as
 * no price rather than stored as if it were dollars.
 */
function offerPriceCents(offers: unknown): number | null {
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (typeof first !== 'object' || first === null)
    return null;

  const offer = first as { price?: unknown; priceCurrency?: unknown };
  const currency = asNonEmptyString(offer.priceCurrency)?.toUpperCase();
  // Some pages carry no currency at all; the offer is then taken at face value.
  if (currency !== undefined && currency !== USD)
    return null;

  return toCents(offer.price);
}

/** The JSON object that starts at `from`, found by counting braces outside strings. */
function jsonObjectAt(text: string, from: number): string | null {
  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped)
        escaped = false;
      else if (char === '\\')
        escaped = true;
      else if (char === '"')
        inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
    }
    else if (char === '{') {
      depth++;
    }
    else if (char === '}') {
      depth -= 1;
      if (depth === 0)
        return text.slice(from, index + 1);
    }
  }

  return null;
}

/**
 * The page embeds its own copy of the product, keyed by Unity's asset id, and
 * that copy carries the sale price beside the list price. The JSON-LD offer has
 * the sale price alone, so a prize imported during a sale would be valued at the
 * price of the week.
 *
 * The two amounts in that entry are in the visitor's own currency, which a server
 * has no say in, so they are used as a ratio rather than as a price: a ratio
 * holds whatever the currency, and applying it to the offer's price lifts the USD
 * sale price to the USD list price. Anything unexpected — no entry, another kind
 * of item, a shape that changed, a free asset — returns nothing, and the offer's
 * price stands as it is.
 */
function listToSaleRatio(html: string, assetId: string): number | null {
  const marker = `"${assetId}":{"id":"${assetId}"`;
  const markerAt = html.indexOf(marker);
  const object = markerAt === -1 ? null : jsonObjectAt(html, html.indexOf('{', markerAt));
  if (object === null)
    return null;

  try {
    const entry = JSON.parse(object) as {
      __typename?: unknown;
      originalPrice?: { finalPrice?: unknown; originalPrice?: unknown };
    };

    // Only a product is priced this way; a bundle or a carousel card is not.
    if (entry.__typename !== 'Product')
      return null;

    const list = Number.parseFloat(String(entry.originalPrice?.originalPrice ?? ''));
    const sale = Number.parseFloat(String(entry.originalPrice?.finalPrice ?? ''));
    if (!Number.isFinite(list) || !Number.isFinite(sale) || list <= 0 || sale <= 0)
      return null;

    return list / sale;
  }
  catch {
    return null;
  }
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
  const offerCents = offerPriceCents(product.offers);
  // The price the page offers is the sale price during a sale; the entry's ratio
  // lifts it to the list price, which is what a donated prize is worth.
  const ratio = listToSaleRatio(html, assetId);

  url.search = '';
  url.hash = '';

  return {
    name: decodeEntities(name),
    assetId,
    assetUrl: url.href,
    category: categoryFromPath(url),
    imageUrl: image ? new URL(image, url).href : null,
    publisher: asNonEmptyString((product.brand as { name?: unknown } | undefined)?.name),
    priceCents: offerCents === null || ratio === null
      ? offerCents
      : Math.round(offerCents * ratio),
  };
}
