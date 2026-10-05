/**
 * Adding several prizes at once from pasted links.
 *
 * Each link is read the same way the single-asset form reads it, a few at a
 * time rather than all at once: enough to be quick on twenty links, polite
 * enough for the Asset Store. One bad link never stops the batch — it comes back
 * with the reason it failed.
 */
import type { DatabaseHandle } from './db.ts';

import { createAsset, findAssetByAssetId } from './repository.ts';
import { assertAssetStoreUrl, fetchAssetPage } from './unity-fetch.ts';
import { MetadataError, parseAssetPage } from './unity.ts';
import { assetInputFromMetadata } from './validate.ts';

type Db = DatabaseHandle['db'];

export type ImportStatus = 'added' | 'duplicate' | 'failed';

export interface ImportResult {
  name: string | null;
  message: string | null;
  status: ImportStatus;
  url: string;
}

export interface ImportOutcome {
  added: number;
  duplicates: number;
  failed: number;
  results: ImportResult[];
}

/** How many links are read at the same time, and the pause between them. */
const CONCURRENCY = 3;
const PAUSE_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function importAssets(
  db: Db,
  fetchImpl: typeof fetch,
  urls: string[],
  keyEncryptionSecret: string,
): Promise<ImportOutcome> {
  const results: ImportResult[] = [];
  let cursor = 0;

  async function importOne(raw: string): Promise<ImportResult> {
    try {
      const url = assertAssetStoreUrl(raw);
      const html = await fetchAssetPage(url, { fetchImpl });
      const metadata = parseAssetPage(html, url.href);
      const existing = findAssetByAssetId(db, metadata.assetId);

      if (existing !== null) {
        return { name: existing.name, message: 'Already in the list.', status: 'duplicate', url: url.href };
      }

      const asset = createAsset(db, assetInputFromMetadata(metadata), keyEncryptionSecret);

      return { name: asset.name, message: null, status: 'added', url: asset.assetUrl };
    }
    catch (cause) {
      return {
        // Only the messages this app writes are shown; anything else is a bug we
        // would rather log than hand to the browser.
        name: null,
        message: cause instanceof MetadataError ? cause.message : 'Could not read that link.',
        status: 'failed',
        url: raw,
      };
    }
  }

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await importOne(urls[index]);

      if (cursor < urls.length)
        await delay(PAUSE_MS);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker);
  await Promise.all(workers);

  return {
    added: results.filter(result => result.status === 'added').length,
    duplicates: results.filter(result => result.status === 'duplicate').length,
    failed: results.filter(result => result.status === 'failed').length,
    results,
  };
}
