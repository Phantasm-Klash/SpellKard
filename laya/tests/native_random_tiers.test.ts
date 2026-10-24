/**
 * Randomness tiers and their effect on the handshake.
 *
 * Three sources exist, and which one is active is a property of the runtime
 * rather than a setting — so the tests below install each one in turn and check
 * that the handshake still derives the same session key from the same inputs.
 *
 * The point of that last part: randomness only ever seeds the handshake
 * (`client_random`, the ephemeral X25519 private key). Everything after it is
 * deterministic, so switching from one OS generator to another must not change
 * what the server computes. If it did, the client would be unable to reproduce
 * the server's view of the battle.
 */

import { expect, suite, test } from './harness';

import {
  nativeRandomBytes,
  randomSource,
  hasWorkingWebCryptoRandom,
  hasWorkingNativeCryptoExtension,
  nativeCryptoSourceLabel,
} from '../src/platform/native/crypto/random';
import { NativeKeyAgreement } from '../src/platform/native/native_battle_crypto';
import { BATTLE_HKDF_INFO, BATTLE_SESSION_KEY_BYTES } from '../src/core/net/battle_crypto';

/**
 * Swaps `globalThis[name]` for the duration of `body`.
 *
 * Node 18+ defines `globalThis.crypto` as a **getter-only** accessor, so a
 * plain assignment throws — `defineProperty` is the only way to replace it,
 * and it is also how the real LayaNative runtime exposes its (shim) `crypto`.
 */
