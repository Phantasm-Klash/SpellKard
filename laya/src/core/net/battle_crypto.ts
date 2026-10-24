/**
 * Battle-channel AEAD abstraction.
 *
 * The protocol negotiates `CHACHA20_POLY1305` / `XCHACHA20_POLY1305` in
 * `BattleHandshakeHello.supported_aead` and the server echoes the selected suite
 * in `BattleHandshakeAccept.selected_aead`. The concrete implementation lives in
 * the platform layer (`src/platform/web/web_crypto_cipher.ts`), because
 * browsers/Node expose it through `crypto.subtle` while LayaAir native builds
 * would use a native binding.
 *
 * `PlaintextCipher` is provided so the whole transport, framing, sequencing and
 * simulation stack can be exercised end-to-end against a dev battle server
 * before the AEAD/key-agreement work lands. It must NOT be used against a
 * production server.
 */

export interface SealedPayload {
  ciphertext: Uint8Array;
  authTag: Uint8Array;
}

export interface BattleCipher {
  /** AEAD suite name reported to the server during the handshake. */
  readonly aead: string;
  seal(plaintext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<SealedPayload>;
  open(ciphertext: Uint8Array, authTag: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<Uint8Array>;
}

/** Identity "cipher" for local/dev servers that do not enforce AEAD yet. */
export class PlaintextCipher implements BattleCipher {
  readonly aead = 'PLAINTEXT_DEV';

  async seal(plaintext: Uint8Array): Promise<SealedPayload> {
    return { ciphertext: plaintext.slice(), authTag: new Uint8Array(0) };
  }

  async open(ciphertext: Uint8Array): Promise<Uint8Array> {
    return ciphertext.slice();
  }
}

/**
 * Key-agreement interface. The battle handshake is X25519 ECDHE + HKDF-SHA256;
 * implementations are platform-specific.
 *
 * Not yet implemented: the client currently performs the handshake with a
 * scaffold key schedule and `PlaintextCipher`, which is sufficient to drive a
 * dev battle server. Wiring real X25519/HKDF is tracked as the remaining
 * crypto task (see `laya/README.md`).
 */
export interface KeyAgreement {
  readonly name: string;
  /** Returns the 32-byte client public key and the raw random nonce. */
  generateClientKeyPair(): Promise<{ publicKey: Uint8Array; random: Uint8Array }>;
  /** Derives the 32-byte session key from the server public key + both randoms. */
  deriveSessionKey(serverPublicKey: Uint8Array, clientRandom: Uint8Array, serverRandom: Uint8Array): Promise<Uint8Array>;
}

export class UnsupportedKeyAgreement implements KeyAgreement {
  readonly name = 'unsupported';

  async generateClientKeyPair(): Promise<{ publicKey: Uint8Array; random: Uint8Array }> {
    throw new Error('X25519 key agreement is not implemented for this platform yet');
  }

  async deriveSessionKey(): Promise<Uint8Array> {
    throw new Error('X25519 key agreement is not implemented for this platform yet');
  }
}

/** Deterministic 32-byte filler used by the dev handshake scaffold. */
export function devFillBytes(seed: string): Uint8Array {
  const out = new Uint8Array(32);
  let state = fnv1a32Local(seed);
  for (let i = 0; i < out.length; i += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = (state >>> ((i % 8) * 8)) & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wire-format helpers that must match the C++ battle server byte-for-byte.
//
// These reproduce `PhK-BattleServer/src/protocol.cpp`'s `DevAeadNonceHex` and
// `src/handshake.cpp`'s `DevHandshakeKeyRef`. The server *enforces* both on
// the encrypted path today (`nonce_mismatch` / `session_key_mismatch`), so a
// client that wants to be accepted has to derive them exactly.
//
// NOTE: the C++ server's handshake is still a **development scaffold** — its
// `server_x25519_pub` is an FNV-derived filler rather than a real X25519
// public key and its "key refs" are labels rather than derived keys. The
// session-key schedule implemented by the platform layers follows the real
// protocol (X25519 + HKDF-SHA256) that both the server's `docs/architecture.md`
// and the web build already target.
// ---------------------------------------------------------------------------

/**
 * The AEAD suite the battle channel negotiates.
 *
 * `PhK-BattleServer/src/handshake.cpp` selects `CHACHA20_POLY1305` whenever the
 * client advertises it and falls back to `XCHACHA20_POLY1305` otherwise.
 */
export const BATTLE_AEAD_CHACHA20_POLY1305 = 'CHACHA20_POLY1305';

/** The AEAD suite the battle channel accepts as a fallback. */
export const BATTLE_AEAD_XCHACHA20_POLY1305 = 'XCHACHA20_POLY1305';

/**
 * The HKDF `info` label for the battle session key.
 *
 * Both platform layers must use the same label or they would derive different
 * session keys from the same handshake.
 */
export const BATTLE_HKDF_INFO = 'phk-battle-v1';

/** Length of the derived session key, in bytes. */
export const BATTLE_SESSION_KEY_BYTES = 32;

/** Length of the AEAD nonce, in bytes (RFC 8439 uses a 96-bit nonce). */
export const BATTLE_AEAD_NONCE_BYTES = 12;

/**
 * Length of the AEAD authentication tag, in bytes.
 *
 * Matches the server's `HasExpectedAeadTagShape` (16 bytes) and RFC 8439.
 */
export const BATTLE_AEAD_TAG_BYTES = 16;

/** The header fields the server binds into a packet's AEAD nonce. */
export interface BattleAeadNonceInput {
  /** The directional key reference the session was established with. */
  keyId: string;
  matchId: string;
  playerId: string;
  /** The numeric `BattlePayloadType` value. */
  payloadType: number;
  tick: number | bigint;
  seq: number | bigint;
  ack: number | bigint;
}

/** The packet direction label used for client → server traffic. */
export const BATTLE_DIRECTION_CLIENT_TO_SERVER = 'client_to_server';

/** The packet direction label used for server → client traffic. */
export const BATTLE_DIRECTION_SERVER_TO_CLIENT = 'server_to_client';

/**
 * Reproduces `phk::battle::DevAeadNonceHex` from the C++ server.
 *
 * The server folds the header fields into an FNV-1a-64 chain and keeps the
 * first 24 hex characters (12 bytes) of the result, so the nonce is
 * *deterministic* per packet rather than random — which is what makes the
 * server's `nonce_mismatch` check possible.
 *
 * @param input     the header fields to bind
 * @param direction `client_to_server` (the default the server validates
 *                  inbound packets against) or `server_to_client`
 */
export function devBattleNonceHex(
  input: BattleAeadNonceInput,
  direction: string = BATTLE_DIRECTION_CLIENT_TO_SERVER,
): string {
  const material = concatBytes(
    utf8Local(direction),
    utf8Local(input.keyId),
    utf8Local(input.matchId),
    utf8Local(input.playerId),
    u64LeLocal(BigInt(input.payloadType)),
    u64LeLocal(BigInt(input.tick)),
    u64LeLocal(BigInt(input.seq)),
    u64LeLocal(BigInt(input.ack)),
  );
  const first = fnv1a64Local(material);
  const second = fnv1a64ContinueLocal(first, utf8Local('nonce-tail'));
  return (hex64Local(first) + hex64Local(second)).slice(0, 24);
}

/**
 * The AAD the battle channel authenticates alongside the ciphertext.
 *
 * The C++ server does not verify AAD today (it only checks the nonce
 * derivation), so this is the client's agreed binding: exactly the material
 * the nonce commits to, in the same order and encoding, so a server that
 * later verifies AEAD can rebuild it from the same header it already parses.
 */
export function devBattleAadBytes(
  input: BattleAeadNonceInput,
  direction: string = BATTLE_DIRECTION_CLIENT_TO_SERVER,
): Uint8Array {
  return concatBytes(
    utf8Local(direction),
    utf8Local(input.keyId),
    utf8Local(input.matchId),
    utf8Local(input.playerId),
    u64LeLocal(BigInt(input.payloadType)),
    u64LeLocal(BigInt(input.tick)),
    u64LeLocal(BigInt(input.seq)),
    u64LeLocal(BigInt(input.ack)),
  );
}

/**
 * Reproduces `phk::battle::DevHandshakeKeyRef` from the C++ server.
 *
 * The server checks inbound packets' `key_id` against this value, so the
 * client has to echo it on the encrypted path.
 *
 * @param transcriptHashHex the `transcript_hash` from the handshake accept
 * @param direction         `client_to_server` or `server_to_client`
 */
export function devHandshakeKeyRef(transcriptHashHex: string, direction: string): string {
  const seed = `${transcriptHashHex}:${direction}`;
  let material = '';
  let counter = 0;
  while (material.length < 32) {
    material += hex64Local(fnv1a64Local(utf8Local(`${seed}:${counter}`)));
    counter += 1;
  }
  return `hkdf-dev:${direction}:${material.slice(0, 32)}`;
}

/** UTF-8 encoding without DOM/Node globals. */
function utf8Local(text: string): Uint8Array {
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

function concatBytes(...parts: Uint8Array[]): Uint8Array {
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

function u64LeLocal(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// The C++ server uses FNV-1a-64 with the **non-canonical** offset basis
// 1469598103934665603 (not 14695981039346656037) — see the note in
// `core/math/hash64.ts`, which reproduces the same value.
const FNV64_OFFSET_BASIS = 1469598103934665603n;
const FNV64_PRIME = 1099511628211n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64Local(bytes: Uint8Array): bigint {
  let hash = FNV64_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV64_PRIME) & MASK_64;
  }
  return hash;
}

/** Continues an FNV-1a-64 chain, matching the C++ `HashAppend` helper. */
function fnv1a64ContinueLocal(hash: bigint, bytes: Uint8Array): bigint {
  let state = hash;
  for (let i = 0; i < bytes.length; i += 1) {
    state ^= BigInt(bytes[i]);
    state = (state * FNV64_PRIME) & MASK_64;
  }
  return state;
}

/** Lowercase hex, zero-padded to 16 — matches the C++ `Hex64`. */
function hex64Local(value: bigint): string {
  return value.toString(16).padStart(16, '0');
}

function fnv1a32Local(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
