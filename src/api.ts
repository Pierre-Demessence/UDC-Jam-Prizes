import type { ImportOutcome } from '../server/import-assets.ts';
import type { AdminAsset, AdminAuthor, CatalogueTotals, PublicAsset } from '../server/payloads.ts';
import type { AssetInput, AuthorInput, MetadataPrefill } from '../server/validate.ts';

export interface Catalogue {
  assets: PublicAsset[];
  totals: CatalogueTotals;
}

export interface MetadataLookup {
  existingAsset: { id: number; name: string } | null;
  metadata: MetadataPrefill;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface RequestOptions {
  attempts?: number;
  delayMs?: number;
  fetchImpl?: typeof fetch;
}

const RETRY_STATUSES = new Set([502, 503, 504]);
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function once(path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(path, { credentials: 'same-origin', ...init });
}

/**
 * The dev proxy answers 502 while the API is still booting, and a cold
 * `npm run dev` starts both at once, so a failure is worth a couple of retries
 * before it is shown.
 */
async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const { attempts = DEFAULT_ATTEMPTS, delayMs = DEFAULT_DELAY_MS, fetchImpl = fetch } = options;
  let lastError = new ApiError('The API is unreachable.', 0);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await once(path, init, fetchImpl);

      if (RETRY_STATUSES.has(response.status) && attempt < attempts) {
        await delay(delayMs);
        continue;
      }

      if (response.status === 204)
        return undefined as T;

      const body: unknown = await response.json().catch(() => null);
      const message = (body as { error?: string } | null)?.error;

      if (!response.ok)
        throw new ApiError(message ?? `The API answered ${response.status}.`, response.status);

      return body as T;
    }
    catch (cause) {
      if (cause instanceof ApiError)
        throw cause;

      lastError = new ApiError('The API is unreachable.', 0);
      if (attempt < attempts)
        await delay(delayMs);
    }
  }

  throw lastError;
}

function json(body: unknown, method: string): RequestInit {
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method };
}

export const api = {
  adminAssets: () => request<{ assets: AdminAsset[] }>('/api/admin/assets'),
  catalogue: () => request<Catalogue>('/api/assets'),
  createAsset: (input: AssetInput) => request<{ asset: AdminAsset }>('/api/admin/assets', json(input, 'POST')),
  deleteAsset: (id: number) => request<void>(`/api/admin/assets/${id}`, { method: 'DELETE' }),
  metadata: (url: string) => request<MetadataLookup>('/api/metadata', json({ url }, 'POST')),
  session: () => request<{ authenticated: boolean }>('/api/session'),
  signIn: (password: string) => request<{ authenticated: boolean }>('/api/session', json({ password }, 'POST')),
  signOut: () => request<{ authenticated: boolean }>('/api/session', { method: 'DELETE' }),
  addKeys: (id: number, keys: string) => request<{ added: number; asset: AdminAsset; skipped: number }>(
    `/api/admin/assets/${id}/keys`,
    json({ keys }, 'POST'),
  ),
  deleteKey: (id: number, keyId: number) => request<{ asset: AdminAsset }>(
    `/api/admin/assets/${id}/keys/${keyId}`,
    { method: 'DELETE' },
  ),
  /** One paste of links; each is read and added on the server. */
  importUrls: (urls: string) => request<ImportOutcome & { assets: AdminAsset[] }>(
    '/api/admin/import',
    json({ urls }, 'POST'),
  ),
  /** The authors behind the prizes: one record, shared by every prize they gave. */
  authors: () => request<{ authors: AdminAuthor[] }>('/api/admin/authors'),
  /** Links every prize published under a publisher string, in one action. */
  attachAuthor: (id: number, publisher: string) => request<{ assets: AdminAsset[]; attached: number }>(
    `/api/admin/authors/${id}/attach`,
    json({ publisher }, 'POST'),
  ),
  createAuthor: (input: AuthorInput) => request<{ author: AdminAuthor }>(
    '/api/admin/authors',
    json(input, 'POST'),
  ),
  /** Deletes the author only; the prizes come back unlinked, counted. */
  deleteAuthor: (id: number) => request<{ assets: AdminAsset[]; unlinked: number }>(
    `/api/admin/authors/${id}`,
    { method: 'DELETE' },
  ),
  updateAuthor: (id: number, input: AuthorInput) => request<{ author: AdminAuthor }>(
    `/api/admin/authors/${id}`,
    json(input, 'PATCH'),
  ),
  /** How many keys the winners asked for; the admin table edits it in place. */
  setNeeded: (id: number, needed: number) => request<{ asset: AdminAsset }>(
    `/api/admin/assets/${id}/needed`,
    json({ needed }, 'PUT'),
  ),
  /** Shows or hides a prize on the public page; the admin table's own button. */
  setHidden: (id: number, hidden: boolean) => request<{ asset: AdminAsset }>(
    `/api/admin/assets/${id}/hidden`,
    json({ hidden }, 'PUT'),
  ),
  updateAsset: (id: number, input: AssetInput) => request<{ asset: AdminAsset }>(
    `/api/admin/assets/${id}`,
    json(input, 'PATCH'),
  ),
};
