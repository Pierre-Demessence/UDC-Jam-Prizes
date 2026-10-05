// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { MetadataError, parseAssetPage } from './unity.ts';

const PAGE_URL = 'https://assetstore.unity.com/packages/tools/gui/text-animator-for-unity-ui-toolkit-and-text-mesh-pro-341308';

// Captured from the live page by `scripts/capture-fixtures.mjs`, so the tests
// run against Unity's real markup rather than markup guessed from it.
const realPage = readFileSync(new URL('./fixtures/asset-page.html', import.meta.url), 'utf8');

function pageWith(ldJson: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(ldJson)}</script></head><body></body></html>`;
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
    expect(metadata.assetId).toBe('341308');
  });

  it('reads the price from the product offer', () => {
    expect(metadata.priceCents).toBe(3250);
    expect(metadata.currency).toBe('USD');
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

describe('parseAssetPage on the fields worth getting right', () => {
  it('leaves the price empty when the page has no offer', () => {
    const metadata = parseAssetPage(pageWith(product({ offers: undefined })), PAGE_URL);

    expect(metadata.priceCents).toBeNull();
    expect(metadata.currency).toBe('USD');
  });

  it('accepts an offer list, as schema.org allows', () => {
    const offers = [{ price: '9.99', priceCurrency: 'eur' }];
    const metadata = parseAssetPage(pageWith(product({ offers })), PAGE_URL);

    expect(metadata.priceCents).toBe(999);
    expect(metadata.currency).toBe('EUR');
  });

  it('accepts a numeric price', () => {
    const offers = { price: 12.5, priceCurrency: 'USD' };
    expect(parseAssetPage(pageWith(product({ offers })), PAGE_URL).priceCents).toBe(1250);
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
