/**
 * Byte helpers for the pure-TypeScript battle crypto.
 *
 * Why these exist instead of the platform ones: the LayaNative runtime has
 * **no** `TextEncoder` (measured — see the report) and no `Buffer`, so the
 * browser conveniences are unavailable exactly where the crypto has to run.
 *
 * NOTE: `platform/native/` only.
 */

/** Concatenates byte arrays into a fresh buffer. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * UTF-8 encodes a string.
 *
 * Hand-rolled because the native runtime has no `TextEncoder`. Mirrors the
 * encoding used by `core/math/hash64.ts` so byte-for-byte comparisons against
 * the C++ server's `std::string` payloads hold.
 */
export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * ASCII-encodes a string, masking each code unit to 7 bits.
 *
 * Matches `web_crypto_cipher.ts`'s `encodeAscii` so the HKDF `info` label is
 * byte-identical on both platforms.
 */
export function asciiBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0x7f;
  }
  return out;
}

/** Lowercase hex encoding. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] >>> 4).toString(16) + (bytes[i] & 0x0f).toString(16);
  }
  return out;
}

/** Parses a lowercase/uppercase hex string into bytes. */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Little-endian 64-bit encoding of a `bigint`. */
export function u64LeBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Little-endian 16-bit encoding. */
export function u16LeBytes(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}