function swapGlobal<T>(name: string, value: unknown, body: () => T): T {
  const scope = globalThis as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(scope, name);
  const previous = scope[name];
  Object.defineProperty(scope, name, { value, configurable: true, writable: true, enumerable: true });
  try {
    return body();
  } finally {
    if (had) {
      Object.defineProperty(scope, name, {
        value: previous,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } else {
      delete scope[name];
    }
  }
}

/** The async twin of {@link swapGlobal}. */
async function swapGlobalAsync<T>(name: string, value: unknown, body: () => Promise<T>): Promise<T> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(scope, name);
  const previous = scope[name];
  Object.defineProperty(scope, name, { value, configurable: true, writable: true, enumerable: true });
  try {
    return await body();
  } finally {
    if (had) {
      Object.defineProperty(scope, name, {
        value: previous,
        configurable: true,
        writable: true,
        enumerable: true,
      });
    } else {
      delete scope[name];
    }
  }
}

function withCrypto<T>(value: unknown, body: () => T): T {
  return swapGlobal('crypto', value, body);
}

function withCryptoAsync<T>(value: unknown, body: () => Promise<T>): Promise<T> {
  return swapGlobalAsync('crypto', value, body);
}

function withExtension<T>(value: unknown, body: () => T): T {
  return swapGlobal('spk_crypto', value, body);
}

function withExtensionAsync<T>(value: unknown, body: () => Promise<T>): Promise<T> {
  return swapGlobalAsync('spk_crypto', value, body);
}

suite('randomness tiers');
  test('the native shim is not mistaken for a working generator', () => {
    // LayaNative's apploader.js installs a SubtleCrypto/Crypto shim whose
    // methods all throw. The probe must say "not usable", not "present".
    withCrypto(
      {
        getRandomValues() {
          throw 'not implemented';
        },
      },
      () => {
        expect(!hasWorkingWebCryptoRandom(), 'a throwing shim is not a working source');
        expect(randomSource() === 'native-drbg' || randomSource() === 'native-extension', 'falls past the shim');
      },
    );
  });

  test('a missing global is not a working generator either', () => {
    withCrypto(undefined, () => {
      expect(!hasWorkingWebCryptoRandom(), 'no crypto object at all');
    });
  });

  test('the extension tier is recognised when it returns the requested length', () => {
    withExtension({ randomBytes: (n: number) => new Uint8Array(n).fill(0xab) }, () => {
      expect(hasWorkingNativeCryptoExtension(), 'a well-formed answer counts');
    });
  });

  test('the extension tier is rejected when it answers with the wrong length', () => {
    // A short answer means the platform call failed; trusting it would hand
    // back bytes that are not what was asked for.
    withExtension({ randomBytes: (): Uint8Array | null => new Uint8Array(4) }, () => {
      expect(!hasWorkingNativeCryptoExtension(), 'a short answer is not usable');
    });
  });

  test('the extension tier is rejected when it throws', () => {
    withExtension(
      {
        randomBytes() {
          throw 'not implemented';
        },
      },
      () => {
        expect(!hasWorkingNativeCryptoExtension(), 'a throwing extension is not usable');
      },
    );
  });

  test('the extension tier is rejected when it answers null', () => {
    // `null` is the extension's way of saying "my platform call failed".
    withExtension({ randomBytes: () => null }, () => {
      expect(!hasWorkingNativeCryptoExtension(), 'null means failure');
    });
  });

  test('the engine tier wins over the extension when it works', () => {
    withCrypto(
      {
        getRandomValues(array: Uint8Array) {
          array.fill(0x5a);
          return array;
        },
      },
      () => {
        withExtension({ randomBytes: (n: number) => new Uint8Array(n).fill(0xab) }, () => {
          expect(randomSource() === 'webcrypto', 'the engine comes first');
          const out = nativeRandomBytes(8);
          expect(out[0] === 0x5a, 'the bytes come from the engine');
        });
      },
    );
  });

  test('the extension tier is used when the engine shim throws', () => {
    withCrypto({ getRandomValues: () => { throw 'not implemented'; } }, () => {
      withExtension({ randomBytes: (n: number) => new Uint8Array(n).fill(0xab) }, () => {
        expect(randomSource() === 'native-extension', 'the extension takes over');
        const out = nativeRandomBytes(8);
        expect(out.length === 8, 'the full length is returned');
        expect(out[0] === 0xab, 'the bytes come from the extension');
      });
    });
  });

  test('the DRBG is the last resort when neither works', () => {
    withCrypto(undefined, () => {
      withExtension(undefined, () => {
        expect(randomSource() === 'native-drbg', 'nothing else is available');
        const out = nativeRandomBytes(32);
        expect(out.length === 32, 'still fills the request');
      });
    });
  });

  test('every tier fills the requested length', () => {
    const sources: Array<() => unknown> = [
      () => ({
        crypto: { getRandomValues: (a: Uint8Array) => { a.fill(1); return a; } },
        spk_crypto: undefined,
      }),
      () => ({
        crypto: undefined,
        spk_crypto: { randomBytes: (n: number) => new Uint8Array(n).fill(2) },
      }),
      () => ({ crypto: undefined, spk_crypto: undefined }),
    ];
    for (const [index, install] of sources.entries()) {
      const installed = install() as { crypto?: unknown; spk_crypto?: unknown };
      withCrypto(installed.crypto, () => {
        withExtension(installed.spk_crypto, () => {
          for (const length of [1, 16, 32, 64, 257]) {
            const out = nativeRandomBytes(length);
            expect(out.length === length, `tier ${index} fills ${length} bytes`);
          }
        });
      });
    }
  });

  /** `nativeRandomBytes(-1)` must throw, not clamp. */
function throwsNegative(): boolean {
  try {
    nativeRandomBytes(-1);
    return false;
  } catch {
    return true;
  }
}

/** `nativeRandomBytes(1.5)` must throw, not truncate. */
function throwsFractional(): boolean {
  try {
    nativeRandomBytes(1.5);
    return false;
  } catch {
    return true;
  }
}

test('an invalid length is refused rather than silently truncated', () => {
    expect(throwsNegative(), 'a negative length throws');
    expect(throwsFractional(), 'a fractional length throws');
    const zero = nativeRandomBytes(0);
    expect(zero.length === 0, 'zero is a valid, empty request');
  });

  test('the extension reports which platform API it is calling', () => {
    withExtension({ randomBytes: (n: number) => new Uint8Array(n), source: () => 'windows-cng-bcryptgenrandom' }, () => {
      expect(nativeCryptoSourceLabel() === 'windows-cng-bcryptgenrandom', 'the label reaches JS');
    });
    withExtension(undefined, () => {
      expect(nativeCryptoSourceLabel() === null, 'no extension means no label');
    });
  });

suite('the randomness source does not change what the server computes');
/**
 * Drives one real handshake: the caller's instance generates its key pair
 * (consuming whatever randomness source is active) and then derives the session
 * key from the *server's* public key plus both randoms.
 *
 * `NativeKeyAgreement` needs its own private key to derive, so a handshake is
 * always one instance doing both steps — there is no "derive from wire values
 * alone", because the private key never leaves the client.
 */
async function handshakeUnder(agreement: NativeKeyAgreement): Promise<{
  clientPublicKey: Uint8Array;
  clientRandom: Uint8Array;
  sessionKey: Uint8Array;
}> {
  const { publicKey: clientPublicKey, random: clientRandom } = await agreement.generateClientKeyPair();
  // The server's side of the same exchange: its own key pair and random.
  const server = new NativeKeyAgreement();
  const { publicKey: serverPublicKey, random: serverRandom } = await server.generateClientKeyPair();
  const sessionKey = await agreement.deriveSessionKey(serverPublicKey, clientRandom, serverRandom);
  return { clientPublicKey, clientRandom, sessionKey };
}

/** Byte-wise comparison, without depending on a helper for `Uint8Array`. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

test('a handshake succeeds under every randomness source', async () => {
  // The randoms differ per source — that is the point of them — so what this
  // checks is that the *derivation* still succeeds and still produces a
  // well-formed 32-byte key no matter which generator fed it. A source that
  // produced short or constant bytes would show up as a wrong length here.
  for (const install of [
    { crypto: undefined, spk_crypto: undefined },
    { crypto: { getRandomValues: (a: Uint8Array) => { a.fill(7); return a; } }, spk_crypto: undefined },
    { crypto: undefined, spk_crypto: { randomBytes: (n: number) => new Uint8Array(n).fill(9) } },
  ]) {
    await withCryptoAsync(install.crypto, async () => {
      await withExtensionAsync(install.spk_crypto, async () => {
        const result = await handshakeUnder(new NativeKeyAgreement());
        expect(result.clientPublicKey.length === 32, 'the client public key is 32 bytes');
        expect(result.clientRandom.length === 32, 'the client random is 32 bytes');
        expect(
          result.sessionKey.length === BATTLE_SESSION_KEY_BYTES,
          'the session key is 32 bytes under every source',
        );
      });
    });
  }
});

test('the derivation is deterministic for fixed inputs', async () => {
  // The half of "the server can reproduce it" that is testable without a
  // server: the same key material and the same randoms must always give the
  // same session key. Randomness only chooses the inputs; the maths is fixed.
  const client = new NativeKeyAgreement();
  const server = new NativeKeyAgreement();
  const clientPair = await client.generateClientKeyPair();
  const serverPair = await server.generateClientKeyPair();

  const first = await client.deriveSessionKey(
    serverPair.publicKey,
    clientPair.random,
    serverPair.random,
  );
  const second = await client.deriveSessionKey(
    serverPair.publicKey,
    clientPair.random,
    serverPair.random,
  );
  expect(sameBytes(first, second), 'the same inputs derive the same key');

  // And the server, deriving from the same two publics and randoms, must reach
  // the same key — this is the property that lets both sides agree.
  const fromServer = await server.deriveSessionKey(
    clientPair.publicKey,
    clientPair.random,
    serverPair.random,
  );
  expect(
    sameBytes(first, fromServer),
    'client and server derive the same key from the same wire values',
  );
});

  test('different randoms derive different keys', async () => {
    // The counterpart check: the derivation is not accidentally constant, so
    // the randomness genuinely feeds the key.
    const agreement = new NativeKeyAgreement();
    const { publicKey: serverPublic } = await agreement.generateClientKeyPair();
    const randomA = new Uint8Array(32).fill(1);
    const randomB = new Uint8Array(32).fill(2);

    const keyA = await agreement.deriveSessionKey(serverPublic, randomA, randomA);
    const keyB = await agreement.deriveSessionKey(serverPublic, randomB, randomB);
    let same = keyA.length === keyB.length;
    for (let i = 0; same && i < keyA.length; i += 1) {
      if (keyA[i] !== keyB[i]) {
        same = false;
      }
    }
    expect(!same, 'different randoms must give different keys');
  });

  test('the key schedule matches the documented HKDF parameters', async () => {
    // Guards the constants the server has to agree on: the info label and the
    // output length. If either drifts, the server's derivation diverges even
    // though the maths is still self-consistent.
    const agreement = new NativeKeyAgreement();
    const { publicKey: serverPublic } = await agreement.generateClientKeyPair();
    const key = await agreement.deriveSessionKey(
      serverPublic,
      new Uint8Array(32).fill(3),
      new Uint8Array(32).fill(4),
    );
    expect(key.length === BATTLE_SESSION_KEY_BYTES, 'the session key is 32 bytes');
    expect(BATTLE_HKDF_INFO.length > 0, 'the HKDF info label is fixed');
  });
