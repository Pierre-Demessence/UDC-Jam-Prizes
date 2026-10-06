// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MetadataError, parseAssetPage } from './unity.ts';

const PAGE_URL = 'https://assetstore.unity.com/packages/tools/gui/text-animator-for-unity-ui-toolkit-and-text-mesh-pro-341308';
const DISCOUNTED_URL = 'https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/p09-modular-humanoid-lite-317283';

// Captured from the live page by `scripts/capture-fixtures.mjs`, so the tests
// run against Unity's real markup rather than markup guessed from it.
const realPage = readFileSync(new URL('./fixtures/asset-page.html', import.meta.url), 'utf8');
const discountedPage = readFileSync(new URL('./fixtures/asset-page-discounted.html', import.meta.url), 'utf8');

function pageWith(ldJson: unknown, state?: string, body = ''): string {
  const embedded = state === undefined ? '' : `<script>var state = ${state};</script>`;

  return `<html><head><script type="application/ld+json">${JSON.stringify(ldJson)}</script>${embedded}</head><body>${body}</body></html>`;
}

function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'name': 'A Tool',
    '@context': 'https://schema.org/',
    '@type': 'Product',
    'brand': { 'name': 'Febucci', '@type': 'Thing' },
    'image': ['//cdn.example.com/key-image/abc.jpg'],
    'offers': {
      '@type': 'Offer',
      'availability': 'https://schema.org/InStock',
      'price': '32.50',
      'priceCurrency': 'USD',
      'url': PAGE_URL,
    },
    ...overrides,
  };
}

describe('parseAssetPage on a real Asset Store page', () => {
  const metadata = parseAssetPage(realPage, PAGE_URL);

  it('reads the fields the catalogue needs', () => {
    expect(metadata.name).toBe('Text Animator for Unity | UI Toolkit and Text Mesh Pro');
    expect(metadata.publisher).toBe('Febucci');
    expect(metadata.publisherId).toBe('45737');
    expect(metadata.assetId).toBe('341308');
  });

  it('stores the list price rather than the offer price while the page is discounted', () => {
    // The page was on sale when it was captured: the offer carries 32.50, and the
    // page's own entry (59.80 against 29.90) doubles it back to the 65.00 list price.
    expect(metadata.priceCents).toBe(6500);
  });

  it('makes the image absolute, since the page serves it protocol-relative', () => {
    expect(metadata.imageUrl).toBe('https://assetstorev1-prd-cdn.unity3d.com/key-image/455730a2-b1ff-4a8f-b844-08b5f16c352c.jpg');
  });

  it('derives the category from the page path', () => {
    expect(metadata.category).toBe('tools/gui');
  });

  it('drops the query string from the stored URL', () => {
    expect(metadata.assetUrl).toBe(PAGE_URL);
  });
});

describe('parseAssetPage when the asset is on sale', () => {
  const metadata = parseAssetPage(discountedPage, DISCOUNTED_URL);

  it('takes the list price rather than the sale price', () => {
    // The offer says 4.87 USD, 85% off. The page's own entry carries 29.90
    // against 4.48 in the visitor's currency: a ratio of 6.674, which lifts the
    // offer's 4.87 to the 32.50 USD list price.
    expect(metadata.priceCents).toBe(3250);
  });

  it('fills every other field from the product markup', () => {
    expect(metadata.name).toBe('P09_Modular_Humanoid_Lite');
    expect(metadata.assetId).toBe('317283');
    expect(metadata.publisher).toBe('Sabao3179');
    expect(metadata.publisherId).toBe('54696');
    expect(metadata.category).toBe('3d/characters/humanoids/fantasy');
    expect(metadata.imageUrl).toBe('https://assetstorev1-prd-cdn.unity3d.com/key-image/41951b3c-583b-4fce-bb93-0f4538c375fc.jpg');
  });
});

describe('the price when the page has nothing to lift it with', () => {
  const entry = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
    341308: {
      id: '341308',
      __typename: 'Product',
      originalPrice: { currency: 'EUR', finalPrice: '3.25', originalPrice: '32.50' },
      ...overrides,
    },
  });

  it('keeps the offer price when the entry belongs to another kind of item', () => {
    const html = pageWith(product(), entry({ __typename: 'Bundle' }));

    expect(parseAssetPage(html, PAGE_URL).priceCents).toBe(3250);
  });

  it('keeps the offer price when the entry is for another asset', () => {
    const html = pageWith(product(), JSON.stringify({ 999: { id: '999', __typename: 'Product' } }));

    expect(parseAssetPage(html, PAGE_URL).priceCents).toBe(3250);
  });

  it('keeps the offer price when the entry cannot be read', () => {
    const html = pageWith(product(), '{"341308":{"id":"341308","__typename":"Product","originalPrice":{');

    expect(parseAssetPage(html, PAGE_URL).priceCents).toBe(3250);
  });

  it('keeps the offer price when the entry has no usable amounts', () => {
    // A free asset, a missing amount, an amount that is not a number: the ratio
    // is unknown rather than one, and the offer stands.
    for (const broken of [{ finalPrice: '0', originalPrice: '0' }, { finalPrice: 'free' }, { originalPrice: null }]) {
      const html = pageWith(product(), entry({ originalPrice: broken }));

      expect(parseAssetPage(html, PAGE_URL).priceCents, JSON.stringify(broken)).toBe(3250);
    }
  });

  it('lifts the offer price when the entry has the ratio', () => {
    // 32.50 against 3.25 is a ratio of 10, so the offer's 32.50 becomes 325.00.
    expect(parseAssetPage(pageWith(product(), entry()), PAGE_URL).priceCents).toBe(32_500);
  });

  it('leaves a free asset free', () => {
    const offers = { price: '0', priceCurrency: 'USD' };
    const html = pageWith(product({ offers }), entry({ originalPrice: { finalPrice: '0', originalPrice: '0' } }));

    expect(parseAssetPage(html, PAGE_URL).priceCents).toBe(0);
  });
});

