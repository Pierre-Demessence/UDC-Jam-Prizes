/**
 * Shaping API responses.
 *
 * Public payloads are built field by field from an explicit list — never by
 * deleting keys from a database row — so adding a private column later cannot
 * leak it by accident. `assets.notes`, Discord handles and key values are the
 * private fields this protects.
 */
import type { Asset, Contact, Key } from './schema.ts';

export interface PublicAsset {
  id: number;
  name: string;
  assetId: string;
  assetUrl: string;
  category: string | null;
  currency: string;
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

export interface AdminKey {
  id: number;
  assignedAt: string | null;
  assignedTo: string | null;
  keyValue: string;
  sentAt: string | null;
  status: string;
}

export interface AdminContact {
  contactNotes: string | null;
  discordHandle: string;
}

export interface AdminAsset extends PublicAsset {
  contact: AdminContact | null;
  createdAt: string;
  keys: AdminKey[];
  notes: string | null;
  updatedAt: string;
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function toPublicAsset(asset: Asset): PublicAsset {
  return {
    id: asset.id,
    name: asset.name,
    assetId: asset.assetId,
    assetUrl: asset.assetUrl,
    category: asset.category,
    currency: asset.currency,
    imageUrl: asset.imageUrl,
    priceCents: asset.priceCents,
    publisher: asset.publisher,
  };
}

export function toAdminAsset(asset: Asset, contact: Contact | null, keys: Key[]): AdminAsset {
  return {
    ...toPublicAsset(asset),
    contact: contact === null ? null : { contactNotes: contact.contactNotes, discordHandle: contact.discordHandle },
    createdAt: asset.createdAt.toISOString(),
    notes: asset.notes,
    updatedAt: asset.updatedAt.toISOString(),
    keys: keys.map(key => ({
      id: key.id,
      assignedAt: toIso(key.assignedAt),
      assignedTo: key.assignedTo,
      keyValue: key.keyValue,
      sentAt: toIso(key.sentAt),
      status: key.status,
    })),
  };
}
