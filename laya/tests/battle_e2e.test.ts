/**
 * Battle E2E tests — the whole chain the product runs, minus the live network.
 *
 * Two layers are covered here:
 *
 *  1. **Codec edge cases** pinned against the C++ server's hand-rolled codec
 *     (`PhK-BattleServer/src/match_lifecycle.cpp`): empty payloads, truncated
 *     frames at every prefix, bad type bytes, bad protocol versions, oversized
 *     strings, the u64 safe range, and the two spots where the client's decode
 *     discipline must match the server's exactly (a truncated card block is a
 *     malformed frame, not a legacy one; `chain_id` is a JSON **number** on the
 *     server wire).
 *
 *  2. **A full input loop**: a `BattleClient` wired to an in-memory channel on
 *     one side and a `BossRaceSimulation` standing in for the battle server on
 *     the other. Every input the client submits (movement / focus / shoot /
 *     bomb / card actions) is encoded by `battle_codec`, carried through KCP,
 *     decoded and fed to the server-side simulation; every server tick is
 *     broadcast back as a snapshot payload in the server's JSON shape and
 *     reconciled by the client. The assertions are the E2E contract: the
 *     prediction reproduces the server simulation tick for tick — same
 *     positions, same HP, same canonical state hash, no hard snaps — and the
 *     final `RESULT` payload arrives with the winner the server simulation
 *     computed.
 *
 * Everything runs offline: no sockets, no servers, no wall clock.
 */

import { bossRaceSeedFromU32 } from '../src/core/math/boss_race_seed';
import {
  BattleClient,
  BattleConnectionState,
  type BattleSessionInfo,
} from '../src/core/net/battle_client';
import {
  ByteReader,
  decodeBattleInput,
  decodeBattleResult,
  decodeBossRaceSnapshot,
  decodeCoopBossSnapshot,
  encodeBattleInput,
  encodeBattleInputWithTicket,
  peekPayloadType,
  type BattleResultPayload,
} from '../src/core/net/battle_codec';
import { KcpSession } from '../src/core/net/kcp_transport';
import type {
  DatagramFactory,
  DatagramHandlers,
  DatagramLike,
  TimerLike,
} from '../src/core/net/transport';
import { BattlePayloadType, emptyVersionStamp, type BattleInput } from '../src/core/protocol/types';
import {
  BossRaceSimulation,
  BossRaceState,
  bossRaceConfigForRuleset,
} from '../src/core/sim/boss_race';
import { Lcg, expect, expectEqual, suite, test } from './harness';

// ---------------------------------------------------------------------------
// codec edge cases (server parity)
// ---------------------------------------------------------------------------

function fullInput(): BattleInput {
  return {
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'm1',
    playerId: 'p1',
    tick: 7,
    seq: 3,
    directionBits: 0x5,
    slow: false,
    shoot: true,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  };
}

/** A minimal `battle.ticket` response payload, as the lobby signs it. */
function ticketRaw(): Record<string, unknown> {
  return {
    signature_alg: 'ED25519',
    key_id: 'lobby-key-1',
    signature: 'aabb',
    public_key_hex: 'ccdd',
    server_authoritative: true,
    ticket: {
      version: { protocol_version: 1, business_api_version: 'v1', battle_api_version: 'b1', ruleset_version: 'ruleset-local-s0' },
      ticket_id: 'tk-1',
      match_id: 'm1',
      user_id: 'u-42',
      player_id: 'p1',
      mode_id: 'mvp_boss_race',
      battle_server_id: 'bs-1',
      endpoint: '10.0.0.1:7400',
      deck_snapshot_hash: 'deck',
      ruleset_version: 'ruleset-local-s0',
      ticket_nonce_hex: 'nonce',
      issued_at_ms: 1700000000000,
      expires_at_ms: 1700003600000,
      business_session_id: 'sess-1',
      hand_card_ids: ['c1'],
      deck_card_ids: ['d1'],
      initial_energy: 3,
      server_seed: '12345678901234567890',
    },
  };
}

