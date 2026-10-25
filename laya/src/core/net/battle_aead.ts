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

/**
 * Which direction of the channel is sealed.
 *
 * The two directions are deliberately separable. Server → client carries the
 * snapshot broadcast: it is the same bytes for every player in the match, so
 * sealing it buys no secrecy, and it is by far the larger half of the traffic
 * (measured at 377 KB/s against 2.5 KB/s for the input direction). Client →
 * server is the cheat-sensitive half — it is where forged inputs, replays and
 * tick/seq tampering all live — and it is tiny, so it is the half worth
 * sealing. `docs/battle-wire-scheme.md` §P2.
 *
 * `both` remains available for a deployment that wants the snapshot encrypted
 * as well.
 */
export type AeadDirection = 'none' | 'client-to-server' | 'both';

/** Which cipher the client ended up using, and why. */
export interface AeadSelection {
  /** True when *some* direction is sealed — `false` means all-plaintext. */
  encrypted: boolean;
  /** The suite the server selected, as reported. */
  selected: SelectedAead;
  /** Why this cipher was chosen, for the log line. */
  reason: string;
  /**
   * Which half of the channel is sealed.
   *
   * The send and receive paths read this separately, so a session that seals
   * only its outgoing half still reads the snapshot broadcast as plaintext
   * instead of trying to open it and failing on every frame.
   */
  direction: AeadDirection;
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
export function selectBattleCipher(
  selected: SelectedAead,
  crypto?: BattleCryptoProvider,
  direction: AeadDirection = 'both',
): AeadSelection {
  if (selected !== BATTLE_AEAD_CHACHA20_POLY1305) {
    return {
      cipher: new PlaintextCipher(),
      encrypted: false,
      selected,
      direction: 'none',
      reason: 'server selected the dev plaintext path',
    };
  }
  if (crypto === undefined || crypto.keyAgreement instanceof UnsupportedKeyAgreement) {
    return {
      cipher: new PlaintextCipher(),
      encrypted: false,
      selected,
      direction: 'none',
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
    direction,
    reason: 'server selected ChaCha20-Poly1305 and a key agreement is available',
  };
}

/**
 * Picks the cipher for a session whose key arrived **out of band** — handed to
 * the client by the lobby alongside the battle ticket, and to the battle server
 * over its own channel.
 *
 * This is the path `docs/battle-wire-scheme.md` §P2 recommends, and it is the
 * one CS:GO's third-party net-channel keys and WoW's realmd → worldd session
 * key both use. Two things fall out of it:
 *
 *  - **No handshake, so no extra RTT.** The first input frame of the match is
 *    already sealed, where an in-band ECDHE exchange would have spent a round
 *    trip before the match could start.
 *  - **No key agreement needed at all.** The platform only has to be able to
 *    build a cipher from a key it was handed, which every platform can.
 *
 * @param sessionKey the 32-byte battle session key from the lobby
 * @param direction  defaults to `client-to-server`: the snapshot broadcast is
 *   public state, so there is nothing to be gained by sealing it
 */
export function selectBattleCipherWithSessionKey(
  sessionKey: Uint8Array,
  crypto?: BattleCryptoProvider,
  direction: AeadDirection = 'client-to-server',
): AeadSelection {
  if (crypto === undefined) {
    return {
      cipher: new PlaintextCipher(),
      encrypted: false,
      selected: BATTLE_AEAD_CHACHA20_POLY1305,
      direction: 'none',
      reason: 'the lobby sent a session key but this platform has no cipher',
    };
  }
  if (sessionKey.length === 0) {
    return {
      cipher: new PlaintextCipher(),
      encrypted: false,
      selected: BATTLE_AEAD_CHACHA20_POLY1305,
      direction: 'none',
      reason: 'the lobby sent an empty session key',
    };
  }
  return {
    cipher: crypto.cipherFor(sessionKey),
    encrypted: true,
    selected: BATTLE_AEAD_CHACHA20_POLY1305,
    direction,
    reason: `session key delivered by the lobby, sealing ${direction}`,
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
 * Whether outgoing (client → server) frames are sealed.
 *
 * Separate from {@link sealsServerToClient} because a session may seal only one
 * half: checking a single "encrypted" flag on both paths would make the receive
 * path try to open the plaintext snapshot broadcast and drop every frame.
 */
export function sealsClientToServer(selection: AeadSelection | null): boolean {
  if (selection === null || !selection.encrypted || selection.cipher === null) {
    return false;
  }
  return selection.direction === 'client-to-server' || selection.direction === 'both';
}

/** Whether incoming (server → client) frames are sealed. */
export function sealsServerToClient(selection: AeadSelection | null): boolean {
  if (selection === null || !selection.encrypted || selection.cipher === null) {
    return false;
  }
  return selection.direction === 'both';
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
