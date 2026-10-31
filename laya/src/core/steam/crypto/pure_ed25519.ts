// Pure-TypeScript Ed25519 **verification** (RFC 8032), BigInt math.
//
// The LayaAir native runtime does not implement WebCrypto Ed25519
// (measured: `crypto.subtle` only has SHA-1), and the client never signs
// (the personal private key stays on Nakama), so verification is the only
// operation the client crypto needs — and it must work everywhere the game
// runs. Signing is available via NodeCryptoProvider (tooling) and
// WebCryptoProvider (runtimes that support it).

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const M64 = (1n << 64n) - 1n;

function mod(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r < 0n ? r + m : r;
}

function pow(b: bigint, e: bigint, m: bigint): bigint {
  let result = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function inv(x: bigint): bigint {
  return pow(x, P - 2n, P);
}

// d = -121665 / 121666 mod p (1/121666 computed at module load, not a
// memorized constant)
const D = mod(-121665n * inv(121666n), P);

/** Base point B (encoded, RFC 8032 §5.1.5). */
const BASE_POINT_ENC = new Uint8Array([
  0x58, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
  0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
]);

// Point in extended coordinates (X, Y, Z, T): x = X/Z, y = Y/Z, T = XY/Z.
type Pt = { x: bigint; y: bigint; z: bigint; t: bigint };

const ZERO_PT: Pt = { x: 0n, y: 1n, z: 1n, t: 0n };

function ptAdd(p: Pt, q: Pt): Pt {
  // Standard extended-coordinates addition (RFC 8032 reference formulae).
  const a = mod((p.y - p.x) * (q.y - q.x), P);
  const b = mod((p.y + p.x) * (q.y + q.x), P);
  const c = mod(2n * p.t * q.t * D, P);
  const dd = mod(2n * p.z * q.z, P);
  const e = mod(b - a, P);
  const f = mod(dd - c, P);
  const g = mod(dd + c, P);
  const h = mod(b + a, P);
  return { x: mod(e * f, P), y: mod(g * h, P), z: mod(f * g, P), t: mod(e * h, P) };
}

function ptMul(p: Pt, e: bigint): Pt {
  let r = ZERO_PT;
  let add = p;
  while (e > 0n) {
    if (e & 1n) r = ptAdd(r, add);
    add = ptAdd(add, add);
    e >>= 1n;
  }
  return r;
}

function leBytesToBigInt(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
}

function recoverX(y: bigint, sign: number): bigint | null {
  const y2 = mod(y * y, P);
  // x^2 = (y^2 - 1) / (d*y^2 + 1)   (twisted Edwards curve)
  const xx = mod((y2 - 1n) * inv(mod(D * y2 + 1n, P)), P);
  if (xx === 0n) return sign === 0 ? 0n : null;
  let x = pow(xx, (P + 3n) / 8n, P);
  if (mod(x * x, P) !== xx) {
    x = mod(x * pow(2n, (P - 1n) / 4n, P), P);
    if (mod(x * x, P) !== xx) return null;
  }
  if ((x & 1n) !== BigInt(sign)) x = P - x;
  return x;
}

function decodePoint(bytes: Uint8Array): Pt | null {
  if (bytes.length !== 32) return null;
  // The top bit of the final byte is the x-parity sign bit, not part of y.
  const y = leBytesToBigInt(bytes) & ((1n << 255n) - 1n);
  if (y >= P) return null;
  const x = recoverX(y, Number(bytes[31] >> 7));
  if (x === null) return null;
  return { x, y, z: 1n, t: mod(x * y, P) };
}

function pointEq(a: Pt, b: Pt): boolean {
  return (
    mod(a.x * b.z, P) === mod(b.x * a.z, P) && mod(a.y * b.z, P) === mod(b.y * a.z, P)
  );
}

function rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & M64;
}

/** Full SHA-512 digest (64 bytes, standard big-endian output order). */
function sha512(msg: Uint8Array): Uint8Array {
  const hs = sha512Hash(msg);
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    let v = hs[i];
    for (let j = 0; j < 8; j++) {
      out[i * 8 + j] = Number((v >> BigInt(8 * (7 - j))) & 0xffn);
    }
  }
  return out;
}

