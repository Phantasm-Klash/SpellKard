/**
 * ChaCha20-Poly1305 AEAD (RFC 8439) in pure TypeScript.
 *
 * This is the same suite the web build uses (`crypto.subtle` with
 * `ChaCha20-Poly1305`, 16-byte tag) and the same one the C++ battle server
 * advertises in `BattleHandshakeHello.supported_aead`, so a native client and
 * a browser client interoperate byte-for-byte.
 *
 * ChaCha20 uses 32-bit words; Poly1305 uses BigInt so the 130-bit accumulator
 * arithmetic is exact rather than a hand-rolled limb carry chain.
 *
 * NOTE: `platform/native/` only.
 */

const SIGMA = new Uint32Array([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
  );
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = rotl(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotl(s[b] ^ s[c], 7);
}

/** RFC 8439 §2.3 — the ChaCha20 block function. */
function chacha20Block(
  key: Uint8Array,
  counter: number,
  nonce: Uint8Array,
  out: Uint8Array,
  outOffset: number,
): void {
  const state = new Uint32Array(16);
  state.set(SIGMA, 0);
  for (let i = 0; i < 8; i += 1) {
    state[4 + i] = readU32LE(key, i * 4);
  }
  state[12] = counter >>> 0;
  for (let i = 0; i < 3; i += 1) {
    state[13 + i] = readU32LE(nonce, i * 4);
  }

  const working = new Uint32Array(state);
  for (let round = 0; round < 10; round += 1) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  for (let i = 0; i < 16; i += 1) {
    writeU32LE(out, outOffset + i * 4, (working[i] + state[i]) >>> 0);
  }
}

/** RFC 8439 §2.4.2 — ChaCha20 encryption of `data` starting at `counter`. */
export function chacha20(
  key: Uint8Array,
  counter: number,
  nonce: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(data.length);
  const block = new Uint8Array(64);
  let blockCounter = counter;
  for (let offset = 0; offset < data.length; offset += 64) {
    chacha20Block(key, blockCounter, nonce, block, 0);
    const chunk = Math.min(64, data.length - offset);
    for (let i = 0; i < chunk; i += 1) {
      out[offset + i] = data[offset + i] ^ block[i];
    }
    blockCounter += 1;
  }
  return out;
}

const POLY_P = (1n << 130n) - 5n;
const POLY_R_MASK = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
const POLY_S_MASK = (1n << 128n) - 1n;

function le128(bytes: Uint8Array): bigint {
  let out = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    out = (out << 8n) | BigInt(bytes[i]);
  }
  return out;
}

/**
 * RFC 8439 §2.5 — Poly1305 one-time authenticator.
 *
 * @param key     32-byte one-time key (r || s)
 * @param message bytes to authenticate
 */
export function poly1305(key: Uint8Array, message: Uint8Array): Uint8Array {
  if (key.length !== 32) {
    throw new Error('poly1305: key must be 32 bytes');
  }
  const r = le128(key.subarray(0, 16)) & POLY_R_MASK;
  const s = le128(key.subarray(16, 32));

  let acc = 0n;
  let offset = 0;
  while (offset < message.length) {
    const remaining = message.length - offset;
    const chunk = remaining >= 16 ? 16 : remaining;
    const block = new Uint8Array(16);
    block.set(message.subarray(offset, offset + chunk));
    let n: bigint;
    if (chunk === 16) {
      // A full block contributes the implicit 2^128 bit.
      n = le128(block) + (1n << 128n);
    } else {
      // The final partial block is padded with 0x01 and carries no extra bit.
      block[chunk] = 1;
      n = le128(block);
    }
    acc = ((acc + n) * r) % POLY_P;
    offset += chunk;
  }

  const tag = (acc + s) & POLY_S_MASK;
  const out = new Uint8Array(16);
  let v = tag;
  for (let i = 0; i < 16; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export interface ChaChaPolyResult {
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

/** RFC 8439 §2.8 — zero padding to a 16-byte boundary. */
function pad16(length: number): Uint8Array {
  const remainder = length % 16;
  return remainder === 0 ? new Uint8Array(0) : new Uint8Array(16 - remainder);
}

function u64Le(value: number): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

function concatAll(...parts: Uint8Array[]): Uint8Array {
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
 * RFC 8439 §2.8.1 — AEAD_CHACHA20_POLY1305 encryption.
 *
 * @param key       32-byte key
 * @param nonce     12-byte nonce
 * @param plaintext message to encrypt
 * @param aad       additional authenticated data
 */
export function chacha20Poly1305Seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): ChaChaPolyResult {
  if (key.length !== 32) {
    throw new Error('chacha20Poly1305: key must be 32 bytes');
  }
  if (nonce.length !== 12) {
    throw new Error('chacha20Poly1305: nonce must be 12 bytes');
  }
  // The one-time Poly1305 key is the first 32 bytes of counter-0 output.
  const polyKey = chacha20(key, 0, nonce, new Uint8Array(32));
  const ciphertext = chacha20(key, 1, nonce, plaintext);

  const macInput = concatAll(
    aad,
    pad16(aad.length),
    ciphertext,
    pad16(ciphertext.length),
    u64Le(aad.length),
    u64Le(ciphertext.length),
  );
  const tag = poly1305(polyKey, macInput);
  return { ciphertext, tag };
}

/**
 * RFC 8439 §2.8.2 — AEAD_CHACHA20_POLY1305 decryption.
 *
 * @throws when the tag does not authenticate the ciphertext
 */
export function chacha20Poly1305Open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  tag: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  if (key.length !== 32) {
    throw new Error('chacha20Poly1305: key must be 32 bytes');
  }
  if (nonce.length !== 12) {
    throw new Error('chacha20Poly1305: nonce must be 12 bytes');
  }
  if (tag.length !== 16) {
    throw new Error('chacha20Poly1305: tag must be 16 bytes');
  }
  const polyKey = chacha20(key, 0, nonce, new Uint8Array(32));
  const macInput = concatAll(
    aad,
    pad16(aad.length),
    ciphertext,
    pad16(ciphertext.length),
    u64Le(aad.length),
    u64Le(ciphertext.length),
  );
  const expected = poly1305(polyKey, macInput);
  if (!constantTimeEqual(expected, tag)) {
    throw new Error('chacha20Poly1305: authentication tag mismatch');
  }
  return chacha20(key, 1, nonce, ciphertext);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