function snapshotPayload(body: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const payload = new Uint8Array(json.length + 1);
  payload[0] = BattlePayloadType.SNAPSHOT;
  payload.set(json, 1);
  return payload;
}

suite('battle codec edge cases (server parity)');

test('an empty payload is rejected by every decoder', () => {
  const empty = new Uint8Array(0);
  expectEqual(peekPayloadType(empty), BattlePayloadType.UNSPECIFIED, 'no byte → UNSPECIFIED');
  expectEqual(decodeBattleInput(empty), null, 'empty input payload');
  expectEqual(decodeBossRaceSnapshot(empty), null, 'empty snapshot payload');
  expectEqual(decodeCoopBossSnapshot(empty), null, 'empty coop snapshot payload');
  expectEqual(decodeBattleResult(empty), null, 'empty result payload');
});

test('every truncated prefix of a full frame decodes or rejects, never throws', () => {
  // The longest frame the client can produce: input body + card block + ticket.
  const frame = encodeBattleInputWithTicket(
    { ...fullInput(), cardDraw: true, cardSelect: 3, cardUse: true },
    ticketRaw(),
  );
  for (let cut = 0; cut <= frame.length; cut += 1) {
    const prefix = frame.subarray(0, cut);
    let decoded: BattleInput | null = null;
    let threw = false;
    try {
      decoded = decodeBattleInput(prefix);
    } catch {
      threw = true;
    }
    expect(!threw, `prefix ${cut}/${frame.length} must not throw`);
    if (decoded !== null) {
      expectEqual(decoded.matchId, 'm1', `prefix ${cut} must keep the match id`);
      expectEqual(decoded.playerId, 'p1', `prefix ${cut} must keep the player id`);
    }
  }
});

test('a truncated card block is malformed, not a legacy frame (server parity)', () => {
  // The C++ ReadBattleInputBody hard-fails a magic byte without its three
  // payload bytes; the client must reject too, or it would act on a frame the
  // server dropped.
  const base = encodeBattleInput(fullInput());
  for (let trailing = 0; trailing <= 2; trailing += 1) {
    const bytes = new Uint8Array(base.length + 1 + trailing);
    bytes.set(base, 0);
    bytes[base.length] = 0x43; // the magic, but the block is incomplete
    expectEqual(
      decodeBattleInput(bytes),
      null,
      `magic + ${trailing} trailing byte(s) must reject`,
    );
  }
  // Exactly four trailing bytes (magic + 3) is a complete block and must parse.
  const complete = new Uint8Array(base.length + 4);
  complete.set(base, 0);
  complete[base.length] = 0x43;
  complete[base.length + 1] = 1;
  complete[base.length + 2] = 2;
  complete[base.length + 3] = 1;
  const decoded = decodeBattleInput(complete);
  expect(decoded !== null, 'a complete card block must decode');
  expectEqual(decoded!.cardDraw, true);
  expectEqual(decoded!.cardSelect, 2);
  expectEqual(decoded!.cardUse, true);
});

test('a ticket block is never mistaken for a card block', () => {
  // The ticket block opens with a presence byte of 0/1 — never the 0x43 magic —
  // so a frame carrying a signed ticket must decode with no card fields.
  const frame = encodeBattleInputWithTicket(fullInput(), ticketRaw());
  const decoded = decodeBattleInput(frame);
  expect(decoded !== null, 'the ticket frame must still decode as an input');
  expectEqual(decoded!.cardDraw, undefined);
  expectEqual(decoded!.cardSelect, undefined);
  expectEqual(decoded!.cardUse, undefined);
  expectEqual(decoded!.shoot, true, 'the body fields survive the ticket tail');
});

test('a wrong payload type byte is rejected, not misparsed', () => {
  const frame = encodeBattleInput(fullInput());
  for (const type of [
    BattlePayloadType.UNSPECIFIED,
    BattlePayloadType.HANDSHAKE_HELLO,
    BattlePayloadType.SNAPSHOT,
    BattlePayloadType.RESULT,
    BattlePayloadType.COOP_SNAPSHOT,
    0xff,
  ]) {
    const bad = frame.slice();
    bad[0] = type;
    expectEqual(decodeBattleInput(bad), null, `type byte ${type} must not decode as an input`);
  }
});

