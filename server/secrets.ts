import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';

/**
 * Key values are secrets: they are worth money, and a copy of the database
 * should not hand them out. They are stored as AES-256-GCM ciphertext, with a
 * stable fingerprint beside them so the same key pasted twice is still noticed
 * (random initialisation means the same key encrypts to a different value every
 * time, so the ciphertext cannot be compared).
 *
 * A stored value looks like `v1:<base64 of iv, auth tag and ciphertext>`. That
 * shape is what marks a value as encrypted: anything else — including a clear
 * value that happens to start with `v1:` — is treated as legacy plain text.
 */

const PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const KDF_SALT = 'udc-jam-prizes/keys';

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

const derivedKeys = new Map<string, Buffer>();

/** A 32-byte key from the configured secret; the secret itself must be random. */
function deriveKey(secret: string): Buffer {
  const cached = derivedKeys.get(secret);
  if (cached)
    return cached;

  // scrypt is deliberately slow, so the result is kept: a paste of twenty keys
  // would otherwise pay for it forty times.
  const key = scryptSync(secret, KDF_SALT, KEY_BYTES);
  derivedKeys.set(secret, key);

  return key;
}

/**
 * The iv, auth tag and ciphertext of a value this module wrote, or null for
 * anything else. The round trip through base64 matters: a key whose own text
 * starts with `v1:` decodes to something that does not encode back, and would
 * otherwise be "decrypted" into nonsense instead of being encrypted.
 */
function payloadOf(value: string): Buffer | null {
  if (!value.startsWith(PREFIX))
    return null;

  const encoded = value.slice(PREFIX.length);
  const raw = Buffer.from(encoded, 'base64');
  if (raw.length <= IV_BYTES + TAG_BYTES || raw.toString('base64') !== encoded)
    return null;

  return raw;
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return `${PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
}

/** False for a legacy value in clear text, and for anything that only looks like ours. */
export function isEncrypted(value: string): boolean {
  return payloadOf(value) !== null;
}

/**
 * Opens a stored value; a value that is not in our format comes back untouched.
 * One that is, but was tampered with or written with another secret, fails the
 * authentication check instead of coming back as garbage, which is the point of
 * GCM.
 */
export function decryptSecret(stored: string, secret: string): string {
  const raw = payloadOf(stored);
  if (raw === null)
    return stored;

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));

  try {
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  }
  catch {
    throw new SecretError('That key cannot be read with the current KEY_ENCRYPTION_SECRET.');
  }
}

/** Stable and one-way: identical keys give identical fingerprints, nothing else does. */
export function fingerprintSecret(plaintext: string, secret: string): string {
  return createHmac('sha256', deriveKey(secret)).update(plaintext).digest('hex');
}
