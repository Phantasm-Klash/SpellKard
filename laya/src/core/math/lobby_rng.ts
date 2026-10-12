/**
 * The **lobby's** deterministic RNG.
 *
 * ★ Two functions named `deterministicUnit` exist upstream and they are NOT
 * interchangeable — same name, same argument shape, completely different
 * algorithm:
 *
 *  - **Lobby (this module).** `Gensoulkyo/runtime/core/simulation.go`
 *    `deterministicUnit(seed int64, tick int, patternID string, index int)`:
 *    SHA-256 the material `"<seed>:<tick>:<patternID>:<index>"`, take the first
 *    four bytes as eight lowercase hex chars (`shortHash`), fold that hex string
 *    base-16 into an integer, then return `(value % 10000) / 10000`. Used by the
 *    lobby's card effects (`applyBulletPurgeLocked`) and its synthetic danmaku.
 *  - **Battle server.** `core/math/deterministic.ts` `deterministicUnit` (the
 *    Godot `fnv1a32` + `mix32` mixer ported from `PhK-BattleServer`). Used by the
 *    ported danmaku / boss-race simulation. Do **not** swap the two: feeding the
 *    same tuple into the wrong one yields a different `unit` for essentially
 *    every input, so any pick (e.g. a bullet purge set) silently diverges.
 *
 * The lobby's seed is a signed `int64` printed with `%d`, which does not fit a
 * JS `number`, so the seed is carried as decimal text — see
 * `core/math/boss_race_seed.ts` (`bossRaceSeedFromHex(hex).decimal`).
 */

/** FIPS 180-4 SHA-256 round constants. */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Rotate a 32-bit word right by `n` bits. */
function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * Pure, synchronous SHA-256 over the UTF-8 bytes of `text`, returning 32 bytes.
 *
 * Hand-rolled (no DOM `crypto.subtle`, which is async and absent on LayaNative)
 * in the same spirit as `core/math/hash64.ts`; the core layer must stay
 * dependency-free and synchronous.
 */
export function sha256Bytes(text: string): number[] {
  const bytes = utf8Bytes(text);
  const length = bytes.length;
  const padded = bytes.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) {
    padded.push(0);
  }
  // 64-bit big-endian bit length; the message is tiny but keep it correct.
  const bitLengthHi = Math.floor(length / 0x20000000);
  const bitLengthLo = (length * 8) >>> 0;
  padded.push(
    (bitLengthHi >>> 24) & 0xff,
    (bitLengthHi >>> 16) & 0xff,
    (bitLengthHi >>> 8) & 0xff,
    bitLengthHi & 0xff,
    (bitLengthLo >>> 24) & 0xff,
    (bitLengthLo >>> 16) & 0xff,
    (bitLengthLo >>> 8) & 0xff,
    bitLengthLo & 0xff,
  );

  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const schedule = new Array<number>(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const at = offset + i * 4;
      schedule[i] =
        ((padded[at] << 24) | (padded[at + 1] << 16) | (padded[at + 2] << 8) | padded[at + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const x = schedule[i - 15];
      const y = schedule[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let i = 0; i < 64; i += 1) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + bigS1 + choose + SHA256_K[i] + schedule[i]) >>> 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const out: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    out.push((state[i] >>> 24) & 0xff, (state[i] >>> 16) & 0xff, (state[i] >>> 8) & 0xff, state[i] & 0xff);
  }
  return out;
}

const HEX_DIGITS = '0123456789abcdef';

/**
 * `shortHash` from `Gensoulkyo/runtime/core/service.go`: the first four SHA-256
 * bytes as eight lowercase hex characters.
 */
export function shortHashHex(value: string): string {
  const sum = sha256Bytes(value);
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    out += HEX_DIGITS[(sum[i] >>> 4) & 0xf] + HEX_DIGITS[sum[i] & 0xf];
  }
  return out;
}

/** `hexValue` from `simulation.go`: one hex digit's value, else 0. */
function hexValue(charCode: number): number {
  if (charCode >= 0x30 && charCode <= 0x39) {
    return charCode - 0x30;
  }
  if (charCode >= 0x61 && charCode <= 0x66) {
    return charCode - 0x61 + 10;
  }
  if (charCode >= 0x41 && charCode <= 0x46) {
    return charCode - 0x41 + 10;
  }
  return 0;
}

/**
 * `Gensoulkyo/runtime/core/simulation.go` `deterministicUnit`, reproduced
 * exactly.
 *
 * `seedDecimal` is the server's signed `int64` seed as plain decimal text
 * (`fmt.Sprintf("%d", seed)`); use `bossRaceSeedFromHex(hex).decimal` to build
 * it from the lobby's `server_seed_hex`. `tick`, `index` and the folded `value`
 * all stay well inside exact `number` range (the folded value maxes at
 * `0xffffffff`), so no BigInt is needed.
 *
 * @returns a unit value in `[0, 1)` with a granularity of `1e-4`.
 */
export function lobbyDeterministicUnit(
  seedDecimal: string,
  tick: number,
  streamId: string,
  index: number,
): number {
  const hash = shortHashHex(`${seedDecimal}:${Math.trunc(tick)}:${streamId}:${Math.trunc(index)}`);
  let value = 0;
  for (let i = 0; i < hash.length; i += 1) {
    value = value * 16 + hexValue(hash.charCodeAt(i));
  }
  return (value % 10000) / 10000;
}

/** UTF-8 encoding without DOM/Node globals (kept local, same as `hash64.ts`). */
function utf8Bytes(text: string): number[] {
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
  return out;
}