test('a bad protocol version still decodes — the server rejects it at SubmitInput, not in the codec', () => {
  // Pins the deliberate split: the client codec is lenient about
  // protocol_version (the C++ server enforces VersionStamp::IsCompatible in
  // BossRaceSimulation::SubmitInput, never in ReadBattleInputBody).
  for (const protocolVersion of [0, 2, 0xffffffff]) {
    const frame = encodeBattleInput({ ...fullInput(), version: { ...emptyVersionStamp(), protocolVersion } });
    const decoded = decodeBattleInput(frame);
    expect(decoded !== null, `version ${protocolVersion} must round-trip`);
    expectEqual(decoded!.version?.protocolVersion, protocolVersion);
  }
});

test('an oversized string is capped at the server 0xffff limit, not corrupted', () => {
  // The server's PushString caps at 0xffff (match_lifecycle.cpp); the client's
  // ByteWriter.string must do the same or the u16 length prefix would lie.
  const long = 'a'.repeat(70000);
  const frame = encodeBattleInput({ ...fullInput(), modeActionId: long });
  const reader = new ByteReader(frame);
  reader.u8(); // type
  reader.u32(); // version
  reader.string(); // match id
  reader.string(); // player id
  reader.u64(); // tick
  reader.u64(); // seq
  reader.u32(); // direction
  reader.u8(); // flags
  reader.i8(); // card slot
  // `string()` reads the u16 prefix itself; the capped value proves the writer
  // clamped 70000 bytes down to the server's 0xffff limit.
  expectEqual(reader.string().length, 0xffff, 'the length prefix must be the capped value');
  expectEqual(reader.remaining, 0, 'the frame must end exactly at the cap');
  const decoded = decodeBattleInput(frame);
  expect(decoded !== null, 'the capped frame must still decode');
  expectEqual(decoded!.modeActionId.length, 0xffff);

  // A string exactly at the limit round-trips whole.
  const exact = 'b'.repeat(0xffff);
  const decodedExact = decodeBattleInput(encodeBattleInput({ ...fullInput(), modeActionId: exact }));
  expect(decodedExact !== null, 'the at-limit string must decode');
  expectEqual(decodedExact!.modeActionId, exact);
});

test('u64 fields are exact across the range a match can reach', () => {
  // Ticks and seqs are far below 2^53; pin exactness there. Beyond it a JS
  // number cannot hold a u64 at all — the writer must degrade to a well-formed
  // frame rather than throw.
  const tick = 9007199254740991; // 2^53 - 1
  const decoded = decodeBattleInput(encodeBattleInput({ ...fullInput(), tick, seq: tick }));
  expect(decoded !== null, 'the at-range tick must decode');
  expectEqual(decoded!.tick, tick);
  expectEqual(decoded!.seq, tick);

  const huge = encodeBattleInput({ ...fullInput(), tick: 2 ** 64 - 1 });
  expectEqual(huge.length, encodeBattleInput(fullInput()).length, 'the frame keeps its shape');
  const decodedHuge = decodeBattleInput(huge);
  expect(decodedHuge !== null, 'a >2^53 tick degrades, it does not corrupt the frame');
});

test('random bytes never crash any decoder', () => {
  const rng = new Lcg(987654321);
  for (let i = 0; i < 500; i += 1) {
    const length = 1 + Math.floor(rng.next() * 90);
    const bytes = new Uint8Array(length);
    for (let j = 0; j < length; j += 1) {
      bytes[j] = Math.floor(rng.next() * 256);
    }
    let threw = false;
    try {
      decodeBattleInput(bytes);
      decodeBossRaceSnapshot(bytes);
      decodeCoopBossSnapshot(bytes);
      decodeBattleResult(bytes);
    } catch {
      threw = true;
    }
    expect(!threw, `random payload ${i} must not throw`);
  }
});

