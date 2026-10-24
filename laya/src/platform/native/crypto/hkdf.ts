/**
 * HKDF-SHA256 (RFC 5869) in pure TypeScript.
 *
 * The web build gets HKDF from `crypto.subtle.deriveBits({name:'HKDF'})`; the
 * LayaNative runtime has no working `crypto.subtle` (measured), so this is the
 * portable equivalent.
 *
 * NOTE: `platform/native/` only.
 */

import { concatBytes } from './bytes';
import { hmacSha256 } from './sha256';

const HASH_LENGTH = 32;

/**
 * HKDF-Extract then HKDF-Expand.
 *
 * @param ikm  input keying material
 * @param salt optional salt (empty means a zero-filled block of hash length)
 * @param info optional context/application-specific info
 * @param length number of output bytes
 */
export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  if (length < 0) {
    throw new Error('hkdfSha256: length must not be negative');
  }
  // RFC 5869 §2.2: if no salt is provided, use a string of HashLen zeros.
  const effectiveSalt = salt.length === 0 ? new Uint8Array(HASH_LENGTH) : salt;

  // Extract.
  const prk = hmacSha256(effectiveSalt, ikm);

  // Expand.
  const blocks: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(0);
  let produced = 0;
  let counter = 1;
  while (produced < length) {
    const input = concatBytes(previous, info, Uint8Array.of(counter));
    const block = hmacSha256(prk, input);
    blocks.push(block);
    previous = block;
    produced += HASH_LENGTH;
    counter += 1;
    if (counter > 255) {
      throw new Error('hkdfSha256: requested length exceeds the RFC 5869 limit');
    }
  }
  return concatBytes(...blocks).slice(0, length);
}
