/**
 * The AEAD switch.
 *
 * The property that matters is that the client **follows the server**: a dev
 * server answers `PLAINTEXT_DEV` and the client must stay on plaintext, because
 * the server's "public key" is deterministic filler rather than a real X25519
 * point — deriving from it would produce a key the server cannot reproduce, and
 * every packet would fail its auth tag. That failure looks exactly like an
 * attack, so it must never be reachable by accident.
 */

import { expect, suite, test } from './harness';
import {
  isEncryptedSelection,
  resolveCipher,
  selectBattleCipher,
  type BattleCryptoProvider,
} from '../src/core/net/battle_aead';
import { PlaintextCipher, UnsupportedKeyAgreement } from '../src/core/net/battle_crypto';
import { NativeKeyAgreement } from '../src/platform/native/native_battle_crypto';

/** A stand-in for what a real platform offers. */
function fakeProvider(keyAgreement: unknown): BattleCryptoProvider {
  return {
    keyAgreement: keyAgreement as never,
    cipherFor: () => new PlaintextCipher(),
  };
}

suite('battle aead selection');

test('a dev server keeps the client on plaintext', () => {
  // The whole reason the switch exists: this must not become encrypted even
  // though a real key agreement is available.
  const selection = selectBattleCipher('PLAINTEXT_DEV', fakeProvider(new NativeKeyAgreement()));
  expect(!selection.encrypted, 'a dev server must not turn encryption on');
  expect(selection.cipher instanceof PlaintextCipher, 'the plaintext cipher is used');
  expect(!isEncryptedSelection(selection.selected), 'the selection is not encrypted');
});

test('a real server turns encryption on when the platform can agree a key', () => {
  const selection = selectBattleCipher('CHACHA20_POLY1305', fakeProvider(new NativeKeyAgreement()));
  expect(selection.encrypted, 'a real server turns encryption on');
  // The cipher cannot exist yet — the session key does not exist until the key
  // agreement has run against the server's public key.
  expect(selection.cipher === null, 'no cipher until the session key is derived');
});

test('a real server cannot force encryption on a platform with no X25519', () => {
  const selection = selectBattleCipher(
    'CHACHA20_POLY1305',
    fakeProvider(new UnsupportedKeyAgreement()),
  );
  expect(!selection.encrypted, 'no key agreement means no encryption');
  expect(selection.cipher instanceof PlaintextCipher, 'it falls back to plaintext');
});

test('a real server with no provider at all stays on plaintext', () => {
  const selection = selectBattleCipher('CHACHA20_POLY1305', undefined);
  expect(!selection.encrypted, 'no provider means no encryption');
  expect(selection.cipher instanceof PlaintextCipher, 'it falls back to plaintext');
});

test('an unknown suite is treated as the plaintext path', () => {
  // A suite this build does not implement (XChaCha20, or a future one) must not
  // silently become "no cipher" — the session has to keep working.
  const selection = selectBattleCipher('XCHACHA20_POLY1305', fakeProvider(new NativeKeyAgreement()));
  expect(!selection.encrypted, 'an unknown suite is not encryption');
  expect(selection.cipher instanceof PlaintextCipher, 'it falls back to plaintext');
});

test('resolveCipher only produces a cipher for a real session key', () => {
  const provider = fakeProvider(new NativeKeyAgreement());
  const encrypted = selectBattleCipher('CHACHA20_POLY1305', provider);
  expect(resolveCipher(encrypted, provider, new Uint8Array(0)) === null, 'an empty key is refused');
  expect(resolveCipher(encrypted, provider, new Uint8Array(32)) !== null, 'a 32-byte key resolves');

  // The plaintext path resolves to the plaintext cipher whatever the key is,
  // including an empty one — there is no key to speak of.
  const plain = selectBattleCipher('PLAINTEXT_DEV', provider);
  expect(resolveCipher(plain, provider, new Uint8Array(0)) instanceof PlaintextCipher,
    'the plaintext path ignores the key');
});

test('every selection explains itself', () => {
  // The reason is what the log line carries, so a session that quietly runs
  // unencrypted must say why.
  const provider = fakeProvider(new NativeKeyAgreement());
  for (const selected of ['PLAINTEXT_DEV', 'CHACHA20_POLY1305', 'XCHACHA20_POLY1305', '']) {
    for (const crypto of [undefined, provider, fakeProvider(new UnsupportedKeyAgreement())]) {
      const selection = selectBattleCipher(selected, crypto);
      expect(selection.reason.length > 0, `no reason for selected=${selected}`);
    }
  }
});