function sha512Hash(msg: Uint8Array): bigint[] {
  const K: bigint[] = [
    0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
    0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
    0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
    0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
    0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
    0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
    0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
    0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
    0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
    0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
    0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
    0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
    0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
    0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
    0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
    0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
    0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
    0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
    0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
    0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
  ];
  const bitLen = BigInt(msg.length * 8);
  const total = ((msg.length + 16) >> 7) + 1;
  const len = total << 7;
  const m = new Uint8Array(len);
  m.set(msg, 0);
  m[msg.length] = 0x80;
  for (let i = 0; i < 8; i++) {
    m[len - 8 + i] = Number((bitLen >> BigInt(8 * (7 - i))) & 0xffn);
  }

  let h0 = 0x6a09e667f3bcc908n;
  let h1 = 0xbb67ae8584caa73bn;
  let h2 = 0x3c6ef372fe94f82bn;
  let h3 = 0xa54ff53a5f1d36f1n;
  let h4 = 0x510e527fade682d1n;
  let h5 = 0x9b05688c2b3e6c1fn;
  let h6 = 0x1f83d9abfb41bd6bn;
  let h7 = 0x5be0cd19137e2179n;

  const w: bigint[] = new Array(80);
  for (let off = 0; off < len; off += 128) {
    for (let t = 0; t < 16; t++) {
      let v = 0n;
      for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(m[off + t * 8 + j]);
      w[t] = v;
    }
    for (let t = 16; t < 80; t++) {
      const s0 = (rotr64(w[t - 15], 1n) ^ rotr64(w[t - 15], 8n) ^ (w[t - 15] >> 7n)) & M64;
      const s1 = (rotr64(w[t - 2], 19n) ^ rotr64(w[t - 2], 61n) ^ (w[t - 2] >> 6n)) & M64;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & M64;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 80; t++) {
      const S1 = (rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n)) & M64;
      const ch = (e & f) ^ (~e & M64 & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) & M64;
      const S0 = (rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n)) & M64;
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & M64;
      h = g;
      g = f;
      f = e;
      e = (d + t1) & M64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & M64;
    }
    h0 = (h0 + a) & M64;
    h1 = (h1 + b) & M64;
    h2 = (h2 + c) & M64;
    h3 = (h3 + d) & M64;
    h4 = (h4 + e) & M64;
    h5 = (h5 + f) & M64;
    h6 = (h6 + g) & M64;
    h7 = (h7 + h) & M64;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7];
}

function hexBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify an Ed25519 signature (RFC 8032 §5.1.7 / Appendix A reference:
 * check [S]B = R + [k]A, with k = H(R||A||M) mod L).
 * @param publicKeyHex 64-hex public key
 * @param message message bytes
 * @param signatureHex 128-hex signature (R || S)
 */
export function ed25519Verify(
  publicKeyHex: string,
  message: Uint8Array,
  signatureHex: string,
): boolean {
  try {
    if (publicKeyHex.length !== 64 || signatureHex.length !== 128) return false;
    const A = decodePoint(hexBytes(publicKeyHex));
    if (A === null) return false;
    const sigR = hexBytes(signatureHex.slice(0, 64));
    const S = leBytesToBigInt(hexBytes(signatureHex.slice(64)));
    if (S >= L) return false;
    const R = decodePoint(sigR);
    if (R === null) return false;
    // k = H(R||A||M) mod L, with the full 512-bit hash interpreted
    // little-endian (RFC 8032 §3.4 / reference implementation).
    const k = mod(leBytesToBigInt(sha512(concatBytes(sigR, hexBytes(publicKeyHex), message))), L);
    // [S]B = R + [k]A
    const lhs = ptMul(decodePoint(BASE_POINT_ENC) as Pt, S);
    const rhs = ptAdd(R, ptMul(A, k));
    return pointEq(lhs, rhs);
  } catch {
    return false;
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length);
  out.set(a, 0);
  out.set(b, a.length);
  out.set(c, a.length + b.length);
  return out;
}
