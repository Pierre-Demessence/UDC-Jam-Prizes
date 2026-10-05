/**
 * The admin allow-list.
 *
 * Defence in depth on top of the password: the admin area can be restricted to
 * addresses you know. It matches the *socket* address, so it cannot be spoofed
 * with a header — but that also means a reverse proxy hides every real visitor
 * behind its own address (see docs/backlog.md).
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** `::ffff:127.0.0.1` → `127.0.0.1`: Node reports IPv4 peers this way on some hosts. */
export function normalizeAddress(address: string | undefined): string | null {
  const trimmed = address?.trim() ?? '';
  if (trimmed === '')
    return null;

  return trimmed.toLowerCase().startsWith('::ffff:') ? trimmed.slice(7).toLowerCase() : trimmed.toLowerCase();
}

export function isLoopback(address: string | null): boolean {
  return address !== null && LOOPBACK.has(address);
}

/** Accepts an IPv4 address, an IPv4 CIDR block, or a literal IPv6 address. */
export function isValidPattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (trimmed === '' || trimmed.includes(' '))
    return false;

  const [base, bits] = trimmed.split('/');

  // ipv4ToNumber also range-checks every octet, so 300.0.0.1 is not an address.
  if (ipv4ToNumber(base) !== null) {
    if (bits === undefined)
      return true;

    const size = Number(bits);
    return /^\d{1,2}$/.test(bits) && size >= 0 && size <= 32;
  }

  // An IPv6 address is matched exactly: no blocks, no prefix lengths.
  if (bits !== undefined)
    return false;

  return trimmed.includes(':') && /^[\da-f:.]+$/i.test(trimmed);
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4)
    return null;

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255)
      return null;

    value = value * 256 + octet;
  }

  return value;
}

/** True when `address` is one of the patterns, or inside one of the blocks. */
export function addressMatches(address: string | null, patterns: readonly string[]): boolean {
  if (address === null)
    return false;

  for (const pattern of patterns) {
    const [base, bits] = pattern.trim().toLowerCase().split('/');

    if (bits === undefined) {
      if (base === address)
        return true;

      continue;
    }

    const network = ipv4ToNumber(base);
    const host = ipv4ToNumber(address);
    if (network === null || host === null)
      continue;

    const size = Number(bits);
    const mask = size === 0 ? 0 : (0xFF_FF_FF_FF << (32 - size)) >>> 0;
    if (((network & mask) >>> 0) === ((host & mask) >>> 0))
      return true;
  }

  return false;
}
