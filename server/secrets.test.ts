// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, fingerprintSecret, isEncrypted, SecretError } from './secrets.ts';

const SECRET = 'a-long-enough-key-encryption-secret';
const OTHER = 'a-completely-different-secret';

describe('encryptSecret', () => {
  it('gives back the original value', () => {
    const stored = encryptSecret('ABCD-1234-EFGH', SECRET);

    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain('ABCD-1234-EFGH');
    expect(decryptSecret(stored, SECRET)).toBe('ABCD-1234-EFGH');
  });

  it('writes a different value every time, so equal keys are not visible as equal', () => {
    const first = encryptSecret('SAME-KEY', SECRET);
    const second = encryptSecret('SAME-KEY', SECRET);

    expect(first).not.toBe(second);
    expect(decryptSecret(first, SECRET)).toBe(decryptSecret(second, SECRET));
  });

  it('keeps unicode intact', () => {
    const stored = encryptSecret('clé-😀-ünïcode', SECRET);

    expect(decryptSecret(stored, SECRET)).toBe('clé-😀-ünïcode');
  });

  it('refuses a value that was tampered with', () => {
    const stored = encryptSecret('ABCD-1234-EFGH', SECRET);
    const flipped = `${stored.slice(0, -4)}AAAA`;

    expect(() => decryptSecret(flipped, SECRET)).toThrow(SecretError);
  });

  it('refuses a value written with another secret', () => {
    expect(() => decryptSecret(encryptSecret('ABCD-1234-EFGH', OTHER), SECRET)).toThrow(/cannot be read/i);
  });

  it('does not mistake clear text that merely starts with the prefix', () => {
    // A real key can begin with `v1:`: it must stay clear text, not be treated as
    // ciphertext that failed to open.
    expect(isEncrypted('v1:not-base64-at-all!!')).toBe(false);
    expect(decryptSecret('v1:not-base64-at-all!!', SECRET)).toBe('v1:not-base64-at-all!!');

    // Too short to hold an iv and an auth tag.
    expect(isEncrypted('v1:AAAA')).toBe(false);
    expect(decryptSecret('v1:AAAA', SECRET)).toBe('v1:AAAA');
  });

  it('passes a legacy plain value straight through', () => {
    expect(isEncrypted('ABCD-1234-EFGH')).toBe(false);
    expect(decryptSecret('ABCD-1234-EFGH', SECRET)).toBe('ABCD-1234-EFGH');
  });
});

describe('fingerprintSecret', () => {
  it('is stable for the same key, and different for another key', () => {
    expect(fingerprintSecret('SAME-KEY', SECRET)).toBe(fingerprintSecret('SAME-KEY', SECRET));
    expect(fingerprintSecret('SAME-KEY', SECRET)).not.toBe(fingerprintSecret('other-key', SECRET));
  });

  it('does not contain the key it fingerprints', () => {
    expect(fingerprintSecret('ABCD-1234-EFGH', SECRET)).not.toContain('ABCD');
  });

  it('changes with the secret, so fingerprints stay inside one deployment', () => {
    expect(fingerprintSecret('SAME-KEY', SECRET)).not.toBe(fingerprintSecret('SAME-KEY', OTHER));
  });
});
