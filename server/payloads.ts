/**
 * Shaping API responses.
 *
 * Public payloads are built field by field from an explicit list — never by
 * deleting keys from a database row — so adding a private column later cannot
 * leak it by accident. `assets.notes`, Discord handles and key values are the
 * private fields this protects.
 */
import type { Asset, Author, Key } from './schema.ts';

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
  /**
   * The publisher's Unity id, which the store link is built from. It belongs to
   * the author record and is joined in for the public page: null while no author
   * is attached, or when theirs carries no id.
   */
  publisherId: string | null;
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

/**
 * The person behind one or more prizes. Private, like the contact it replaces:
 * no author field is ever published.
 */
export interface AdminAuthor {
  id: number;
  /** How many prizes hang off this author, so a delete can say what it unlinks. */
  assetCount: number;
  /**
   * How the author is named on screen: the Discord handle, then the store
   * publisher. Derived, so there is no name to keep in step with either.
   */
  discordHandle: string | null;
  label: string;
  /** The snowflake, kept as text: an identifier, never a number. */
  discordId: string | null;
  /** The store publisher string prizes match on, or null when it is not known. */
  publisher: string | null;
  /** Unity's publisher id, which the store link is built from, or null. */
  publisherId: string | null;
}

export interface AdminAsset extends PublicAsset {
  /** The donor, or null when no author has been attached yet. */
  author: AdminAuthor | null;
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

export function toPublicAsset(asset: Asset, publisherId: string | null): PublicAsset {
  return {
    id: asset.id,
    name: asset.name,
    assetId: asset.assetId,
    assetUrl: asset.assetUrl,
    category: asset.category,
    imageUrl: asset.imageUrl,
    priceCents: asset.priceCents,
    publisher: asset.publisher,
    publisherId,
  };
}

/**
 * How an author is named on screen: the Discord handle, then the store
 * publisher, then the id for a record that somehow has neither.
 */
export function authorLabel(author: Author): string {
  return author.discordHandle ?? author.publisher ?? `Author #${author.id}`;
}

export function toAdminAuthor(author: Author, assetCount: number): AdminAuthor {
  return {
    id: author.id,
    assetCount,
    discordHandle: author.discordHandle,
    discordId: author.discordId,
    label: authorLabel(author),
    publisher: author.publisher,
    publisherId: author.publisherId,
  };
}

export function toAdminAsset(asset: Asset, author: AdminAuthor | null, keys: Key[], secret: string): AdminAsset {
  return {
    ...toPublicAsset(asset, author?.publisherId ?? null),
    author,
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