describe('parseAssetPage on the fields worth getting right', () => {
  it('leaves the price empty when the page has no offer', () => {
    const metadata = parseAssetPage(pageWith(product({ offers: undefined })), PAGE_URL);

    expect(metadata.priceCents).toBeNull();
  });

  it('accepts an offer list, as schema.org allows', () => {
    const offers = [{ price: '9.99', priceCurrency: 'USD' }];
    const metadata = parseAssetPage(pageWith(product({ offers })), PAGE_URL);

    expect(metadata.priceCents).toBe(999);
  });

  it('accepts a numeric price', () => {
    const offers = { price: 12.5, priceCurrency: 'USD' };
    expect(parseAssetPage(pageWith(product({ offers })), PAGE_URL).priceCents).toBe(1250);
  });

  it('reads an offer that declares no currency at all', () => {
    const offers = { price: '32.50' };

    expect(parseAssetPage(pageWith(product({ offers })), PAGE_URL).priceCents).toBe(3250);
  });

  it('refuses a price given in another currency, rather than calling it dollars', () => {
    const offers = { price: '32.50', priceCurrency: 'EUR' };

    expect(parseAssetPage(pageWith(product({ offers })), PAGE_URL).priceCents).toBeNull();
  });

  it('treats a free asset as a price of zero rather than as unknown', () => {
    const offers = { price: '0', priceCurrency: 'USD' };
    expect(parseAssetPage(pageWith(product({ offers })), PAGE_URL).priceCents).toBe(0);
  });

  it('decodes entities in the name', () => {
    const metadata = parseAssetPage(pageWith(product({ name: 'Tools &amp; Toys' })), PAGE_URL);

    expect(metadata.name).toBe('Tools & Toys');
  });

  it('skips a broken block and reads the next one', () => {
    const html = `<html><head>
      <script type="application/ld+json">{ not json }</script>
      <script type="application/ld+json">${JSON.stringify(product())}</script>
      </head><body></body></html>`;

    expect(parseAssetPage(html, PAGE_URL).name).toBe('A Tool');
  });

  it('reads a product given as an item of a list', () => {
    const html = pageWith([{ '@type': 'BreadcrumbList' }, product()]);

    expect(parseAssetPage(html, PAGE_URL).assetId).toBe('341308');
  });

  it('has no category when the path has none', () => {
    const metadata = parseAssetPage(pageWith(product()), 'https://assetstore.unity.com/packages/tool-341308');

    expect(metadata.category).toBeNull();
    expect(metadata.assetId).toBe('341308');
  });

  it('explains itself when the page has no product', () => {
    expect(() => parseAssetPage('<html><head></head><body>hi</body></html>', PAGE_URL))
      .toThrow(MetadataError);
  });

  it('refuses a product it cannot identify', () => {
    const url = 'https://assetstore.unity.com/packages/tools/gui/unnamed';

    expect(() => parseAssetPage(pageWith(product({ offers: undefined })), url))
      .toThrow(/asset id/i);
  });
});

describe('the publisher id', () => {
  const byline = '<div class="byline"><a href="/publishers/45737"><div class="avatar">F</div><div class="name">Febucci</div></a></div>';

  it('reads it from the anchor that sits beside the asset title', () => {
    expect(parseAssetPage(pageWith(product(), undefined, `<h1>A Tool</h1>${byline}`), PAGE_URL).publisherId).toBe('45737');
  });

  it('keeps the id as text, since it is a label and not a quantity', () => {
    const html = pageWith(product(), undefined, '<h1>A Tool</h1><a href="/publishers/0012345">P</a>');

    expect(parseAssetPage(html, PAGE_URL).publisherId).toBe('0012345');
  });

  it('takes the byline anchor, not a publisher link in the page\'s own data', () => {
    // The two shapes the live page carries besides the byline: a description
    // linking another publisher, escaped inside the JSON-LD (so its quotes arrive
    // as \"), and the embedded state's top-rated list, whose links carry no
    // `href=`. Neither can pass for the byline anchor the reader looks for.
    const description = 'Pairs with <a href="https://assetstore.unity.com/publishers/44630">Mini set</a>.';
    const state = JSON.stringify({ topRated: [{ name: 'Muka Schultze', link: '/publishers/15803' }] });

    expect(parseAssetPage(pageWith(product({ description }), state, `<h1>A Tool</h1>${byline}`), PAGE_URL).publisherId).toBe('45737');
  });

  it('ignores an anchor that comes before the title', () => {
    // The reader starts after `</h1>`: the byline is what follows the title, and a
    // link above it belongs to whatever else the page carries.
    const body = `<a href="/publishers/99999">Something else</a><h1>A Tool</h1>${byline}`;

    expect(parseAssetPage(pageWith(product(), undefined, body), PAGE_URL).publisherId).toBe('45737');
  });

  it('has no publisher id when the anchor is not a number', () => {
    const body = '<h1>A Tool</h1><a href="/publishers/febucci">Febucci</a>';

    expect(parseAssetPage(pageWith(product(), undefined, body), PAGE_URL).publisherId).toBeNull();
  });

  it('has no publisher id when the page carries no anchor', () => {
    expect(parseAssetPage(pageWith(product()), PAGE_URL).publisherId).toBeNull();
  });

  it('has none when there is no title to read it from', () => {
    expect(parseAssetPage(pageWith(product(), undefined, byline), PAGE_URL).publisherId).toBeNull();
  });
});
