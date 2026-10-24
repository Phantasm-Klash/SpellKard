/**
 * Native (LayaNative) implementations of the battle-channel AEAD and the
 * X25519 key agreement.
 *
 * ## Why this exists
 *
 * The LayaNative runtime ships a `crypto` object, but it is a **stub**: every
 * `crypto.subtle` method throws `'not implemented'` except `digest('SHA-1')`,
 * and `crypto.getRandomValues` throws as well (measured on the shipped
 * Windows runtime — see `tmp/fix-aead/report.md`). The browser build can use
 * `WebCryptoKeyAgreement` / `WebCryptoChaCha20Poly1305Cipher`; the native
 * build therefore needs its own implementation, which this file provides on
 * top of the pure-TypeScript primitives in `./crypto/`.
 *
 * ## Wire compatibility
 *
 * The key schedule is deliberately identical to the web build's
 * `web_crypto_cipher.ts`:
 *
 *   shared  = X25519(client_private, server_public)          (32 bytes)
 *   session = HKDF-SHA256(ikm=shared,
 *                         salt=client_random || server_random,
 *                         info="phk-battle-v1", L=32)
 *
 * so a native client and a browser client derive the same session key from
 * the same handshake, and the same AEAD (`ChaCha20-Poly1305`, RFC 8439) with
 * a 16-byte tag — which is what `PhK-BattleServer` advertises in
 * `BattleHandshakeHello.supported_aead` and what its
 * `HasExpectedAeadTagShape` / `HasExpectedAeadNonceShape` checks expect
 * (16-byte tag, 24 hex chars of nonce = 12 bytes).
 *
 * NOTE: `platform/native/` only.
 */

import type { BattleCipher, KeyAgreement, SealedPayload } from '../../core/net/battle_crypto';
import {
  BATTLE_AEAD_CHACHA20_POLY1305,
  BATTLE_AEAD_NONCE_BYTES,
  BATTLE_AEAD_TAG_BYTES,
  BATTLE_HKDF_INFO,
  BATTLE_SESSION_KEY_BYTES,
} from '../../core/net/battle_crypto';
import { asciiBytes, concatBytes } from './crypto/bytes';
import { chacha20Poly1305Open, chacha20Poly1305Seal } from './crypto/chacha20_poly1305';
import { hkdfSha256 } from './crypto/hkdf';
import { nativeRandomBytes } from './crypto/random';
import { x25519, x25519PublicKey } from './crypto/x25519';

export {
  BATTLE_AEAD_CHACHA20_POLY1305,
  BATTLE_AEAD_NONCE_BYTES,
  BATTLE_AEAD_TAG_BYTES,
  BATTLE_HKDF_INFO,
  BATTLE_SESSION_KEY_BYTES,
};

/**
 * X25519 ECDHE + HKDF-SHA256 key agreement for native builds.
 *
 * Mirrors `WebCryptoKeyAgreement` in the web build, including the session key
 * schedule, so both platforms interoperate with the same server.
 */
export class NativeKeyAgreement implements KeyAgreement {
  readonly name = 'X25519+HKDF-SHA256';

  private privateKey: Uint8Array | null = null;

  /**
   * @param privateKey optional fixed 32-byte X25519 private scalar. When
   *   omitted, `generateClientKeyPair` draws a fresh one from the runtime's
   *   entropy source. Supplying one makes the handshake reproducible, which
   *   the test suite uses to diff the derived session key against the browser
   *   build's WebCrypto path.
   */
  constructor(privateKey?: Uint8Array) {
    if (privateKey !== undefined) {
      if (privateKey.length !== 32) {
        throw new Error('NativeKeyAgreement: private key must be 32 bytes');
      }
      this.privateKey = privateKey;
    }
  }

  async generateClientKeyPair(): Promise<{ publicKey: Uint8Array; random: Uint8Array }> {
    const privateKey = this.privateKey ?? nativeRandomBytes(32);
    this.privateKey = privateKey;
    // `x25519` clamps the scalar internally (RFC 7748 §5), exactly like the
    // browser's `crypto.subtle.generateKey({name:'X25519'})` does.
    const publicKey = x25519PublicKey(privateKey);
    const random = nativeRandomBytes(32);
    return { publicKey, random };
  }

  async deriveSessionKey(
    serverPublicKey: Uint8Array,
    clientRandom: Uint8Array,
    serverRandom: Uint8Array,
  ): Promise<Uint8Array> {
    if (this.privateKey === null) {
      throw new Error('generateClientKeyPair must be called before deriveSessionKey');
    }
    if (serverPublicKey.length !== 32) {
      throw new Error('deriveSessionKey: server public key must be 32 bytes');
    }
    const shared = x25519(this.privateKey, serverPublicKey);
    const salt = concatBytes(clientRandom, serverRandom);
    return hkdfSha256(shared, salt, asciiBytes(BATTLE_HKDF_INFO), BATTLE_SESSION_KEY_BYTES);
  }
}

/**
 * ChaCha20-Poly1305 AEAD for native builds.
 *
 * Mirrors `WebCryptoChaCha20Poly1305Cipher`: `seal` splits the RFC 8439
 * output into ciphertext and a 16-byte tag, and `open` re-joins them.
 */
export class NativeChaCha20Poly1305Cipher implements BattleCipher {
  readonly aead = BATTLE_AEAD_CHACHA20_POLY1305;

  private readonly key: Uint8Array;

  constructor(sessionKey: Uint8Array) {
    if (sessionKey.length !== BATTLE_SESSION_KEY_BYTES) {
      throw new Error(
        `NativeChaCha20Poly1305Cipher: session key must be ${BATTLE_SESSION_KEY_BYTES} bytes`,
      );
    }
    this.key = sessionKey;
  }

  async seal(plaintext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<SealedPayload> {
    const { ciphertext, tag } = chacha20Poly1305Seal(this.key, nonce, plaintext, aad);
    return { ciphertext, authTag: tag };
  }

  async open(
    ciphertext: Uint8Array,
    authTag: Uint8Array,
    aad: Uint8Array,
    nonce: Uint8Array,
  ): Promise<Uint8Array> {
    return chacha20Poly1305Open(this.key, nonce, ciphertext, authTag, aad);
  }
}

/**
 * Builds the AEAD key-agreement + cipher pair a native battle client needs.
 *
 * The client creates the key agreement first (it holds the ephemeral private
 * key), then derives the session key and wraps it in a cipher.
 */
export function createNativeBattleCrypto(): {
  keyAgreement: NativeKeyAgreement;
  cipherFor(sessionKey: Uint8Array): NativeChaCha20Poly1305Cipher;
} {
  return {
    keyAgreement: new NativeKeyAgreement(),
    cipherFor: (sessionKey: Uint8Array) => new NativeChaCha20Poly1305Cipher(sessionKey),
  };
}
