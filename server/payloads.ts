/**
 * Shaping API responses.
 *
 * Public payloads are built field by field from an explicit list — never by
 * deleting keys from a database row — so adding a private column later cannot
 * leak it by accident. `assets.notes`, Discord handles and key values are the
 * private fields this protects.
 */
import type { Asset, Contact, Key } from './schema.ts';

import { decryptSecret } from './secrets.ts';

export interface PublicAsset {
  id: number;
  name: string;
  assetId: string;
  assetUrl: string;
  category: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  publisher: string | null;
}

export interface CatalogueTotals {
  count: number;
  priceCents: number;
}

export interface PublicCatalogue {
  assets: PublicAsset[];
  totals: CatalogueTotals;
}

/** One stored key. A key carries nothing else now: no status, no recipient. */
export interface AdminKey {
  id: number;
  keyValue: string;
}

export interface AdminContact {
  contactNotes: string | null;
  discordHandle: string;
}

export interface AdminAsset extends PublicAsset {
  contact: AdminContact | null;
  createdAt: string;
  /** Hidden from the public catalogue, but still listed here. */
  hidden: boolean;
  keys: AdminKey[];
  /** How many keys the winners asked for. Private: it is planning, not catalogue data. */
  needed: number;
  notes: string | null;
  updatedAt: string;
}

/**
 * A key that no longer opens — the encryption secret was changed, or the row was
 * tampered with — is reported as such rather than shown as base64 nobody would
 * notice.
 */
function readableKeyValue(stored: string, secret: string): string {
  try {
    return decryptSecret(stored, secret);
  }
  catch {
    return '(unreadable: KEY_ENCRYPTION_SECRET cannot open this value)';
  }
}

export function toPublicAsset(asset: Asset): PublicAsset {
  return {
    id: asset.id,
    name: asset.name,
    assetId: asset.assetId,
    assetUrl: asset.assetUrl,
    category: asset.category,
    imageUrl: asset.imageUrl,
    priceCents: asset.priceCents,
    publisher: asset.publisher,
  };
}

export function toAdminAsset(asset: Asset, contact: Contact | null, keys: Key[], secret: string): AdminAsset {
  return {
    ...toPublicAsset(asset),
    contact: contact === null ? null : { contactNotes: contact.contactNotes, discordHandle: contact.discordHandle },
    createdAt: asset.createdAt.toISOString(),
    hidden: asset.hidden,
    needed: asset.needed,
    notes: asset.notes,
    updatedAt: asset.updatedAt.toISOString(),
    keys: keys.map(key => ({
      id: key.id,
      keyValue: readableKeyValue(key.keyValue, secret),
    })),
  };
}
