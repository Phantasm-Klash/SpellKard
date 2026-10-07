/**
 * Web Crypto implementations of the battle-channel AEAD and key agreement.
 *
 * Uses `crypto.subtle`, available in browsers and Node 18+ (X25519 requires
 * Node 20+ / recent Chrome; `WebCryptoKeyAgreement.isSupported()` reports
 * availability so the app can fall back to the dev scaffold).
 *
 * Suite selection matches the server's negotiated values
 * (`PhK-BattleServer/src/server.cpp` accepts `CHACHA20_POLY1305` and
 * `XCHACHA20_POLY1305`). Web Crypto only exposes ChaCha20-Poly1305, so
 * XChaCha20 would need a bundled implementation; the client advertises only
 * ChaCha20-Poly1305.
 */

import type { BattleCipher, KeyAgreement, SealedPayload } from '../../core/net/battle_crypto';

const TAG_LENGTH_BYTES = 16;
const HKDF_INFO = 'phk-battle-v1';

export class WebCryptoChaCha20Poly1305Cipher implements BattleCipher {
  readonly aead = 'CHACHA20_POLY1305';

  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private readonly sessionKey: Uint8Array) {}

  private importKey(): Promise<CryptoKey> {
    if (this.keyPromise === null) {
      this.keyPromise = crypto.subtle.importKey(
        'raw',
        toArrayBuffer(this.sessionKey),
        { name: 'ChaCha20-Poly1305' },
        false,
        ['encrypt', 'decrypt'],
      );
    }
    return this.keyPromise;
  }

  async seal(plaintext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<SealedPayload> {
    const key = await this.importKey();
    const sealed = await crypto.subtle.encrypt(
      {
        name: 'ChaCha20-Poly1305',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
        tagLength: TAG_LENGTH_BYTES * 8,
      },
      key,
      toArrayBuffer(plaintext),
    );
    const bytes = new Uint8Array(sealed);
    return {
      ciphertext: bytes.slice(0, bytes.length - TAG_LENGTH_BYTES),
      authTag: bytes.slice(bytes.length - TAG_LENGTH_BYTES),
    };
  }

  async open(
    ciphertext: Uint8Array,
    authTag: Uint8Array,
    aad: Uint8Array,
    nonce: Uint8Array,
  ): Promise<Uint8Array> {
    const key = await this.importKey();
    const combined = new Uint8Array(ciphertext.length + authTag.length);
    combined.set(ciphertext, 0);
    combined.set(authTag, ciphertext.length);
    const opened = await crypto.subtle.decrypt(
      {
        name: 'ChaCha20-Poly1305',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(aad),
        tagLength: TAG_LENGTH_BYTES * 8,
      },
      key,
      toArrayBuffer(combined),
    );
    return new Uint8Array(opened);
  }
}

/**
 * X25519 ECDHE + HKDF-SHA256 key agreement, matching the documented battle
 * handshake (`BattleHandshakeHello.client_x25519_pub` → `BattleHandshakeAccept`
 * `server_x25519_pub` → `transcript_hash`).
 */
export class WebCryptoKeyAgreement implements KeyAgreement {
  readonly name = 'X25519+HKDF-SHA256';

  private keyPair: CryptoKeyPair | null = null;

  static isSupported(): boolean {
    return (
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle !== 'undefined' &&
      typeof (crypto.subtle as { deriveBits?: unknown }).deriveBits === 'function'
    );
  }

  async generateClientKeyPair(): Promise<{ publicKey: Uint8Array; random: Uint8Array }> {
    const algorithm = { name: 'X25519' } as unknown as AlgorithmIdentifier;
    this.keyPair = (await crypto.subtle.generateKey(algorithm, true, [
      'deriveBits',
    ])) as unknown as CryptoKeyPair;
    const raw = await crypto.subtle.exportKey('raw', this.keyPair.publicKey);
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    return { publicKey: new Uint8Array(raw), random };
  }

  async deriveSessionKey(
    serverPublicKey: Uint8Array,
    clientRandom: Uint8Array,
    serverRandom: Uint8Array,
  ): Promise<Uint8Array> {
    if (this.keyPair === null) {
      throw new Error('generateClientKeyPair must be called before deriveSessionKey');
    }
    const serverKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(serverPublicKey),
      { name: 'X25519' } as unknown as AlgorithmIdentifier,
      false,
      [],
    );
    const shared = await crypto.subtle.deriveBits(
      { name: 'X25519', public: serverKey } as unknown as AlgorithmIdentifier,
      this.keyPair.privateKey,
      256,
    );
    return hkdfSha256(new Uint8Array(shared), concat(clientRandom, serverRandom), HKDF_INFO, 32);
  }
}

export async function hkdfSha256(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  lengthBytes: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', toArrayBuffer(inputKeyMaterial), 'HKDF', false, [
    'deriveBits',
  ]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(encodeAscii(info)),
    },
    baseKey,
    lengthBytes * 8,
  );
  return new Uint8Array(derived);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    out[i] = text.charCodeAt(i) & 0x7f;
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