test('the server numeric chain_id decodes as its decimal text', () => {
  // The C++ server writes chain_id with std::to_string(uint32_t) — a JSON
  // number, on both bullets and chains (boss_race.hpp:208 / :157).
  const race = decodeBossRaceSnapshot(
    snapshotPayload({
      tick: 90,
      state: 'running',
      winner_player_id: '',
      winner_tick: 0,
      state_hash: 'h',
      players: [],
      bullets: [
        {
          bullet_id: 'b1',
          owner_player_id: 'p1',
          x_milli: 0,
          y_milli: 0,
          vx_milli: 0,
          vy_milli: 0,
          radius_milli: 4000,
          chain_id: 7,
          generation: 1,
          hidden: false,
          pattern_id: 'ring',
        },
      ],
      chains: [{ chain_id: 3, pattern_index: 0, node_id: 0, generation: 0, rng_cursor: 0 }],
    }),
  );
  expect(race !== null, 'the race snapshot must decode');
  expectEqual(race!.bullets[0].chainId, '7', 'bullet chain_id is a number on the wire');
  expectEqual(race!.chains?.[0].chainId, '3', 'chain chain_id is a number on the wire');

  const coop = decodeCoopBossSnapshot(
    (() => {
      const json = new TextEncoder().encode(
        JSON.stringify({
          tick: 5,
          state: 'running',
          boss_hp: 100,
          boss_max_hp: 100,
          seat_count: 2,
          shield_dir_mask: 0,
          lock_dir: 0,
          lock_until_tick: 0,
          spiral_active: false,
          state_hash: 'h',
          players: [],
          bullets: [
            {
              bullet_id: 'c1',
              owner_player_id: 'p1',
              x_milli: 0,
              y_milli: 0,
              vx_milli: 0,
              vy_milli: 0,
              radius_milli: 4000,
              kind: 1,
              chain_id: 12,
              pattern_id: 'ring',
            },
          ],
        }),
      );
      const payload = new Uint8Array(json.length + 1);
      payload[0] = BattlePayloadType.COOP_SNAPSHOT;
      payload.set(json, 1);
      return payload;
    })(),
  );
  expect(coop !== null, 'the coop snapshot must decode');
  expectEqual(coop!.bullets[0].chainId, '12', 'coop bullets carry the numeric chain_id too');
});

test('an absent chain_id stays undefined; a text one is kept verbatim', () => {
  const absent = decodeBossRaceSnapshot(
    snapshotPayload({
      tick: 1,
      state: 'running',
      winner_player_id: '',
      winner_tick: 0,
      state_hash: 'h',
      players: [],
      bullets: [{ bullet_id: 'b1', owner_player_id: 'p1', x_milli: 0, y_milli: 0, vx_milli: 0, vy_milli: 0, radius_milli: 4000, pattern_id: 'ring' }],
    }),
  );
  expect(absent !== null, 'the legacy snapshot must decode');
  expectEqual(absent!.bullets[0].chainId, undefined, 'an old server that predates the field');

  const text = decodeBossRaceSnapshot(
    snapshotPayload({
      tick: 1,
      state: 'running',
      winner_player_id: '',
      winner_tick: 0,
      state_hash: 'h',
      players: [],
      bullets: [{ bullet_id: 'b1', owner_player_id: 'p1', x_milli: 0, y_milli: 0, vx_milli: 0, vy_milli: 0, radius_milli: 4000, chain_id: 'ring-1', pattern_id: 'ring' }],
    }),
  );
  expect(text !== null, 'the text chain_id snapshot must decode');
  expectEqual(text!.bullets[0].chainId, 'ring-1');
});

