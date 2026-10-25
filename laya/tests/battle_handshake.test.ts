/**
 * The battle AEAD handshake, and the switch staying off by default.
 *
 * The property that matters most is the *first* one: with no crypto provider the
 * client must behave exactly as it did before AEAD existed — a plaintext input
 * frame, on the wire synchronously. `MatchServer`, the deployed battle server,
 * decodes `BattleInput` straight off the wire and implements no handshake at
 * all, so anything else would silently break every live match.
 *
 * The rest drives the full `battle.proto` exchange against an in-memory
 * stand-in server: hello → accept → derived session key → sealed inputs → a
 * tampered frame rejected. All offline.
 */

import { bossRaceSeedFromU32 } from '../src/core/math/boss_race_seed';
import { BattleClient, type BattleSessionInfo } from '../src/core/net/battle_client';
import {
  decodeBattleInput,
  decodeEncryptedPacket,
  encodeHandshakeAccept,
  peekPayloadType,
} from '../src/core/net/battle_codec';
import {
  BATTLE_AEAD_CHACHA20_POLY1305,
  aeadHexToBytes,
  devBattleAadBytes,
  devBattleNonceHex,
  devHandshakeKeyRef,
  type BattleCipher,
  type KeyAgreement,
  type SealedPayload,
} from '../src/core/net/battle_crypto';
import { codec } from '../src/core/protocol/codec';
import {
  BattlePayloadType,
  emptyVersionStamp,
  type BattleHandshakeAccept,
  type BattleHandshakeHello,
} from '../src/core/protocol/types';
import { KcpSession } from '../src/core/net/kcp_transport';
import type {
  DatagramFactory,
  DatagramHandlers,
  DatagramLike,
  TimerLike,
} from '../src/core/net/transport';
import { expect, expectEqual, suite, test } from './harness';

// ---------------------------------------------------------------------------
// An in-memory channel, copied small enough to read.
// ---------------------------------------------------------------------------

class FakeTimer implements TimerLike {
  private current = 0;
  private nextHandle = 1;
  private readonly handles = new Map<number, { cb: () => void; interval: number; next: number }>();

  now(): number {
    return this.current;
  }

  setInterval(callback: () => void, intervalMs: number): number {
    const handle = this.nextHandle++;
    this.handles.set(handle, { cb: callback, interval: intervalMs, next: this.current + intervalMs });
    return handle;
  }

  clearInterval(handle: number): void {
    this.handles.delete(handle);
  }

  setTimeout(callback: () => void, delayMs: number): number {
    return this.setInterval(callback, delayMs);
  }

  clearTimeout(handle: number): void {
    this.clearInterval(handle);
  }

  advance(ms: number, onStep: () => void): void {
    const target = this.current + ms;
    while (this.current < target) {
      this.current += 1;
      for (const entry of [...this.handles.values()]) {
        if (this.current >= entry.next) {
          entry.next = this.current + entry.interval;
          entry.cb();
        }
      }
      onStep();
    }
  }
}

class ChannelDatagram implements DatagramLike {
  closed = false;
  private handlers: DatagramHandlers = {};

  constructor(
    private readonly inbox: Uint8Array[],
    private readonly peerInbox: Uint8Array[],
  ) {}

  send(data: Uint8Array): void {
    if (!this.closed) {
      this.peerInbox.push(data.slice());
    }
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.handlers.onClose?.();
    }
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }

  pump(): void {
    for (const datagram of this.inbox.splice(0, this.inbox.length)) {
      this.handlers.onMessage?.(datagram);
    }
  }
}

// ---------------------------------------------------------------------------
// A cipher and key agreement that are deterministic, not secure.
//
// The point is to prove the client feeds the right nonce and AAD in and gets
// the right bytes back — a real ChaCha20-Poly1305 would only make a failure
// harder to read.
// ---------------------------------------------------------------------------

function tagFor(key: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Uint8Array {
  const tag = new Uint8Array(16);
  for (let i = 0; i < aad.length; i += 1) {
    tag[i % 16] ^= aad[i];
  }
  for (let i = 0; i < nonce.length; i += 1) {
    tag[(i + 5) % 16] ^= nonce[i];
  }
  for (let i = 0; i < ciphertext.length; i += 1) {
    tag[(i + 11) % 16] ^= ciphertext[i];
  }
  tag[0] ^= key[0];
  return tag;
}

class FakeCipher implements BattleCipher {
  readonly aead = BATTLE_AEAD_CHACHA20_POLY1305;

  constructor(private readonly key: Uint8Array) {}

  async seal(plaintext: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<SealedPayload> {
    const ciphertext = new Uint8Array(plaintext.length);
    for (let i = 0; i < plaintext.length; i += 1) {
      ciphertext[i] = plaintext[i] ^ this.key[i % this.key.length];
    }
    return { ciphertext, authTag: tagFor(this.key, ciphertext, aad, nonce) };
  }

  async open(ciphertext: Uint8Array, authTag: Uint8Array, aad: Uint8Array, nonce: Uint8Array): Promise<Uint8Array> {
    const expected = tagFor(this.key, ciphertext, aad, nonce);
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i] !== authTag[i]) {
        throw new Error('auth tag mismatch');
      }
    }
    const plaintext = new Uint8Array(ciphertext.length);
    for (let i = 0; i < ciphertext.length; i += 1) {
      plaintext[i] = ciphertext[i] ^ this.key[i % this.key.length];
    }
    return plaintext;
  }
}

