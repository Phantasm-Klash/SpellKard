/**
 * Native (LayaNative) battle AEAD + X25519 key-agreement coverage.
 *
 * The LayaNative runtime's `crypto.subtle` is a stub (every method throws
 * `'not implemented'` except `digest('SHA-1')`), so the native build carries
 * its own pure-TypeScript X25519 / HKDF-SHA256 / ChaCha20-Poly1305. These
 * tests pin that implementation against
 *
 *   - the **official RFC test vectors** (RFC 7748, RFC 8439, RFC 5869), and
 *   - the **C++ battle server's** dev-scaffold derivations, reproduced by
 *     compiling the server's own functions and diffing the output
 *     (see `tmp/fix-aead/crosscheck/`).
 *
 * The C++ vectors below are golden values produced by
 * `PhK-BattleServer/src/protocol.cpp`'s `DevAeadNonceHex` and
 * `src/handshake.cpp`'s `DevHandshakeKeyRef`, compiled verbatim.
 */

import {
  BATTLE_AEAD_CHACHA20_POLY1305,
  BATTLE_AEAD_NONCE_BYTES,
  BATTLE_AEAD_TAG_BYTES,
  BATTLE_HKDF_INFO,
  BATTLE_SESSION_KEY_BYTES,
  devBattleAadBytes,
  devBattleNonceHex,
  devHandshakeKeyRef,
} from '../src/core/net/battle_crypto';
import { asciiBytes, concatBytes, toHex } from '../src/platform/native/crypto/bytes';
import {
  chacha20Poly1305Open,
  chacha20Poly1305Seal,
  poly1305,
} from '../src/platform/native/crypto/chacha20_poly1305';
import { hkdfSha256 } from '../src/platform/native/crypto/hkdf';
import { hasWorkingWebCryptoRandom, nativeRandomBytes, randomSource } from '../src/platform/native/crypto/random';
import { hmacSha256, sha256 } from '../src/platform/native/crypto/sha256';
import { x25519, x25519PublicKey } from '../src/platform/native/crypto/x25519';
import {
  NativeChaCha20Poly1305Cipher,
  NativeKeyAgreement,
  createNativeBattleCrypto,
} from '../src/platform/native/native_battle_crypto';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

// Node's own crypto module, used as an *independent* implementation to diff
// the native code against (Node's X25519 and HKDF are separate code paths
// from the ones under test).
declare const require: (id: string) => {
  createPrivateKey(options: unknown): unknown;
  createPublicKey(options: unknown): unknown;
  diffieHellman(options: unknown): Uint8Array;
  hkdfSync(
    digest: string,
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): ArrayBuffer;
};
declare const Buffer: {
  from(data: Uint8Array | string, encoding?: string): Uint8Array;
  concat(parts: Uint8Array[]): Uint8Array;
  equals(other: Uint8Array): boolean;
};

const nodeCrypto = require('node:crypto');

/** X25519 shared secret via Node's OpenSSL-backed implementation. */
function nodeX25519Shared(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b656e04220420', 'hex'),
    privateKey,
  ]);
  const spki = Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), publicKey]);
  return nodeCrypto.diffieHellman({
    privateKey: nodeCrypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }),
    publicKey: nodeCrypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }),
  });
}

/** HKDF-SHA256 via Node's OpenSSL-backed implementation. */
function nodeHmacHkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  // Node's `hkdfSync` returns a bare ArrayBuffer; wrap it so the caller gets
  // a Uint8Array like the rest of the codebase uses.
  return new Uint8Array(nodeCrypto.hkdfSync('sha256', ikm, salt, info, length));
}

