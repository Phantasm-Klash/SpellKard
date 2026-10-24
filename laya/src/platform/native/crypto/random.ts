/**
 * Randomness for the native battle crypto.
 *
 * Measured on the shipped LayaNative Windows runtime (see
 * `tmp/fix-aead/report.md`):
 *
 *   - `crypto.getRandomValues`  → throws the **string** `'not implemented'`
 *   - `crypto.subtle.digest`     → only `'SHA-1'` is implemented
 *   - `crypto.subtle.*` otherwise → throws `'not implemented'`
 *
 * So the native runtime exposes **no** OS CSPRNG to JavaScript. This module
 * therefore has three tiers, best first:
 *
 *  1. `crypto.getRandomValues` — the engine's own, used whenever it works (the
 *     browser build, and any future LayaNative that implements it). Nothing to
 *     install.
 *  2. `spk_crypto.randomBytes()` — the bundled native extension, which calls
 *     the **operating system's** generator directly: Windows CNG
 *     `BCryptGenRandom`, and `getrandom(2)` on Linux / Android / OHOS. This is
 *     the official platform API, and it is what the native build actually uses.
 *  3. A ChaCha20-based DRBG seeded from the best entropy the runtime does
 *     expose — the last resort when neither of the above is available.
 *
 * ## Honest limitation of tier 3
 *
 * The tier-3 seed is gathered from `Math.random()`, `performance.now()` and
 * `Date.now()`. V8 seeds its internal PRNG from the OS CSPRNG at isolate
 * creation, but `Math.random()`'s xorshift128+ state is recoverable from a
 * handful of outputs, so tier-3 keys are **weaker** than tier-1/tier-2 keys.
 * `randomSource()` reports which tier is in use so the app can surface it.
 *
 * NOTE: `platform/native/` only.
 */

import { chacha20 } from './chacha20_poly1305';
import { sha256 } from './sha256';

/** Which randomness tier is actually in use. */
export type RandomSourceKind = 'webcrypto' | 'native-extension' | 'native-drbg';

/** The minimal shape of the global `crypto` this module probes. */
interface CryptoLike {
  getRandomValues?<T extends ArrayBufferView>(array: T): T;
}

/** The minimal shape of the `spk_crypto` LayaNative extension. */
interface NativeCryptoLike {
  randomBytes?(length: number): Uint8Array | null;
  source?(): string;
}

function probeCrypto(): CryptoLike | null {
  const scope = globalThis as unknown as { crypto?: CryptoLike };
  const candidate = scope.crypto;
  if (candidate === undefined || candidate === null) {
    return null;
  }
  return typeof candidate.getRandomValues === 'function' ? candidate : null;
}

function probeExtension(): NativeCryptoLike | null {
  const scope = globalThis as unknown as { spk_crypto?: NativeCryptoLike };
  const candidate = scope.spk_crypto;
  if (candidate === undefined || candidate === null) {
    return null;
  }
  return typeof candidate.randomBytes === 'function' ? candidate : null;
}

/** True when `crypto.getRandomValues` exists *and* actually works. */
export function hasWorkingWebCryptoRandom(): boolean {
  const candidate = probeCrypto();
  if (candidate === null) {
    return false;
  }
  try {
    candidate.getRandomValues!(new Uint8Array(8));
    return true;
  } catch {
    // The LayaNative shim throws the string 'not implemented'.
    return false;
  }
}

