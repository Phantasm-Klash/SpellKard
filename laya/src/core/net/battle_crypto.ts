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

function fnv1a32Local(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
