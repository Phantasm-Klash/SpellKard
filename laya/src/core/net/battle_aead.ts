/**
 * Where the battle channel's AEAD is switched on.
 *
 * The handshake itself is X25519 ECDHE + HKDF-SHA256, and each packet is then
 * ChaCha20-Poly1305 — see `core/net/battle_crypto.ts` for the interfaces and
 * `platform/native/native_battle_crypto.ts` for the implementation that runs on
 * the shipped client.
 *
 * ## Why this is a switch and not a replacement
 *
 * The battle server has **two** handshakes behind one field. `handshake.cpp`'s
 * `Accept()` currently fills its "public key" with
 * `FillDevBytes(match_id + ":server-pub")` — deterministic FNV-1a filler, not an
 * X25519 operation — so the key it reports does not correspond to any private
 * key. If the client derived a session key from that value the two sides would
 * compute different keys and every packet's auth tag would fail, which is
 * indistinguishable from an attack.
 *
 * So the plaintext path stays the default, and the AEAD path is selected by
 * what the **server** answers: a dev server reports `PLAINTEXT_DEV`, a real one
 * reports `CHACHA20_POLY1305`. The client follows, which means the server can
 * roll out first and the client needs no redeploy.
 *
 * ## What is still missing before this can be turned on
 *
 * The handshake messages carry the fields (`BattleHandshakeHello`:
 * `client_x25519_pub` / `client_random` / `supported_aead`;
 * `BattleHandshakeAccept`: `server_x25519_pub` / `server_random` /
 * `selected_aead` / `key_id`), and the codec can encode `Hello` — but
 * `BattleClient` does not perform a handshake at all yet: it opens a KCP session
 * and starts sending inputs. Wiring the exchange itself is the remaining step
 * and needs the server side to be real, so it is deliberately left undone rather
 * than half-built. See `docs/battle-aead-server-spec.md`.
 *
 * NOTE: `core/net/` only.
 */

import {
  BATTLE_AEAD_CHACHA20_POLY1305,
  type BattleCipher,
  type KeyAgreement,
  PlaintextCipher,
  UnsupportedKeyAgreement,
} from './battle_crypto';

/**
 * The AEAD a platform can offer: how to agree on a key, and how to wrap it in a
 * cipher once derived.
 *
 * Kept as one object because the two halves are useless apart — a key agreement
 * with no way to build a cipher cannot encrypt, and a cipher with no way to
 * agree on a key has nothing to key itself with.
 */
export interface BattleCryptoProvider {
  /** The X25519 + HKDF implementation. */
  readonly keyAgreement: KeyAgreement;
  /** Wraps a derived 32-byte session key in the AEAD cipher. */
  cipherFor(sessionKey: Uint8Array): BattleCipher;
}

/** What the server reported in `BattleHandshakeAccept.selected_aead`. */
export type SelectedAead = 'PLAINTEXT_DEV' | 'CHACHA20_POLY1305' | string;

/** Which cipher the client ended up using, and why. */
export interface AeadSelection {
  /** True when packets are actually sealed — `false` means plaintext. */
  encrypted: boolean;
  /** The suite the server selected, as reported. */
  selected: SelectedAead;
  /** Why this cipher was chosen, for the log line. */
  reason: string;
  /**
   * The cipher to seal and open with.
   *
   * Present as soon as the selection is made: `null` while the session key does
   * not exist yet (the key agreement has not run), and replaced by the real
   * cipher once it has. The plaintext path always has one immediately.
   */
  cipher: BattleCipher | null;
}

/**
 * Picks the cipher for a session from what the server negotiated.
 *
 * @param selected the `selected_aead` the server answered with
 * @param crypto what this platform can offer. Omit to get the plaintext cipher
 *   regardless of what the server asked for.
 */
export function selectBattleCipher(selected: SelectedAead, crypto?: BattleCryptoProvider): AeadSelection {
  if (selected !== BATTLE_AEAD_CHACHA20_POLY1305) {
    return {
      cipher: new PlaintextCipher(),
      encrypted: false,
      selected,
      reason: 'server selected the dev plaintext path',
    };
  }
  if (crypto === undefined || crypto.keyAgreement instanceof UnsupportedKeyAgreement) {
    return {
      cipher: new PlaintextCipher(),
      encrypted: false,
      selected,
      reason: 'server asked for AEAD but this platform has no X25519 implementation',
    };
  }
  // The cipher cannot exist yet: the session key does not exist until the key
  // agreement has run against the server's public key. `resolveCipher` is what
  // turns a derived key into one, so this records that it *will* be available
  // rather than building one from a key that is not there.
  return {
    cipher: null,
    encrypted: true,
    selected,
    reason: 'server selected ChaCha20-Poly1305 and a key agreement is available',
  };
}

/**
 * Whether a `selected_aead` answer means the session is encrypted.
 *
 * A single place for that question, so the send and receive paths cannot
 * disagree about it — if they did, one side would seal while the other read
 * plaintext and every packet would fail.
 */
export function isEncryptedSelection(selected: SelectedAead): boolean {
  return selected === BATTLE_AEAD_CHACHA20_POLY1305;
}

/**
 * Turns a derived session key into the cipher a selection promised.
 *
 * @returns the cipher, or `null` when the selection is the plaintext path
 */
export function resolveCipher(
  selection: AeadSelection,
  crypto: BattleCryptoProvider | undefined,
  sessionKey: Uint8Array,
): BattleCipher | null {
  if (!selection.encrypted) {
    return selection.cipher;
  }
  if (crypto === undefined || sessionKey.length === 0) {
    return null;
  }
  return crypto.cipherFor(sessionKey);
}