test('unknown snapshot fields are tolerated for forward compatibility', () => {
  // The server already writes `vanish_tick` on bullets, which this client does
  // not model; an unknown field must never break the decode.
  const decoded = decodeBossRaceSnapshot(
    snapshotPayload({
      tick: 3,
      state: 'running',
      winner_player_id: '',
      winner_tick: 0,
      state_hash: 'h',
      players: [],
      bullets: [
        {
          bullet_id: 'b1',
          owner_player_id: 'p1',
          x_milli: 0,
          y_milli: 0,
          vx_milli: 0,
          vy_milli: 0,
          radius_milli: 4000,
          pattern_id: 'ring',
          vanish_tick: 4242,
          some_future_field: { nested: true },
        },
      ],
      a_future_top_level_field: 'ignored',
    }),
  );
  expect(decoded !== null, 'the forward-compat snapshot must decode');
  expectEqual(decoded!.bullets[0].bulletId, 'b1');
});

// ---------------------------------------------------------------------------
// full input loop: client ↔ server simulation over the real wire path
// ---------------------------------------------------------------------------

/** Mirrors the FakeTimer in battle_client_input.test.ts (shared fake clock). */
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

  /** Advances `ms`, firing due timers and letting `onStep` pump the channel. */
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

/** In-memory datagram wired to a peer inbox; every send lands in `peerInbox`. */
class ChannelDatagram implements DatagramLike {
  closed = false;
  private handlers: DatagramHandlers = {};

  constructor(
    private readonly inbox: Uint8Array[],
    private readonly peerInbox: Uint8Array[],
  ) {}

  send(data: Uint8Array): void {
    if (this.closed) {
      return;
    }
    this.peerInbox.push(data.slice());
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.handlers.onClose?.();
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }

  pump(): void {
    const pending = this.inbox.splice(0, this.inbox.length);
    for (const datagram of pending) {
      this.handlers.onMessage?.(datagram);
    }
  }
}

/** Session info for the synthetic bullet model (the legacy race ruleset). */
function sessionInfo(playerId: string, playerIds: string[]): BattleSessionInfo {
  return {
    matchId: 'match-1',
    playerId,
    playerIds,
    modeId: 'mvp_boss_race',
    rulesetVersion: 'mvp-boss-race-s0',
    endpoint: 'udp://battle:9000',
    serverSeed: bossRaceSeedFromU32(12345),
  };
}

function stateName(state: BossRaceState): string {
  switch (state) {
    case BossRaceState.Running:
      return 'running';
    case BossRaceState.Finished:
      return 'finished';
    default:
      return 'waiting';
  }
}

/**
 * Encodes a snapshot the way the server's `EncodeBossRaceSnapshotPayload`
 * does: type byte 4, then the JSON body (legacy field set — the §2.8 fields
 * are optional on the wire and covered by the codec suite above).
 */
