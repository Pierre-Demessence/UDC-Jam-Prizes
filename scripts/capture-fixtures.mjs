/**
 * Captures the metadata portion of live Asset Store pages into `server/fixtures/`
 * so the parser tests run against real markup instead of hand-written guesses.
 *
 * One-off dev utility, run on demand:  node scripts/capture-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const PAGES = {
  'asset-page.html': 'https://assetstore.unity.com/packages/tools/gui/text-animator-for-unity-ui-toolkit-and-text-mesh-pro-341308',
};

// Unity serves the same metadata to a plain HTTP client as to a browser, so no
// headless browser is needed to capture it.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const META = /<meta\b[^>]*>/gi;
const LD_JSON = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

mkdirSync('server/fixtures', { recursive: true });

for (const [file, url] of Object.entries(PAGES)) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  const html = await response.text();

  const metas = html.match(META) ?? [];
  const blocks = [...html.matchAll(LD_JSON)].map(match => match[1].trim());
  const fixture = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    ...metas,
    ...blocks.map(block => `<script type="application/ld+json">${block}</script>`),
    '</head>',
    '<body></body>',
    '</html>',
    '',
  ].join('\n');

  writeFileSync(`server/fixtures/${file}`, fixture);

  // Reported because the app's price strategy depends on this: the price is not
  // in the served HTML, so it cannot be parsed from the fixture.
  const priceMentions = (html.match(/"price"/g) ?? []).length;
  console.log(`${file}: ${response.status}, ${fixture.length} bytes, ${metas.length} meta tags, ${blocks.length} ld+json blocks, ${priceMentions} "price" mentions`);
}
