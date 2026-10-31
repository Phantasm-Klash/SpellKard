// Small binary/hex helpers shared across the Steam integration module.
// NOTE: this file must stay lib-ES2020-only (the client core layer has no
// DOM types) — UTF-8 goes through ./utf8.

export { utf8Decode, utf8Encode } from './utf8';

const HEX_RE = /^[0-9a-f]+$/i;

export function isHex(value: string, length?: number): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (length !== undefined && value.length !== length) return false;
  return HEX_RE.test(value) && value.length % 2 === 0;
}

export function hexToBytes(hex: string): Uint8Array {
  if (!isHex(hex)) throw new Error(`invalid hex string: ${hex}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

/** Deterministic canonical JSON: object keys sorted, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = sortValue(src[key]);
    }
    return out;
  }
  return value;
}