class FakeKeyAgreement implements KeyAgreement {
  readonly name = 'fake-x25519';

  async generateClientKeyPair(): Promise<{ publicKey: Uint8Array; random: Uint8Array }> {
    return { publicKey: fill(0x11), random: fill(0x22) };
  }

  async deriveSessionKey(
    serverPublicKey: Uint8Array,
    clientRandom: Uint8Array,
    serverRandom: Uint8Array,
  ): Promise<Uint8Array> {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) {
      key[i] = serverPublicKey[i] ^ clientRandom[i] ^ serverRandom[i];
    }
    return key;
  }
}

function fill(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

/** The session key `FakeKeyAgreement` derives from the fakes below. */
function sessionKey(): Uint8Array {
  return fill(0x33 ^ 0x22 ^ 0x44);
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** 32 lowercase hex characters — the shape `transcript_hash` has on the wire. */
const TRANSCRIPT = '0123456789abcdef0123456789abcdef';
const CLIENT_KEY_ID = devHandshakeKeyRef(TRANSCRIPT, 'client_to_server');
const SERVER_KEY_ID = devHandshakeKeyRef(TRANSCRIPT, 'server_to_client');

function serverAccept(): BattleHandshakeAccept {
  return {
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'match-1',
    playerId: 'p-1',
    serverX25519Pub: fill(0x33),
    serverRandom: fill(0x44),
    selectedAead: BATTLE_AEAD_CHACHA20_POLY1305,
    kcpConv: 24601,
    keyId: 'server-signing-key',
    transcriptHash: new TextEncoder().encode(TRANSCRIPT),
  };
}

function sessionInfo(): BattleSessionInfo {
  return {
    matchId: 'match-1',
    playerId: 'p-1',
    playerIds: ['p-1', 'p-2'],
    modeId: 'mvp_boss_race',
    rulesetVersion: 'mvp-boss-race-s0',
    endpoint: 'udp://battle:9000',
    serverSeed: bossRaceSeedFromU32(12345),
  };
}

/** Enough microtask turns for the async send/receive paths to settle. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

function fakeCrypto(): { keyAgreement: KeyAgreement; cipherFor: (key: Uint8Array) => BattleCipher } {
  return {
    keyAgreement: new FakeKeyAgreement(),
    cipherFor: (key: Uint8Array) => new FakeCipher(key),
  };
}

interface Harness {
  client: BattleClient;
  peer: KcpSession;
  step: () => void;
  /** Every frame the server side received, in order. */
  received: Uint8Array[];
}

function harness(crypto?: ReturnType<typeof fakeCrypto>): Harness {
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = [];
  const inboxB: Uint8Array[] = [];
  const datagramA = new ChannelDatagram(inboxA, inboxB);
  const datagramB = new ChannelDatagram(inboxB, inboxA);
  const conv = 24601;

  const client = new BattleClient({
    datagramFactory: { open: () => datagramA } as DatagramFactory,
    timer,
    convOverride: conv,
    ...(crypto === undefined ? {} : { crypto }),
  });
  client.connect(sessionInfo());

  const received: Uint8Array[] = [];
  const peer = new KcpSession(datagramB, timer, { conv, intervalMs: 10 });
  peer.onMessage((payload) => {
    received.push(payload);
  });

  return {
    client,
    peer,
    received,
    step: () =>
      timer.advance(25, () => {
        datagramA.pump();
        datagramB.pump();
      }),
  };
}

/** Runs the exchange to completion against the stand-in server. */
async function handshake(h: Harness): Promise<boolean> {
  const pending = h.client.performHandshake();
  await drain();
  h.step();
  h.step();
  h.peer.send(encodeHandshakeAccept(serverAccept()));
  h.step();
  h.step();
  return await pending;
}

suite('battle AEAD handshake');

test('the switch is off by default: inputs stay plaintext and synchronous', () => {
  const { client, step, received } = harness();
  // No crypto provider at all — which is every deployed build today.
  expectEqual(client.sendInput(1, 0x2, false, true, false), true, 'sendInput succeeds');
  step();
  expect(received.length === 1, `the server received a frame (got ${received.length})`);
  expectEqual(peekPayloadType(received[0]), BattlePayloadType.INPUT, 'it is a plaintext input frame');
  const decoded = decodeBattleInput(received[0]);
  expect(decoded !== null, 'and it decodes as a BattleInput');
  expectEqual(decoded?.tick, 1, 'with the tick the caller asked for');
});

test('a handshake is refused when the platform has no key agreement', async () => {
  const { client } = harness();
  expectEqual(await client.performHandshake(), false, 'no provider means no handshake');
});

test('the hello carries a public key, a random and the suites this build speaks', async () => {
  const h = harness(fakeCrypto());
  const pending = h.client.performHandshake();
  await drain();
  h.step();
  h.step();

  expect(h.received.length === 1, `the server received the hello (got ${h.received.length})`);
  expectEqual(peekPayloadType(h.received[0]), BattlePayloadType.HANDSHAKE_HELLO, 'it is a hello');
  const hello = codec.battleHandshakeHello.decode(h.received[0].subarray(1)) as BattleHandshakeHello;
  expectEqual(hello.clientX25519Pub.length, 32, 'the public key is 32 bytes');
  expectEqual(hello.clientRandom.length, 32, 'the random is 32 bytes');
  expect(hello.supportedAead.includes(BATTLE_AEAD_CHACHA20_POLY1305), 'ChaCha20-Poly1305 is offered');

  // Closing must settle the promise rather than leaving it pending forever.
  h.client.close();
  expectEqual(await pending, false, 'closing settles the handshake as failed');
});

test('an accepted handshake installs the cipher and seals every input after it', async () => {
  const h = harness(fakeCrypto());
  expectEqual(await handshake(h), true, 'the handshake completes');

  expectEqual(h.client.sendInput(7, 0x2, false, true, false), true, 'sendInput succeeds');
  await drain();
  h.step();
  h.step();

  const sealed = h.received[h.received.length - 1];
  expect(sealed !== undefined, 'the server received a frame');
  // A sealed frame is the bare protobuf envelope: no leading type byte, which
  // is what keeps it from being mistaken for a plaintext input frame.
  expect(peekPayloadType(sealed) !== BattlePayloadType.INPUT, 'it is not a plaintext input frame');
  const packet = decodeEncryptedPacket(sealed);
  expect(packet !== null, 'it decodes as a BattleEncryptedPacket');
  const header = packet?.header;
  expect(header !== undefined, 'the envelope carries a header');
  expectEqual(header?.payloadType as number, BattlePayloadType.INPUT, 'for an input');
  expectEqual(header?.seq, 1, 'with the frame sequence number');
  expectEqual(header?.tick, 7, 'and the tick — both are nonce material');
  expectEqual(header?.nonce.length, 12, 'the nonce is 12 bytes');
  expectEqual(packet?.authTag.length, 16, 'the auth tag is 16 bytes');
  expectEqual(header?.keyId, CLIENT_KEY_ID, 'the key id is the direction reference from the transcript');

  // The server does not decrypt today, but the client must have sealed with the
  // nonce it published, so a conformant peer can open the frame.
  const nonceInput = {
    keyId: CLIENT_KEY_ID,
    matchId: 'match-1',
    playerId: 'p-1',
    payloadType: BattlePayloadType.INPUT,
    tick: 7,
    seq: 1,
    ack: 0,
  };
  expectEqual(
    toHex(header?.nonce ?? new Uint8Array(0)),
    devBattleNonceHex(nonceInput, 'client_to_server'),
    'the published nonce is the one the header commits to',
  );
  const opened = await new FakeCipher(sessionKey()).open(
    packet?.ciphertext ?? new Uint8Array(0),
    packet?.authTag ?? new Uint8Array(0),
    devBattleAadBytes(nonceInput, 'client_to_server'),
    header?.nonce ?? new Uint8Array(0),
  );
  const decoded = decodeBattleInput(opened);
  expect(decoded !== null, 'opening recovers the plaintext input frame');
  expectEqual(decoded?.tick, 7, 'with the same tick');
});

test('a sealed frame whose tag does not verify is dropped, not downgraded', async () => {
  const h = harness(fakeCrypto());
  expectEqual(await handshake(h), true, 'the handshake completes');

  // A snapshot the attacker altered: right shape, wrong tag.
  const nonce = aeadHexToBytes(
    devBattleNonceHex(
      {
        keyId: SERVER_KEY_ID,
        matchId: 'match-1',
        playerId: 'p-1',
        payloadType: BattlePayloadType.SNAPSHOT,
        tick: 1,
        seq: 1,
        ack: 0,
      },
      'server_to_client',
    ),
  );
  const body = new TextEncoder().encode('{"tick":1}');
  const sealed = await new FakeCipher(sessionKey()).seal(body, new Uint8Array(0), nonce);
  sealed.authTag[0] ^= 0xff;
  h.peer.send(
    codec.battleEncryptedPacket.encode({
      header: {
        version: { ...emptyVersionStamp(), protocolVersion: 1 },
        matchId: 'match-1',
        playerId: 'p-1',
        tick: 1,
        seq: 1,
        ack: 0,
        payloadType: BattlePayloadType.SNAPSHOT,
        keyId: SERVER_KEY_ID,
        nonce,
      },
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
    }),
  );
  h.step();
  h.step();
  await drain();

  expectEqual(h.client.lastError, 'battle_auth_tag_invalid', 'the failure is recorded');
  expectEqual(h.client.metrics.snapshotsReceived, 0, 'and the snapshot was not applied');
});
