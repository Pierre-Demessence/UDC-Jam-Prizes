/**
 * Input validation. Hand-written rather than schema-library-driven: there are
 * five payloads, and every rule here is a sentence the admin should be able to
 * read in the response.
 */
import type { AssetMetadata } from './unity.ts';

export interface Valid<T> {
  ok: true;
  value: T;
}

export interface Invalid {
  error: string;
  ok: false;
}

export type Validation<T> = Valid<T> | Invalid;

const MAX_NAME = 200;
const MAX_NOTES = 2000;
const MAX_URL = 2000;
const MAX_KEY = 200;
const MAX_HANDLE = 100;
/** A Discord snowflake: digits only, and never a JS number, which would lose precision. */
const DISCORD_ID = /^\d{17,20}$/;
/** Unity's publisher id, digits only, as it appears in `/publishers/<id>`. */
const PUBLISHER_ID = /^\d+$/;
/** Nobody is going to hand out more keys than this for one prize. */
const MAX_NEEDED = 999;
/** One paste of links, so a single request cannot turn into a long crawl. */
export const MAX_IMPORT_URLS = 20;

export interface AssetInput {
  name: string;
  assetId: string;
  assetUrl: string;
  /** The attached author, or null for none. Whether it exists is the route's check. */
  authorId: number | null;
  category: string | null;
  imageUrl: string | null;
  notes: string | null;
  priceCents: number | null;
  publisher: string | null;
}

/**
 * What the metadata lookup answers with: the prize fields the page filled in,
 * plus the publisher id. The id belongs to the author being created, not to the
 * prize, so it travels beside `AssetInput` rather than inside it.
 */
export interface MetadataPrefill extends AssetInput {
  publisherId: string | null;
}

/**
 * One author. No field is required on its own, but at least one of the three
 * identifying ones must be given: a record with none of them could not be found
 * again, contacted, or told apart from the next one.
 */
export interface AuthorInput {
  discordHandle: string | null;
  discordId: string | null;
  publisher: string | null;
  /**
   * Unity's publisher id, from the store page. A companion to `publisher` rather
   * than an identifier on its own: prizes match on the name, and this is what the
   * store link is built from.
   */
  publisherId: string | null;
}

function text(value: unknown, field: string, max: number, required: boolean): Validation<string | null> {
  if (value === undefined || value === null || value === '') {
    return required ? { error: `${field} is required.`, ok: false } : { ok: true, value: null };
  }

  if (typeof value !== 'string')
    return { error: `${field} must be text.`, ok: false };

  const trimmed = value.trim();
  if (required && trimmed === '')
    return { error: `${field} is required.`, ok: false };

  if (trimmed.length > max)
    return { error: `${field} must be ${max} characters or fewer.`, ok: false };

  return { ok: true, value: trimmed === '' ? null : trimmed };
}

function money(value: unknown): Validation<number | null> {
  if (value === undefined || value === null || value === '')
    return { ok: true, value: null };

  const cents = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(cents) || cents < 0)
    return { error: 'The price must be a whole number of cents.', ok: false };

  return { ok: true, value: cents };
}

function httpUrl(value: string | null, field: string): Validation<string | null> {
  if (value === null)
    return { ok: true, value: null };

  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      ? { ok: true, value }
      : { error: `${field} must start with https://.`, ok: false };
  }
  catch {
    return { error: `${field} must be a URL.`, ok: false };
  }
}

/**
 * The author link: an id or nothing at all. Whether that id exists is the
 * route's check, next to the Unity-id clash it already makes.
 */
function authorLink(value: unknown): Validation<number | null> {
  if (value === undefined || value === null || value === '')
    return { ok: true, value: null };

  const id = typeof value === 'number' ? value : Number(String(value).trim());

  return Number.isInteger(id) && id > 0
    ? { ok: true, value: id }
    : { error: 'The author must be an author id.', ok: false };
}

export function parseAssetInput(body: unknown): Validation<AssetInput> {
  if (typeof body !== 'object' || body === null)
    return { error: 'Expected a JSON object.', ok: false };

  const raw = body as Record<string, unknown>;
  const name = text(raw.name, 'The name', MAX_NAME, true);
  const assetId = text(raw.assetId, 'The Unity id', 40, true);
  const assetUrl = text(raw.assetUrl, 'The Asset Store URL', MAX_URL, true);
  const publisher = text(raw.publisher, 'The publisher', MAX_NAME, false);
  const category = text(raw.category, 'The category', MAX_NAME, false);
  const imageUrl = text(raw.imageUrl, 'The image URL', MAX_URL, false);
  const notes = text(raw.notes, 'The notes', MAX_NOTES, false);
  const priceCents = money(raw.priceCents);
  const authorId = authorLink(raw.authorId);

  if (!name.ok)
    return name;
  if (!assetId.ok)
    return assetId;
  if (!assetUrl.ok)
    return assetUrl;
  if (!publisher.ok)
    return publisher;
  if (!category.ok)
    return category;
  if (!imageUrl.ok)
    return imageUrl;
  if (!notes.ok)
    return notes;
  if (!priceCents.ok)
    return priceCents;
  if (!authorId.ok)
    return authorId;

  const checkedUrl = httpUrl(assetUrl.value, 'The Asset Store URL');
  if (!checkedUrl.ok)
    return checkedUrl;

  const checkedImage = httpUrl(imageUrl.value, 'The image URL');
  if (!checkedImage.ok)
    return checkedImage;

  return {
    ok: true,
    value: {
      name: name.value as string,
      assetId: assetId.value as string,
      assetUrl: checkedUrl.value as string,
      authorId: authorId.value,
      category: category.value,
      imageUrl: checkedImage.value,
      notes: notes.value,
      priceCents: priceCents.value,
      publisher: publisher.value,
    },
  };
}

