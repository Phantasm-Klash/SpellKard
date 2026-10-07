/**
 * 64-bit hashes that must match the C++ battle server byte-for-byte.
 *
 * `Fnv1a64` reproduces `phk::battle::Fnv1a` from
 * `PhK-BattleServer/src/handshake.cpp`. Note the upstream offset basis is
 * `1469598103934665603` (not the canonical `14695981039346656037`); the client
 * must reproduce that exact value or the derived KCP conv will not match.
 *
 * BigInt is used because the multiply is a true 64-bit operation. The core
 * targets ES2020 for this reason; all modern browsers and the LayaAir native
 * JS engines support BigInt.
 */

const FNV64_OFFSET_BASIS = 1469598103934665603n;
const FNV64_PRIME = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;

/** 64-bit FNV-1a over the UTF-8 bytes of `value`. */
export function fnv1a64(value: string): bigint {
  let hash = FNV64_OFFSET_BASIS;
  for (const byte of utf8Bytes(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & MASK_64;
  }
  return hash;
}

/** Lowercase hex, zero-padded to `width` (default 16), matching C++ `Hex64`. */
export function fnv1a64Hex(value: string, width = 16): string {
  return fnv1a64(value).toString(16).padStart(width, '0');
}

/**
 * `DeriveDevKcpConv`: the deterministic KCP conversation id the battle server
 * binds for a player. Reproduced exactly from
 * `PhK-BattleServer/src/handshake.cpp`.
 */
export function deriveDevKcpConv(matchId: string, playerId: string): number {
  const hash = fnv1a64(`${matchId}:${playerId}`);
  return Number(hash & 0xffffffffn) >>> 0;
}

/**
 * `DevTranscriptHash` material: `Hex64(Fnv1a(x)) + Hex64(Fnv1a(x + ":2"))`.
 * Used to verify the handshake transcript when the server is running in dev
 * signing mode.
 */
export function devTranscriptHashMaterial(material: string): string {
  return fnv1a64Hex(material) + fnv1a64Hex(`${material}:2`);
}

/** UTF-8 encoding without DOM/Node globals (kept local to avoid a cycle). */
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
