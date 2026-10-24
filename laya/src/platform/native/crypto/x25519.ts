/**
 * X25519 (RFC 7748) in pure TypeScript, using BigInt modular arithmetic.
 *
 * Why not the engine's crypto: the LayaNative runtime's `crypto.subtle` is a
 * stub whose `deriveBits` throws `'not implemented'` (measured on the shipped
 * Windows runtime — see `tmp/fix-aead/report.md`), so the native build has to
 * carry its own X25519.
 *
 * The ladder below is the RFC 7748 §5 reference formulation, so the shared
 * secret it produces is bit-identical to `crypto.subtle.deriveBits({name:
 * 'X25519'})` on the web build and to the C++ server's X25519 once the
 * server's placeholder handshake is replaced by the real one.
 *
 * NOTE: `platform/native/` only.
 */

/** The field prime 2^255 - 19. */
const P = (1n << 255n) - 19n;
/** The Montgomery ladder constant (486662 - 2) / 4. */
const A24 = 121665n;

function mod(value: bigint): bigint {
  const reduced = value % P;
  return reduced < 0n ? reduced + P : reduced;
}

/** Reads a little-endian byte string as a big-endian integer. */
function leToBig(bytes: Uint8Array): bigint {
  let out = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    out = (out << 8n) | BigInt(bytes[i]);
  }
  return out;
}

/** Writes an integer as a 32-byte little-endian string. */
function bigToLe32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Applies the RFC 7748 §5 scalar clamping.
 *
 * `k[0] &= 248`, `k[31] &= 127`, `k[31] |= 64`. The web build's
 * `crypto.subtle.generateKey({name:'X25519'})` clamps internally, so the
 * native side must clamp identically for the public keys to match.
 */
export function clampScalar(scalar: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(scalar.subarray(0, 32));
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

/**
 * RFC 7748 §5 X25519 scalar multiplication.
 *
 * @param scalar 32-byte scalar (clamped internally)
 * @param uCoord  32-byte u-coordinate
 * @returns the 32-byte result
 * @throws when the result is all-zero (RFC 7748 §6.1 requires rejecting it)
 */
export function x25519(scalar: Uint8Array, uCoord: Uint8Array): Uint8Array {
  if (scalar.length !== 32) {
    throw new Error('x25519: scalar must be 32 bytes');
  }
  if (uCoord.length !== 32) {
    throw new Error('x25519: u-coordinate must be 32 bytes');
  }

  const k = leToBig(clampScalar(scalar));
  // RFC 7748: for X25519 the most significant bit of the u-coordinate is
  // masked off before use.
  const uBytes = new Uint8Array(uCoord);
  uBytes[31] &= 127;
  const x1 = leToBig(uBytes);

  let x2 = 1n;
  let z2 = 0n;
  let x3 = x1;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254; t >= 0; t -= 1) {
    const kT = (k >> BigInt(t)) & 1n;
    swap ^= kT;
    if (swap === 1n) {
      let tmp = x2;
      x2 = x3;
      x3 = tmp;
      tmp = z2;
      z2 = z3;
      z3 = tmp;
    }
    swap = kT;

    const a = mod(x2 + z2);
    const aa = mod(a * a);
    const b = mod(x2 - z2);
    const bb = mod(b * b);
    const e = mod(aa - bb);
    const c = mod(x3 + z3);
    const d = mod(x3 - z3);
    const da = mod(d * a);
    const cb = mod(c * b);
    x3 = mod((da + cb) * (da + cb));
    z3 = mod(x1 * mod((da - cb) * (da - cb)));
    x2 = mod(aa * bb);
    z2 = mod(e * mod(aa + A24 * e));
  }

  if (swap === 1n) {
    let tmp = x2;
    x2 = x3;
    x3 = tmp;
    tmp = z2;
    z2 = z3;
    z3 = tmp;
  }

  const inverse = modPow(z2, P - 2n);
  const result = mod(x2 * inverse);

  // RFC 7748 §6.1: an all-zero output means a small-order peer key and must
  // be rejected rather than used.
  if (result === 0n) {
    throw new Error('x25519: shared secret is all zero');
  }
  return bigToLe32(result);
}

/** The X25519 base point u = 9, little-endian. */
export const X25519_BASE_POINT: Uint8Array = (() => {
  const out = new Uint8Array(32);
  out[0] = 9;
  return out;
})();

/** Computes the public key for a private scalar. */
export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519(privateKey, X25519_BASE_POINT);
}

/** Modular exponentiation by square-and-multiply. */
function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n;
  let b = mod(base);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) {
      result = mod(result * b);
    }
    b = mod(b * b);
    e >>= 1n;
  }
  return result;
}
