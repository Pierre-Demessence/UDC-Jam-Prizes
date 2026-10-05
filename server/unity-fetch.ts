import { MetadataError } from './unity.ts';

/**
 * Fetching an Asset Store page from the server.
 *
 * The host is an allow-list on purpose: this endpoint takes a URL from the
 * admin, and without a check it would happily fetch anything reachable from the
 * server — cloud metadata, internal hosts, the lot.
 */

const ALLOWED_HOSTS = new Set(['assetstore.unity.com']);
const MAX_PAGE_CHARS = 4_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export interface FetchPageOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Throws a `MetadataError` unless `raw` is an https Asset Store URL. */
export function assertAssetStoreUrl(raw: unknown): URL {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '')
    throw new MetadataError('Paste an Asset Store URL.');

  let url: URL;
  try {
    url = new URL(value);
  }
  catch {
    throw new MetadataError('That does not look like a URL.');
  }

  if (url.protocol !== 'https:')
    throw new MetadataError('The URL must start with https://.');

  if (!ALLOWED_HOSTS.has(url.hostname))
    throw new MetadataError('Only https://assetstore.unity.com pages are supported.');

  url.search = '';
  url.hash = '';

  return url;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

async function send(url: URL, fetchImpl: typeof fetch, timeoutMs: number): Promise<Response> {
  try {
    return await fetchImpl(url, {
      headers: { 'accept': 'text/html', 'user-agent': USER_AGENT },
      // Redirects are followed by hand, so every hop goes through the allow-list.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
  catch (cause) {
    if (cause instanceof Error && cause.name === 'TimeoutError')
      throw new MetadataError('The Asset Store took too long to answer.');

    throw new MetadataError('Could not reach the Asset Store.');
  }
}

async function readPage(response: Response): Promise<string> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_PAGE_CHARS)
    throw new MetadataError('That page is too large to read.');

  let html: string;
  try {
    html = await response.text();
  }
  catch {
    throw new MetadataError('The Asset Store stopped answering while the page was downloading.');
  }

  if (html.length > MAX_PAGE_CHARS)
    throw new MetadataError('That page is too large to read.');

  return html;
}

export async function fetchAssetPage(url: URL, options: FetchPageOptions = {}): Promise<string> {
  const { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = options;

  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await send(target, fetchImpl, timeoutMs);

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (location === null)
        throw new MetadataError('The Asset Store answered with a redirect to nowhere.');

      target = assertAssetStoreUrl(new URL(location, target).href);
      continue;
    }

    if (response.status === 404)
      throw new MetadataError('The Asset Store has no page at that address.');

    if (!response.ok)
      throw new MetadataError(`The Asset Store answered ${response.status}.`);

    return await readPage(response);
  }

  throw new MetadataError('The Asset Store redirected too many times.');
}
