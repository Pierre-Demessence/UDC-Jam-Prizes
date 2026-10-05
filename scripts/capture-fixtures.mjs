/**
 * Captures the metadata portion of live Asset Store pages into `server/fixtures/`
 * so the parser tests run against real markup instead of hand-written guesses.
 *
 * One-off dev utility, run on demand:  node scripts/capture-fixtures.mjs [name]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const PAGES = {
  'asset-page-discounted.html': 'https://assetstore.unity.com/packages/3d/characters/humanoids/fantasy/p09-modular-humanoid-lite-317283',
  'asset-page.html': 'https://assetstore.unity.com/packages/tools/gui/text-animator-for-unity-ui-toolkit-and-text-mesh-pro-341308',
};

// Unity serves the same metadata to a plain HTTP client as to a browser, so no
// headless browser is needed to capture it.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const META = /<meta\b[^>]*>/gi;
const LD_JSON = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

/** The JSON object that starts at `from`, found by counting braces outside strings. */
function objectAt(text, from) {
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
      depth += 1;
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
 * The page's own product entry, keyed by its Unity id. The full page is about
 * 870 kB of scripts and markup, and this is the one part of it the parser reads
 * beyond the meta tags: it is where the list price sits beside the sale price,
 * which is what the app stores.
 */
function productEntry(html, assetId) {
  const markerAt = html.indexOf(`"${assetId}":{"id":"${assetId}"`);
  if (markerAt === -1)
    return null;

  const object = objectAt(html, html.indexOf('{', markerAt));
  return object === null ? null : `{"${assetId}":${object}}`;
}

const only = process.argv[2];

mkdirSync('server/fixtures', { recursive: true });

for (const [file, url] of Object.entries(PAGES)) {
  if (only !== undefined && only !== file)
    continue;

  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  const html = await response.text();

  const metas = html.match(META) ?? [];
  const blocks = [...html.matchAll(LD_JSON)].map(match => match[1].trim());
  const state = productEntry(html, /(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? '');
  const fixture = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    ...metas,
    ...blocks.map(block => `<script type="application/ld+json">${block}</script>`),
    ...(state === null ? [] : [`<script type="application/json" id="product-state">${state}</script>`]),
    '</head>',
    '<body></body>',
    '</html>',
    '',
  ].join('\n');

  writeFileSync(`server/fixtures/${file}`, fixture);

  console.log(`${file}: ${response.status}, ${fixture.length} bytes, ${metas.length} meta tags, ${blocks.length} ld+json blocks, product entry ${state === null ? 'not found' : 'captured'}`);
}