/** True when the `spk_crypto` extension is loaded and returns usable bytes. */
export function hasWorkingNativeCryptoExtension(): boolean {
  const candidate = probeExtension();
  if (candidate === null) {
    return false;
  }
  try {
    const bytes = candidate.randomBytes!(16);
    return bytes instanceof Uint8Array && bytes.length === 16;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tier 2: ChaCha20-based DRBG
// ---------------------------------------------------------------------------

const DRBG_SEED_LABEL = 'phk-native-drbg-v1';

let drbgKey: Uint8Array | null = null;
let drbgBlockIndex = 0;
let drbgNonce: Uint8Array | null = null;

function readEntropyU32(): number {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * Gathers the best entropy the native runtime exposes.
 *
 * `Math.random()` contributes the most (V8 draws it from an OS-seeded PRNG),
 * `performance.now()` adds sub-microsecond timing jitter, and `Date.now()`
 * adds a coarse wall-clock component.
 */
function gatherEntropy(): Uint8Array {
  const pool = new Uint8Array(128);
  let offset = 0;
  for (let i = 0; i < 24; i += 1) {
    const value = readEntropyU32();
    pool[offset] = value & 0xff;
    pool[offset + 1] = (value >>> 8) & 0xff;
    pool[offset + 2] = (value >>> 16) & 0xff;
    pool[offset + 3] = (value >>> 24) & 0xff;
    offset += 4;
  }

  const scope = globalThis as unknown as {
    performance?: { now(): number };
    Date?: { now(): number };
  };
  for (let i = 0; i < 8; i += 1) {
    const timing =
      typeof scope.performance?.now === 'function' ? scope.performance.now() : Math.random() * 1e9;
    const bits = Math.floor(Math.abs(timing) * 1000) % 0x100000000;
    pool[offset] = bits & 0xff;
    pool[offset + 1] = (bits >>> 8) & 0xff;
    pool[offset + 2] = (bits >>> 16) & 0xff;
    pool[offset + 3] = (bits >>> 24) & 0xff;
    offset += 4;
  }

  const wall = typeof scope.Date?.now === 'function' ? scope.Date.now() : 0;
  pool[offset] = wall & 0xff;
  pool[offset + 1] = (wall >>> 8) & 0xff;
  pool[offset + 2] = (wall >>> 16) & 0xff;
  pool[offset + 3] = (wall >>> 24) & 0xff;
  return pool;
}

function ensureDrbg(): void {
  if (drbgKey !== null) {
    return;
  }
  const pool = gatherEntropy();
  const label = new Uint8Array(DRBG_SEED_LABEL.length);
  for (let i = 0; i < label.length; i += 1) {
    label[i] = DRBG_SEED_LABEL.charCodeAt(i) & 0xff;
  }
  const material = new Uint8Array(pool.length + label.length);
  material.set(pool, 0);
  material.set(label, pool.length);
  drbgKey = sha256(material);
  const nonceMaterial = sha256(material);
  drbgNonce = nonceMaterial.slice(0, 12);
  drbgBlockIndex = 0;
}

/**
 * Fills `out` with DRBG output.
 *
 * The ChaCha20 stream is keyed by the DRBG key and uses a fixed 96-bit nonce;
 * uniqueness comes from the monotonically increasing 32-bit block counter.
 */
function fillFromDrbg(out: Uint8Array): void {
  ensureDrbg();
  const key = drbgKey!;
  const nonce = drbgNonce!;
  let offset = 0;
  while (offset < out.length) {
    const block = new Uint8Array(64);
    chacha20(key, drbgBlockIndex, nonce, block);
    drbgBlockIndex = (drbgBlockIndex + 1) >>> 0;
    const chunk = Math.min(64, out.length - offset);
    out.set(block.subarray(0, chunk), offset);
    offset += chunk;
  }
}

/**
 * Fills `out` with random bytes.
 *
 * @throws when `out` is empty-agnostic but has a non-integer length
 */
export function nativeRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new Error('nativeRandomBytes: length must be a non-negative integer');
  }
  const out = new Uint8Array(length);
  if (length === 0) {
    return out;
  }

  // Tier 1: the engine's own generator, when it works.
  const candidate = probeCrypto();
  if (candidate !== null) {
    try {
      candidate.getRandomValues!(out);
      return out;
    } catch {
      // Fall through — the LayaNative shim throws here.
    }
  }

  // Tier 2: the bundled extension, which calls the OS generator directly.
  const extension = probeExtension();
  if (extension !== null) {
    try {
      const bytes = extension.randomBytes!(length);
      // The extension returns `null` when its platform call failed, so a
      // short or missing result must not be mistaken for randomness.
      if (bytes instanceof Uint8Array && bytes.length === length) {
        out.set(bytes, 0);
        return out;
      }
    } catch {
      // Fall through to the DRBG.
    }
  }

  // Tier 3: last resort.
  fillFromDrbg(out);
  return out;
}

/**
 * Which randomness tier is in use, best first:
 *
 *  - `'webcrypto'`        — the runtime's `crypto.getRandomValues` works
 *  - `'native-extension'` — the `spk_crypto` extension is calling the OS
 *                           generator (Windows CNG / `getrandom`)
 *  - `'native-drbg'`      — the in-process ChaCha20 DRBG, i.e. neither of the
 *                           above is available
 */
export function randomSource(): RandomSourceKind {
  if (hasWorkingWebCryptoRandom()) {
    return 'webcrypto';
  }
  if (hasWorkingNativeCryptoExtension()) {
    return 'native-extension';
  }
  return 'native-drbg';
}

/**
 * Which platform API the extension is calling, for diagnostics.
 *
 * Returns `null` when the extension is not loaded, and the extension's own
 * string (e.g. `windows-cng-bcryptgenrandom`) when it is — so a support report
 * can say exactly what the client was using.
 */
export function nativeCryptoSourceLabel(): string | null {
  const extension = probeExtension();
  if (extension === null || typeof extension.source !== 'function') {
    return null;
  }
  try {
    const label = extension.source();
    return typeof label === 'string' ? label : null;
  } catch {
    return null;
  }
}