function hex(text: string): Uint8Array {
  const out = new Uint8Array(text.length >> 1);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ---------------------------------------------------------------------------
// RFC 7748 §6.1 — X25519
// ---------------------------------------------------------------------------

suite('native crypto: X25519 (RFC 7748)');

test('derives the RFC 7748 public keys', () => {
  const alicePrivate = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bobPrivate = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  expectEqual(
    toHex(x25519PublicKey(alicePrivate)),
    '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
  );
  expectEqual(
    toHex(x25519PublicKey(bobPrivate)),
    'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
  );
});

test('agrees on the RFC 7748 shared secret', () => {
  const alicePrivate = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const bobPrivate = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  const shared = x25519(alicePrivate, x25519PublicKey(bobPrivate));
  expectEqual(toHex(shared), '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
  // Both directions must produce the same bytes.
  expectEqual(toHex(x25519(bobPrivate, x25519PublicKey(alicePrivate))), toHex(shared));
});

test('matches the RFC 7748 §5.2 iterated vector', () => {
  const k = new Uint8Array(32);
  k[0] = 9;
  const u = new Uint8Array(32);
  u[0] = 9;
  expectEqual(
    toHex(x25519(k, u)),
    '422c8e7a6227d7bca1350b3e2bb7279f7897b87bb6854b783c60e80311ae3079',
  );
});

test('clamps the scalar like the browser build does', () => {
  // The browser's `crypto.subtle.generateKey({name:'X25519'})` clamps, so an
  // unclamped and a clamped scalar must produce the same public key.
  const raw = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const clamped = new Uint8Array(raw);
  clamped[0] &= 248;
  clamped[31] &= 127;
  clamped[31] |= 64;
  expectEqual(toHex(x25519PublicKey(raw)), toHex(x25519PublicKey(clamped)));
});

test('rejects a malformed key size', () => {
  let threw = false;
  try {
    x25519(new Uint8Array(31), new Uint8Array(32));
  } catch {
    threw = true;
  }
  expect(threw, 'x25519 must reject a 31-byte scalar');
});

// ---------------------------------------------------------------------------
// RFC 5869 — HKDF-SHA256
// ---------------------------------------------------------------------------

suite('native crypto: HKDF-SHA256 (RFC 5869)');

test('reproduces RFC 5869 test case 1', () => {
  const ikm = hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
  const salt = hex('000102030405060708090a0b0c');
  const info = hex('f0f1f2f3f4f5f6f7f8f9');
  const okm = hkdfSha256(ikm, salt, info, 42);
  expectEqual(okm.length, 42);
  expectEqual(
    toHex(okm),
    '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
  );
});

test('treats an empty salt as a zero-filled block', () => {
  const ikm = hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
  const withEmptySalt = hkdfSha256(ikm, new Uint8Array(0), hex('f0f1f2f3f4f5f6f7f8f9'), 42);
  const withZeroSalt = hkdfSha256(ikm, new Uint8Array(32), hex('f0f1f2f3f4f5f6f7f8f9'), 42);
  expectEqual(toHex(withEmptySalt), toHex(withZeroSalt));
});

test('produces the requested length', () => {
  const ikm = new Uint8Array(32).fill(7);
  expectEqual(hkdfSha256(ikm, new Uint8Array(32), new Uint8Array(0), 32).length, 32);
  expectEqual(hkdfSha256(ikm, new Uint8Array(32), new Uint8Array(0), 1).length, 1);
  expectEqual(hkdfSha256(ikm, new Uint8Array(32), new Uint8Array(0), 100).length, 100);
});

// ---------------------------------------------------------------------------
// RFC 8439 — ChaCha20-Poly1305
// ---------------------------------------------------------------------------

suite('native crypto: ChaCha20-Poly1305 (RFC 8439)');

test('reproduces the RFC 8439 §2.8.2 AEAD vector', () => {
  const key = hex('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
  const nonce = hex('070000004041424344454647');
  const aad = hex('50515253c0c1c2c3c4c5c6c7');
  const plaintext = new TextEncoder().encode(
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
  );
  const sealed = chacha20Poly1305Seal(key, nonce, plaintext, aad);
  expectEqual(
    toHex(sealed.ciphertext),
    'd31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116',
  );
  expectEqual(toHex(sealed.tag), '1ae10b594f09e26a7e902ecbd0600691');
  const opened = chacha20Poly1305Open(key, nonce, sealed.ciphertext, sealed.tag, aad);
  expectEqual(toHex(opened), toHex(plaintext));
});

test('reproduces the RFC 8439 §2.5.2 Poly1305 vector', () => {
  const key = hex('85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b');
  const message = new TextEncoder().encode('Cryptographic Forum Research Group');
  expectEqual(toHex(poly1305(key, message)), 'a8061dc1305136c6c22b8baf0c0127a9');
});

test('rejects a tampered ciphertext, tag, or AAD', () => {
  const key = new Uint8Array(32).fill(3);
  const nonce = new Uint8Array(12).fill(4);
  const aad = new Uint8Array(5).fill(5);
  const plaintext = new Uint8Array(40).fill(6);
  const sealed = chacha20Poly1305Seal(key, nonce, plaintext, aad);

  const badTag = new Uint8Array(sealed.tag);
  badTag[0] ^= 0x01;
  let threw = false;
  try {
    chacha20Poly1305Open(key, nonce, sealed.ciphertext, badTag, aad);
  } catch {
    threw = true;
  }
  expect(threw, 'a tampered tag must be rejected');

  const badCiphertext = new Uint8Array(sealed.ciphertext);
  badCiphertext[0] ^= 0x01;
  threw = false;
  try {
    chacha20Poly1305Open(key, nonce, badCiphertext, sealed.tag, aad);
  } catch {
    threw = true;
  }
  expect(threw, 'a tampered ciphertext must be rejected');

  threw = false;
  try {
    chacha20Poly1305Open(key, nonce, sealed.ciphertext, sealed.tag, new Uint8Array(6));
  } catch {
    threw = true;
  }
  expect(threw, 'a mismatched AAD must be rejected');
});

test('round-trips an empty plaintext and empty AAD', () => {
  const key = new Uint8Array(32).fill(9);
  const nonce = new Uint8Array(12).fill(10);
  const sealed = chacha20Poly1305Seal(key, nonce, new Uint8Array(0), new Uint8Array(0));
  expectEqual(sealed.ciphertext.length, 0);
  expectEqual(sealed.tag.length, 16);
  expectEqual(chacha20Poly1305Open(key, nonce, sealed.ciphertext, sealed.tag, new Uint8Array(0)).length, 0);
});

// ---------------------------------------------------------------------------
// SHA-256 / HMAC
// ---------------------------------------------------------------------------

suite('native crypto: SHA-256 and HMAC-SHA256');

test('matches the FIPS 180-4 SHA-256 vectors', () => {
  expectEqual(
    toHex(sha256(new TextEncoder().encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  expectEqual(
    toHex(sha256(new TextEncoder().encode(''))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('matches RFC 4231 HMAC-SHA256 test case 1', () => {
  const key = new Uint8Array(20).fill(0x0b);
  const data = new TextEncoder().encode('Hi There');
  expectEqual(
    toHex(hmacSha256(key, data)),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
  );
});

// ---------------------------------------------------------------------------
// The native KeyAgreement / BattleCipher pair
// ---------------------------------------------------------------------------

suite('native crypto: key agreement and AEAD cipher');

test('both peers derive the same session key', async () => {
  const client = new NativeKeyAgreement();
  const server = new NativeKeyAgreement();

  const clientPair = await client.generateClientKeyPair();
  const serverPair = await server.generateClientKeyPair();

  expectEqual(clientPair.publicKey.length, 32);
  expectEqual(clientPair.random.length, 32);
  expectEqual(serverPair.publicKey.length, 32);
  expectEqual(serverPair.random.length, 32);

  // The client derives from the server's public key; the server side derives
  // the same value from the client's public key and the same two randoms.
  const clientKey = await client.deriveSessionKey(
    serverPair.publicKey,
    clientPair.random,
    serverPair.random,
  );
  const serverKey = await server.deriveSessionKey(
    clientPair.publicKey,
    clientPair.random,
    serverPair.random,
  );

  expectEqual(clientKey.length, BATTLE_SESSION_KEY_BYTES);
  expectEqual(toHex(clientKey), toHex(serverKey));
});

test('the derived key differs for a different server public key', async () => {
  const client = new NativeKeyAgreement();
  const server = new NativeKeyAgreement();
  const other = new NativeKeyAgreement();
  const clientPair = await client.generateClientKeyPair();
  const serverPair = await server.generateClientKeyPair();
  const otherPair = await other.generateClientKeyPair();

  const good = await client.deriveSessionKey(serverPair.publicKey, clientPair.random, serverPair.random);
  const bad = await client.deriveSessionKey(otherPair.publicKey, clientPair.random, serverPair.random);
  expect(toHex(good) !== toHex(bad), 'a different server key must derive a different session key');
});

test('the derived key changes when a random changes', async () => {
  const client = new NativeKeyAgreement();
  const server = new NativeKeyAgreement();
  const clientPair = await client.generateClientKeyPair();
  const serverPair = await server.generateClientKeyPair();

  const first = await client.deriveSessionKey(serverPair.publicKey, clientPair.random, serverPair.random);
  const second = await client.deriveSessionKey(
    serverPair.publicKey,
    serverPair.random,
    clientPair.random,
  );
  expect(toHex(first) !== toHex(second), 'swapping the randoms must change the session key');
});

test('deriveSessionKey refuses to run before a key pair exists', async () => {
  const client = new NativeKeyAgreement();
  let threw = false;
  try {
    await client.deriveSessionKey(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32));
  } catch {
    threw = true;
  }
  expect(threw, 'deriveSessionKey must require a prior generateClientKeyPair');
});

test('the session key schedule matches the browser build', async () => {
  // The browser's `WebCryptoKeyAgreement` derives:
  //   shared  = X25519 deriveBits            (RFC 7748)
  //   session = HKDF-SHA256(ikm=shared,
  //                         salt=clientRandom||serverRandom,
  //                         info="phk-battle-v1", L=32)
  // Recompute that here with Node's own X25519 + HKDF implementations and
  // compare — that is what makes the native and browser clients agree on the
  // session key for the same handshake.
  const clientPrivate = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
  const serverPrivate = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
  const clientRandom = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  const serverRandom = hex('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f');

  const client = new NativeKeyAgreement(clientPrivate);
  const server = new NativeKeyAgreement(serverPrivate);
  const clientPair = await client.generateClientKeyPair();
  const serverPair = await server.generateClientKeyPair();

  // The public keys must match the browser's `generateKey` output for the
  // same private scalar.
  expectEqual(
    toHex(clientPair.publicKey),
    '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
  );
  expectEqual(
    toHex(serverPair.publicKey),
    'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
  );

  // Independently recompute the expected session key.
  const expected = nodeHmacHkdf(
    nodeX25519Shared(clientPrivate, serverPair.publicKey),
    concatBytes(clientRandom, serverRandom),
    asciiBytes(BATTLE_HKDF_INFO),
    BATTLE_SESSION_KEY_BYTES,
  );

  const actual = await client.deriveSessionKey(serverPair.publicKey, clientRandom, serverRandom);
  expectEqual(actual.length, BATTLE_SESSION_KEY_BYTES);
  expectEqual(toHex(actual), toHex(expected));
});

test('seals and opens across two cipher instances', async () => {
  const key = new Uint8Array(32).fill(21);
  const nonce = new Uint8Array(BATTLE_AEAD_NONCE_BYTES).fill(22);
  const aad = new Uint8Array(11).fill(23);
  const plaintext = new TextEncoder().encode('battle payload');

  const sender = new NativeChaCha20Poly1305Cipher(key);
  const receiver = new NativeChaCha20Poly1305Cipher(key);
  const sealed = await sender.seal(plaintext, aad, nonce);

  expectEqual(sealed.ciphertext.length, plaintext.length);
  expectEqual(sealed.authTag.length, BATTLE_AEAD_TAG_BYTES);
  expectEqual(sender.aead, BATTLE_AEAD_CHACHA20_POLY1305);

  const opened = await receiver.open(sealed.ciphertext, sealed.authTag, aad, nonce);
  expectEqual(toHex(opened), toHex(plaintext));
});

test('the cipher refuses a wrong-length session key', () => {
  let threw = false;
  try {
    new NativeChaCha20Poly1305Cipher(new Uint8Array(31));
  } catch {
    threw = true;
  }
  expect(threw, 'the cipher must reject a 31-byte session key');
});

test('createNativeBattleCrypto hands out a matching pair', async () => {
  const { keyAgreement, cipherFor } = createNativeBattleCrypto();
  expect(keyAgreement instanceof NativeKeyAgreement, 'the factory must return a NativeKeyAgreement');
  const cipher = cipherFor(new Uint8Array(32));
  expect(cipher instanceof NativeChaCha20Poly1305Cipher, 'the factory must return a native cipher');
  expectEqual(cipher.aead, BATTLE_AEAD_CHACHA20_POLY1305);
});

// ---------------------------------------------------------------------------
// Entropy
// ---------------------------------------------------------------------------

suite('native crypto: entropy');

test('fills the requested number of bytes', () => {
  expectEqual(nativeRandomBytes(0).length, 0);
  expectEqual(nativeRandomBytes(1).length, 1);
  expectEqual(nativeRandomBytes(32).length, 32);
  expectEqual(nativeRandomBytes(64).length, 64);
});

test('does not repeat itself', () => {
  const first = toHex(nativeRandomBytes(32));
  const second = toHex(nativeRandomBytes(32));
  expect(first !== second, 'two 32-byte draws must differ');
});

test('reports which entropy tier is in use', () => {
  const kind = randomSource();
  expect(
    kind === 'webcrypto' || kind === 'native-drbg',
    'randomSource must report a known tier',
  );
  // On this Node test host `crypto.getRandomValues` works, so the preferred
  // tier must be selected.
  expect(hasWorkingWebCryptoRandom(), 'Node exposes a working crypto.getRandomValues');
  expectEqual(kind, 'webcrypto');
});

// ---------------------------------------------------------------------------
// Byte-for-byte agreement with the C++ battle server
// ---------------------------------------------------------------------------

suite('native crypto: C++ server wire agreement');

test('the AEAD nonce matches the C++ DevAeadNonceHex', () => {
  // Golden values produced by compiling PhK-BattleServer/src/protocol.cpp's
  // DevAeadNonceHex verbatim (see tmp/fix-aead/crosscheck/crosscheck.cpp).
  expectEqual(
    devBattleNonceHex({
      keyId: 'hkdf-dev:client_to_server:0123456789abcdef0123456789abcdef',
      matchId: 'match-001',
      playerId: 'player-7',
      payloadType: 3,
      tick: 100,
      seq: 42,
      ack: 7,
    }),
    'cef3aa07bb64f0545cc84452',
  );
  expectEqual(
    devBattleNonceHex({
      keyId: '',
      matchId: '',
      playerId: '',
      payloadType: 0,
      tick: 0,
      seq: 0,
      ack: 0,
    }),
    '8fb8ad4214c50a6a4a8e48b0',
  );
  expectEqual(
    devBattleNonceHex({
      keyId: 'hkdf-dev:client_to_server:0123456789abcdef0123456789abcdef',
      matchId: 'match-002',
      playerId: 'player-7',
      payloadType: 3,
      tick: 100,
      seq: 43,
      ack: 7,
    }),
    '893cf21c76f67c488f510bfc',
  );
  expectEqual(
    devBattleNonceHex({
      keyId: 'hkdf-dev:client_to_server:0123456789abcdef0123456789abcdef',
      matchId: 'match-001',
      playerId: 'player-7',
      payloadType: 9,
      tick: 18446744073709551615n,
      seq: 42,
      ack: 7,
    }),
    '7417929beddcafa2bbeae788',
  );
});

test('the nonce has the shape the server requires', () => {
  const nonce = devBattleNonceHex({
    keyId: 'k',
    matchId: 'm',
    playerId: 'p',
    payloadType: 3,
    tick: 1,
    seq: 2,
    ack: 3,
  });
  // The server's HasExpectedAeadNonceShape wants exactly 24 hex characters,
  // i.e. a 12-byte nonce — which is also RFC 8439's ChaCha20-Poly1305 nonce.
  expectEqual(nonce.length, 24);
  expectEqual(nonce.length / 2, BATTLE_AEAD_NONCE_BYTES);
  expect(/^[0-9a-f]+$/.test(nonce), 'the nonce must be lowercase hex');
});

test('the handshake key reference matches the C++ DevHandshakeKeyRef', () => {
  // Golden values from the compiled server code.
  expectEqual(
    devHandshakeKeyRef('0123456789abcdef0123456789abcdef', 'client_to_server'),
    'hkdf-dev:client_to_server:8567b1ba6ac394988567b2ba6ac3964b',
  );
  expectEqual(
    devHandshakeKeyRef('0123456789abcdef0123456789abcdef', 'server_to_client'),
    'hkdf-dev:server_to_client:27bac5444980733027bac644498074e3',
  );
  expectEqual(
    devHandshakeKeyRef('', 'client_to_server'),
    'hkdf-dev:client_to_server:72440eb3b9e5cf6872440fb3b9e5d11b',
  );
});

test('the directional key references differ', () => {
  const c2s = devHandshakeKeyRef('0123456789abcdef0123456789abcdef', 'client_to_server');
  const s2c = devHandshakeKeyRef('0123456789abcdef0123456789abcdef', 'server_to_client');
  expect(c2s !== s2c, 'the two directions must not share a key reference');
});

test('the AAD binds the same header fields as the nonce', () => {
  const input = {
    keyId: 'hkdf-dev:client_to_server:0123456789abcdef0123456789abcdef',
    matchId: 'match-001',
    playerId: 'player-7',
    payloadType: 3,
    tick: 100,
    seq: 42,
    ack: 7,
  };
  const aad = devBattleAadBytes(input);
  // The AAD carries the direction label, three strings, and four u64 fields.
  expect(aad.length > 0, 'the AAD must not be empty');
  expectDeepEqual(
    Array.from(aad.slice(0, 'client_to_server'.length)),
    Array.from(new TextEncoder().encode('client_to_server')),
  );
  // A different header must produce a different AAD.
  const other = devBattleAadBytes({ ...input, seq: 43 });
  expect(toHex(other) !== toHex(aad), 'a different seq must change the AAD');
});