/** Prefills the form with whatever the Asset Store page provided. */
export function assetInputFromMetadata(metadata: AssetMetadata): AssetInput {
  return {
    name: metadata.name,
    assetId: metadata.assetId,
    assetUrl: metadata.assetUrl,
    // Nobody yet: the route fills this from the publisher it matched.
    authorId: null,
    category: metadata.category,
    imageUrl: metadata.imageUrl,
    notes: null,
    priceCents: metadata.priceCents,
    publisher: metadata.publisher,
  };
}

export function parseAuthorInput(body: unknown): Validation<AuthorInput> {
  if (typeof body !== 'object' || body === null)
    return { error: 'Expected a JSON object.', ok: false };

  const raw = body as Record<string, unknown>;
  const discordHandle = text(raw.discordHandle, 'The Discord handle', MAX_HANDLE, false);
  const discordId = text(raw.discordId, 'The Discord id', 30, false);
  const publisher = text(raw.publisher, 'The publisher', MAX_NAME, false);
  // Loose on purpose: a pasted address is long, and the pattern below is what
  // actually decides, so this cap only ever fires on absurd input.
  const publisherId = text(raw.publisherId, 'The publisher id', MAX_NAME, false);

  if (!discordHandle.ok)
    return discordHandle;
  if (!discordId.ok)
    return discordId;
  if (!publisher.ok)
    return publisher;
  if (!publisherId.ok)
    return publisherId;

  if (discordId.value !== null && !DISCORD_ID.test(discordId.value))
    return { error: 'The Discord id is the 17 to 20 digit number Discord shows; the handle is the name beside it.', ok: false };

  // A url or a name here would build a store link that goes nowhere.
  if (publisherId.value !== null && !PUBLISHER_ID.test(publisherId.value))
    return { error: 'The publisher id is the number in the store address, like 45737.', ok: false };

  if (discordHandle.value === null && discordId.value === null && publisher.value === null)
    return { error: 'An author needs a store publisher, a Discord handle or a Discord id.', ok: false };

  return {
    ok: true,
    value: {
      discordHandle: discordHandle.value,
      discordId: discordId.value,
      publisher: publisher.value,
      publisherId: publisherId.value,
    },
  };
}

/** Accepts either a list or a blob of pasted keys, one per line or comma. */
export function parseKeyValues(body: unknown): Validation<string[]> {
  if (typeof body !== 'object' || body === null)
    return { error: 'Expected a JSON object.', ok: false };

  const raw = (body as { keys?: unknown }).keys;
  const candidates = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,]/) : null;
  if (candidates === null)
    return { error: 'Expected a list of keys.', ok: false };

  const values = candidates
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value !== '');

  if (values.length === 0)
    return { error: 'Paste at least one key.', ok: false };

  if (values.some(value => value.length > MAX_KEY))
    return { error: `A key must be ${MAX_KEY} characters or fewer.`, ok: false };

  return { ok: true, value: [...new Set(values)] };
}

/** Accepts a list of links, or a blob pasted from anywhere, one per line. */
export function parseUrls(body: unknown): Validation<string[]> {
  if (typeof body !== 'object' || body === null)
    return { error: 'Expected a JSON object.', ok: false };

  const raw = (body as { urls?: unknown }).urls;
  const candidates = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : null;
  if (candidates === null)
    return { error: 'Expected a list of links.', ok: false };

  const values = candidates
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value !== '');

  const unique = [...new Set(values)];
  if (unique.length === 0)
    return { error: 'Paste at least one link.', ok: false };

  if (unique.length > MAX_IMPORT_URLS)
    return { error: `Paste at most ${MAX_IMPORT_URLS} links at a time.`, ok: false };

  return { ok: true, value: unique };
}

export function parseId(value: string): number | null {
  if (!/^\d+$/.test(value))
    return null;

  const id = Number(value);
  return id > 0 ? id : null;
}

/** How many keys the winners asked for. Zero means nothing is needed. */
export function parseNeededInput(body: unknown): Validation<{ needed: number }> {
  if (typeof body !== 'object' || body === null)
    return { error: 'Expected a JSON object.', ok: false };

  const raw = (body as { needed?: unknown }).needed;
  const needed = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());

  if (!Number.isInteger(needed) || needed < 0 || needed > MAX_NEEDED)
    return { error: `How many keys are needed must be a whole number between 0 and ${MAX_NEEDED}.`, ok: false };

  return { ok: true, value: { needed } };
}

/** The admin table's Hide/Unhide button: a boolean and nothing else. */
export function parseHiddenInput(body: unknown): Validation<{ hidden: boolean }> {
  if (typeof body !== 'object' || body === null)
    return { error: 'Expected a JSON object.', ok: false };

  const raw = (body as { hidden?: unknown }).hidden;
  if (typeof raw !== 'boolean')
    return { error: 'Hidden must be true or false.', ok: false };

  return { ok: true, value: { hidden: raw } };
}