function serverSnapshotPayload(snapshot: ReturnType<BossRaceSimulation['snapshot']>): Uint8Array {
  const body = {
    tick: snapshot.tick,
    state: stateName(snapshot.state),
    winner_player_id: snapshot.winnerPlayerId,
    winner_tick: snapshot.winnerTick,
    state_hash: snapshot.stateHash,
    players: snapshot.players.map((player) => ({
      player_id: player.playerId,
      x_milli: player.xMilli,
      y_milli: player.yMilli,
      boss_current_hp: player.bossCurrentHp,
      damage_dealt: player.damageDealt,
      connected: player.connected,
    })),
    bullets: snapshot.bullets.map((bullet) => ({
      bullet_id: bullet.bulletId,
      owner_player_id: bullet.ownerPlayerId,
      x_milli: bullet.xMilli,
      y_milli: bullet.yMilli,
      vx_milli: bullet.vxMilli,
      vy_milli: bullet.vyMilli,
      radius_milli: bullet.radiusMilli,
      pattern_id: bullet.patternId,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(body));
  const payload = new Uint8Array(json.length + 1);
  payload[0] = BattlePayloadType.SNAPSHOT;
  payload.set(json, 1);
  return payload;
}

/** Encodes the final result the way the server's `BuildMatchResultJson` does. */
function serverResultPayload(sim: BossRaceSimulation, matchId: string, seed: number): Uint8Array {
  const snapshot = sim.snapshot();
  const body = {
    match_id: matchId,
    mode_id: 'mvp_boss_race',
    ruleset_version: 'mvp-boss-race-s0',
    match_seed: seed,
    winner_player_id: snapshot.winnerPlayerId,
    winner_tick: snapshot.winnerTick,
    state_hash: sim.canonicalStateHash(),
    players: snapshot.players.map((player) => ({
      player_id: player.playerId,
      damage_dealt: player.damageDealt,
      boss_current_hp: player.bossCurrentHp,
    })),
  };
  const json = new TextEncoder().encode(JSON.stringify(body));
  const payload = new Uint8Array(json.length + 1);
  payload[0] = BattlePayloadType.RESULT;
  payload.set(json, 1);
  return payload;
}

suite('battle E2E: input → wire → server simulation → snapshot → prediction');

test('the client prediction reproduces the server simulation tick for tick over the wire path', () => {
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = []; // client → server
  const inboxB: Uint8Array[] = []; // server → client
  const datagramA = new ChannelDatagram(inboxA, inboxB);
  const datagramB = new ChannelDatagram(inboxB, inboxA);
  const conv = 24601;

  const client = new BattleClient({
    datagramFactory: { open: () => datagramA } as DatagramFactory,
    timer,
    convOverride: conv,
  });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);
  expectEqual(client.state, BattleConnectionState.Running);

  // The server side: the same simulation the C++ MatchServer runs, with the
  // same spawn rule (player_ids[i] at ((i % 2) ? 20000 : -20000, 60000)).
  const serverSim = new BossRaceSimulation(
    bossRaceConfigForRuleset('match-1', 12345, 'mvp-boss-race-s0'),
  );
  serverSim.addPlayer('p-1', -20000, 60000);
  serverSim.addPlayer('p-2', 20000, 60000);

  // Everything the server actually applied, decoded from the client's frames.
  const serverInputs: BattleInput[] = [];
  const peer = new KcpSession(datagramB, timer, { conv, intervalMs: 10 });
  peer.onMessage((payload) => {
    const decoded = decodeBattleInput(payload);
    if (decoded === null) {
      return;
    }
    serverInputs.push(decoded);
    serverSim.submitInput({
      playerId: decoded.playerId,
      tick: decoded.tick,
      seq: decoded.seq,
      directionBits: decoded.directionBits,
      slow: decoded.slow,
      shoot: decoded.shoot,
      bomb: decoded.bomb,
      cardSlot: decoded.cardSlot,
      modeActionId: decoded.modeActionId,
    });
  });

  // One step moves the fake clock far enough for both KCP sessions to flush
  // and drain in each direction.
  const step = (): void => timer.advance(25, () => {
    datagramA.pump();
    datagramB.pump();
  });

  let result: BattleResultPayload | null = null;
  client.onResult((payload) => {
    result = payload;
  });

  // p-1 shoots every tick: 6000 boss HP / 10 damage per tick = the match ends
  // at tick 600 with p-1 the winner (sorted player ids, first to zero).
  const totalTicks = 610;
  for (let tick = 1; tick <= totalTicks; tick += 1) {
    const cardTick = tick % 53 === 0;
    const cardDrawTick = tick % 97 === 0;
    expectEqual(
      client.sendInput(
        tick,
        tick % 6 < 3 ? 0x2 : 0x8, // right / left, three ticks each
        tick % 11 === 0, // focus (slow) — no effect in the race model
        true, // shoot every tick
        tick % 37 === 0, // bomb
        cardTick ? 2 : -1, // card_slot — ignored by the race simulation
        cardTick ? 'act-card' : '',
        cardDrawTick, // card_draw
        cardTick ? 1 : -1, // card_select
        cardTick, // card_use
      ),
      true,
      `sendInput at tick ${tick}`,
    );
    step(); // the input frame reaches the server

    if (serverSim.getState() === BossRaceState.Finished) {
      break;
    }
    serverSim.tick();
    if (serverSim.getState() === BossRaceState.Finished) {
      // MatchServer::AdvanceTick stops broadcasting snapshots once finished and
      // submits the result instead.
      peer.send(serverResultPayload(serverSim, 'match-1', 12345));
    } else {
      peer.send(serverSnapshotPayload(serverSim.snapshot()));
    }
    step(); // the snapshot / result reaches the client

    if (serverSim.getState() === BossRaceState.Finished) {
      break;
    }

    // --- the per-tick E2E contract -------------------------------------
    expectEqual(client.metrics.snapshotsReceived, tick, `snapshot ${tick} reached the client`);
    expectEqual(client.simulationRef?.getCurrentTick(), tick, `the prediction is at tick ${tick}`);
    expectEqual(client.metrics.hashMatches, tick, `the state hash matched at tick ${tick}`);
    expectEqual(client.metrics.hashMismatches, 0, `no hash mismatch through tick ${tick}`);
    expectEqual(client.metrics.hardSnaps, 0, `no hard snap through tick ${tick}`);
    expectEqual(client.metrics.maxPositionErrorMilli, 0, `no position error through tick ${tick}`);

    const serverSnapshot = serverSim.snapshot();
    const localSnapshot = client.simulationRef?.snapshot();
    expect(localSnapshot !== undefined, 'the prediction exists');
    for (const serverPlayer of serverSnapshot.players) {
      const local = localSnapshot!.players.find((player) => player.playerId === serverPlayer.playerId);
      expect(local !== undefined, `the prediction tracks ${serverPlayer.playerId}`);
      expectEqual(local!.xMilli, serverPlayer.xMilli, `tick ${tick} ${serverPlayer.playerId} x`);
      expectEqual(local!.yMilli, serverPlayer.yMilli, `tick ${tick} ${serverPlayer.playerId} y`);
      expectEqual(local!.bossCurrentHp, serverPlayer.bossCurrentHp, `tick ${tick} ${serverPlayer.playerId} hp`);
      expectEqual(local!.damageDealt, serverPlayer.damageDealt, `tick ${tick} ${serverPlayer.playerId} damage`);
    }
    // The bullet sets must agree too — the hash already folds every bullet in,
    // but assert the count so a failure says which side drifted.
    expectEqual(
      localSnapshot!.bullets.length,
      serverSnapshot.bullets.length,
      `tick ${tick} bullet count`,
    );
  }

  // --- the final result ---------------------------------------------------
  expectEqual(client.state, BattleConnectionState.Finished, 'the result payload finished the client');
  expect(result !== null, 'the client received the result payload');
  expectEqual(result!.matchId, 'match-1');
  expectEqual(result!.modeId, 'mvp_boss_race');
  expectEqual(result!.winnerPlayerId, 'p-1');
  expectEqual(result!.winnerTick, 600);
  expectEqual(result!.players.length, 2);
  const winner = result!.players.find((player) => player.playerId === 'p-1');
  expectEqual(winner?.damageDealt, 6000, '600 ticks × 10 damage');
  expectEqual(winner?.bossCurrentHp, 0);
  const other = result!.players.find((player) => player.playerId === 'p-2');
  expectEqual(other?.damageDealt, 0, 'the idle player never damaged the boss');
  expectEqual(other?.bossCurrentHp, 6000);

  // --- wire fidelity ------------------------------------------------------
  expectEqual(serverInputs.length, 600, 'every input frame arrived and decoded');
  expectEqual(serverInputs[0].playerId, 'p-1');
  expectEqual(serverInputs[0].tick, 1);
  expectEqual(serverInputs[0].shoot, true);
  const cardFrames = serverInputs.filter((input) => input.tick % 53 === 0);
  expect(cardFrames.length > 0, 'card ticks were sent');
  expectEqual(cardFrames[0].cardSlot, 2, 'card_slot rode the wire');
  expectEqual(cardFrames[0].cardSelect, 1, 'card_select rode the wire');
  expectEqual(cardFrames[0].cardUse, true, 'card_use rode the wire');
  const drawFrames = serverInputs.filter((input) => input.tick % 97 === 0);
  expect(drawFrames.length > 0, 'draw ticks were sent');
  expectEqual(drawFrames[0].cardDraw, true, 'card_draw rode the wire');
  // And the race simulation ignored them: with cardMechanics at its default
  // false (server parity — boss_race.cpp never reads card_slot), the card ticks
  // moved and damaged exactly like every other tick, which the per-tick
  // position/hash assertions above already prove.

  expectEqual(client.metrics.hashMatches, 599, '599 snapshots, all hashes matching');
  expectEqual(client.metrics.hashMismatches, 0);
  expectEqual(client.metrics.hardSnaps, 0);

  client.close();
  peer.close();
});

test('a prediction that drifts is corrected by the snapshot reconciliation', () => {
  // Guards the other half of the E2E contract: when the local prediction is
  // knocked off the server state (a hard snap), the next snapshot reseeds it
  // and the hash agrees again — no permanent divergence.
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = [];
  const inboxB: Uint8Array[] = [];
  const datagramA = new ChannelDatagram(inboxA, inboxB);
  const datagramB = new ChannelDatagram(inboxB, inboxA);
  const conv = 13579;

  const client = new BattleClient({
    datagramFactory: { open: () => datagramA } as DatagramFactory,
    timer,
    convOverride: conv,
  });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);

  const serverSim = new BossRaceSimulation(
    bossRaceConfigForRuleset('match-1', 12345, 'mvp-boss-race-s0'),
  );
  serverSim.addPlayer('p-1', -20000, 60000);
  serverSim.addPlayer('p-2', 20000, 60000);

  const peer = new KcpSession(datagramB, timer, { conv, intervalMs: 10 });
  peer.onMessage((payload) => {
    const decoded = decodeBattleInput(payload);
    if (decoded !== null) {
      serverSim.submitInput({
        playerId: decoded.playerId,
        tick: decoded.tick,
        seq: decoded.seq,
        directionBits: decoded.directionBits,
        slow: decoded.slow,
        shoot: decoded.shoot,
        bomb: decoded.bomb,
        cardSlot: decoded.cardSlot,
        modeActionId: decoded.modeActionId,
      });
    }
  });

  const step = (): void => timer.advance(25, () => {
    datagramA.pump();
    datagramB.pump();
  });

  // Ten quiet ticks seed the prediction.
  for (let tick = 1; tick <= 10; tick += 1) {
    client.sendInput(tick, 0, false, false, false);
    step();
    serverSim.tick();
    peer.send(serverSnapshotPayload(serverSim.snapshot()));
    step();
  }
  expectEqual(client.metrics.snapshotsReceived, 10);
  expectEqual(client.metrics.hashMatches, 10);

  // Knock the local prediction far off the server state, then let one more
  // snapshot arrive: the error exceeds the hard-snap threshold, so the client
  // must adopt the server state and stop drifting.
  client.simulationRef?.adoptAuthoritativeSnapshot(
    {
      tick: client.simulationRef!.getCurrentTick(),
      state: BossRaceState.Running,
      winnerPlayerId: '',
      winnerTick: 0,
      players: [
        {
          playerId: 'p-1',
          xMilli: 119000,
          yMilli: -89000,
          bossCurrentHp: 6000,
          damageDealt: 0,
          connected: true,
        },
        {
          playerId: 'p-2',
          xMilli: 20000,
          yMilli: 60000,
          bossCurrentHp: 6000,
          damageDealt: 0,
          connected: true,
        },
      ],
      bullets: [],
      stateHash: '',
    },
  );

  client.sendInput(11, 0, false, false, false);
  step();
  serverSim.tick();
  peer.send(serverSnapshotPayload(serverSim.snapshot()));
  step();

  expectEqual(client.metrics.snapshotsReceived, 11, 'the post-snap snapshot arrived');
  expectEqual(client.metrics.hardSnaps, 1, 'the drift was snapped away');
  expectEqual(client.metrics.hashMatches, 11, 'and the prediction agrees with the server again');
  const local = client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1');
  expectEqual(local?.xMilli, -20000, 'the snap put the ship back on the server state');
  expectEqual(local?.yMilli, 60000);

  client.close();
  peer.close();
});
