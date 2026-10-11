/**
 * Battle input-chain regression tests.
 *
 * These pin the three failure modes behind "entered the battle scene but the
 * ship does not move":
 *  1. a missing local roster id must not crash the client — `submitInput` is a
 *     no-op for an unknown player and `sendInput` must stay non-throwing;
 *  2. an offline / throwing channel must degrade to a dropped datagram and
 *     never stall the input chain or the local prediction;
 *  3. a healthy channel must actually carry the encoded `BattleInput` through
 *     KCP so the server can consume it.
 */

import { bossRaceSeedFromU32 } from '../src/core/math/boss_race_seed';
import { BattleClient, BattleConnectionState, type BattleSessionInfo } from '../src/core/net/battle_client';
import { decodeBattleInput } from '../src/core/net/battle_codec';
import { BattlePayloadType } from '../src/core/protocol/types';
import { KcpSession } from '../src/core/net/kcp_transport';
import {
  OfflineDatagramFactory,
  type DatagramFactory,
  type DatagramHandlers,
  type DatagramLike,
  type TimerLike,
} from '../src/core/net/transport';
import {
  BossRaceSimulation,
  BossRaceState,
  defaultBossRaceConfig,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { expect, expectEqual, suite, test } from './harness';

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

/** A channel that is not connected: every send throws, like the old offline one. */
class ThrowingDatagram implements DatagramLike {
  readonly closed = false;
  private handlers: DatagramHandlers = {};

  send(): void {
    throw new Error('channel down');
  }

  close(): void {
    this.handlers.onClose?.();
  }

  setHandlers(handlers: DatagramHandlers): void {
    this.handlers = handlers;
  }
}

/**
 * Session info for the synthetic bullet model.
 *
 * `rulesetVersion` must name the legacy ruleset explicitly: the battle server
 * (and now the client) only takes the synthetic scheduler for exactly
 * `mvp-boss-race-s0`, so an empty or `ruleset-local-s0` ticket means the
 * real-danmaku path.
 */
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

/** A server snapshot payload: one type byte, then the JSON body. */
function snapshotPayload(body: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const payload = new Uint8Array(json.length + 1);
  payload[0] = BattlePayloadType.SNAPSHOT;
  payload.set(json, 1);
  return payload;
}

suite('battle input chain');

test('a missing local roster id is a no-op for submitInput and does not crash sendInput', () => {
  // Simulation-level contract: an empty / unknown player id is rejected.
  const sim = new BossRaceSimulation(defaultBossRaceConfig('m1', 1));
  expectEqual(sim.addPlayer(''), false, 'an empty player id is rejected');
  expectEqual(
    sim.submitInput({
      playerId: '',
      tick: 1,
      seq: 1,
      directionBits: 0x2,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    false,
    'submitInput for an unknown player id is rejected',
  );
  expectEqual(
    sim.submitInput({
      playerId: 'p-1',
      tick: 1,
      seq: 1,
      directionBits: 0x2,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    false,
    'submitInput for a player that was never added is rejected',
  );

  // Client-level contract: the empty id must not throw anywhere.
  const client = new BattleClient({ datagramFactory: new OfflineDatagramFactory(), timer: new FakeTimer() });
  expectEqual(client.sendInput(1, 0x2, false, true, false), false, 'sendInput before connect returns false');
  expectEqual(client.connect(sessionInfo('', ['p-1', 'p-2'])), true);

  let threw = false;
  try {
    client.sendInput(1, 0x2, false, true, false);
  } catch {
    threw = true;
  }
  expect(!threw, 'sendInput must tolerate a missing local player id');

  const players = client.simulationRef?.snapshot().players ?? [];
  expect(
    players.every((player) => player.playerId !== ''),
    'the empty local id must never be registered as a player',
  );
  client.close();
});

test('an offline channel drops datagrams without stalling the input chain', () => {
  const client = new BattleClient({ datagramFactory: new OfflineDatagramFactory(), timer: new FakeTimer() });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);
  expectEqual(client.state, BattleConnectionState.Running);

  let threw = false;
  try {
    expectEqual(client.sendInput(1, 0x2, false, false, false), true);
    expectEqual(client.sendInput(2, 0x2, false, false, false), true);
  } catch {
    threw = true;
  }
  expect(!threw, 'offline sendInput must not throw');

  // The local prediction still advances and applies both queued inputs.
  client.tick();
  client.tick();
  expectEqual(client.simulationRef?.getCurrentTick(), 2);
  const local = client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1');
  expect(local !== undefined, 'the local player must exist in the prediction');
  expectEqual(local?.xMilli, 6000, 'two right-input ticks move the local ship');
  client.close();
});

test('a throwing channel is tolerated and the prediction still advances', () => {
  const timer = new FakeTimer();
  const factory: DatagramFactory = { open: () => new ThrowingDatagram() };
  const client = new BattleClient({ datagramFactory: factory, timer });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);

  let threw = false;
  try {
    expectEqual(client.sendInput(1, 0x2, false, false, false), true);
    // The KCP update loop must survive the datagram throwing on flush.
    timer.advance(100, () => undefined);
    expectEqual(client.sendInput(2, 0x2, false, false, false), true);
  } catch {
    threw = true;
  }
  expect(!threw, 'a throwing channel must not unwind sendInput or the KCP loop');

  client.tick();
  client.tick();
  const local = client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1');
  expectEqual(local?.xMilli, 6000, 'prediction advances even when every send throws');
  client.close();
});

test('a healthy channel carries the encoded BattleInput through KCP', () => {
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = [];
  const inboxB: Uint8Array[] = [];
  const datagramA = new ChannelDatagram(inboxA, inboxB);
  const datagramB = new ChannelDatagram(inboxB, inboxA);
  const conv = 4242;

  const client = new BattleClient({
    datagramFactory: { open: () => datagramA },
    timer,
    convOverride: conv,
  });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);

  const peer = new KcpSession(datagramB, timer, { conv, intervalMs: 10 });
  const received: Uint8Array[] = [];
  peer.onMessage((payload) => received.push(payload));

  expectEqual(client.sendInput(1, 0x2, true, true, false), true);
  timer.advance(300, () => {
    datagramA.pump();
    datagramB.pump();
  });

  expect(received.length >= 1, 'the peer must receive the KCP payload');
  const decoded = decodeBattleInput(received[0]);
  expect(decoded !== null, 'the payload must decode as a BattleInput');
  expectEqual(decoded?.matchId, 'match-1');
  expectEqual(decoded?.playerId, 'p-1');
  expectEqual(decoded?.directionBits, 0x2);
  expectEqual(decoded?.slow, true);
  expectEqual(decoded?.shoot, true);

  client.close();
  peer.close();
});

test('the first authoritative snapshot seeds the local prediction', () => {
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = [];
  const inboxB: Uint8Array[] = [];
  const datagramA = new ChannelDatagram(inboxA, inboxB);
  const datagramB = new ChannelDatagram(inboxB, inboxA);
  const conv = 777;

  const client = new BattleClient({
    datagramFactory: { open: () => datagramA },
    timer,
    convOverride: conv,
  });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);

  // Before any server state arrives the prediction sits on `addPlayer`'s default
  // spawn — which is exactly the bug: against a server that spawns at
  // (±20000, 60000) it reported a constant 60000-milli error forever.
  const before = client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1');
  expectEqual(before?.xMilli, 0);
  expectEqual(before?.yMilli, 0);

  const serverState: BossRaceSnapshot = {
    tick: 120,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    players: [
      {
        playerId: 'p-1',
        xMilli: -20000,
        yMilli: 60000,
        bossCurrentHp: 4200,
        damageDealt: 1800,
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
  };

  // The hash the server would stamp on that state, reproduced by an independent
  // simulation built from the same match id and seed and seeded the same way the
  // client seeds: spawn onto tick 0, replay to the snapshot tick, then adopt the
  // authoritative player state. Feeding the resulting hash back makes the hash
  // leg of `classifyReconcile` meaningful instead of vacuously failing.
  const reference = new BossRaceSimulation(defaultBossRaceConfig('match-1', 12345));
  reference.addPlayer('p-1');
  reference.addPlayer('p-2');
  reference.adoptAuthoritativeSnapshot({ ...serverState, tick: 0 }, { alignTick: true });
  while (reference.getCurrentTick() < serverState.tick) {
    reference.tick();
  }
  reference.adoptAuthoritativeSnapshot(serverState);

  const peer = new KcpSession(datagramB, timer, { conv, intervalMs: 10 });
  peer.send(
    snapshotPayload({
      tick: serverState.tick,
      state: 'running',
      winner_player_id: '',
      winner_tick: 0,
      state_hash: reference.hashAtTick(serverState.tick) ?? reference.canonicalStateHash(),
      players: serverState.players.map((player) => ({
        player_id: player.playerId,
        x_milli: player.xMilli,
        y_milli: player.yMilli,
        boss_current_hp: player.bossCurrentHp,
        damage_dealt: player.damageDealt,
        connected: player.connected,
      })),
      bullets: [],
    }),
  );
  timer.advance(300, () => {
    datagramA.pump();
    datagramB.pump();
  });

  expectEqual(client.metrics.snapshotsReceived, 1, 'the snapshot reached the client');
  expectEqual(client.simulationRef?.getCurrentTick(), 120, 'the prediction adopts the server tick');
  const after = client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1');
  expectEqual(after?.xMilli, -20000, 'the prediction adopts the server spawn');
  expectEqual(after?.yMilli, 60000);
  expectEqual(after?.bossCurrentHp, 4200, 'the Boss HP is adopted');
  expectEqual(after?.damageDealt, 1800);
  expectEqual(
    client.metrics.averagePositionErrorMilli,
    0,
    'seeding before measuring leaves no phantom position error',
  );
  expectEqual(client.metrics.hashMatches, 1, 'the seeded prediction agrees with the server hash');
  expectEqual(client.metrics.hardSnaps, 0, 'a seeded prediction is not a hard snap');
  client.close();
  peer.close();
});

test('later snapshots replay the ticks the prediction is missing', () => {
  const timer = new FakeTimer();
  const inboxA: Uint8Array[] = [];
  const inboxB: Uint8Array[] = [];
  const datagramA = new ChannelDatagram(inboxA, inboxB);
  const datagramB = new ChannelDatagram(inboxB, inboxA);
  const conv = 888;

  const client = new BattleClient({
    datagramFactory: { open: () => datagramA },
    timer,
    convOverride: conv,
  });
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);
  const peer = new KcpSession(datagramB, timer, { conv, intervalMs: 10 });

  const send = (tick: number): void => {
    peer.send(
      snapshotPayload({
        tick,
        state: 'running',
        winner_player_id: '',
        winner_tick: 0,
        state_hash: '',
        players: [
          {
            player_id: 'p-1',
            x_milli: -20000,
            y_milli: 60000,
            boss_current_hp: 6000,
            damage_dealt: 0,
            connected: true,
          },
          {
            player_id: 'p-2',
            x_milli: 20000,
            y_milli: 60000,
            boss_current_hp: 6000,
            damage_dealt: 0,
            connected: true,
          },
        ],
        bullets: [],
      }),
    );
    timer.advance(120, () => {
      datagramA.pump();
      datagramB.pump();
    });
  };

  send(10);
  expectEqual(client.metrics.snapshotsReceived, 1);
  expectEqual(client.simulationRef?.getCurrentTick(), 10, 'the first snapshot seeds the tick');

  // The local `setInterval` loop only managed two ticks while the server ran on.
  client.tick();
  client.tick();
  expectEqual(client.simulationRef?.getCurrentTick(), 12);

  send(40);
  expectEqual(client.metrics.snapshotsReceived, 2);
  expectEqual(
    client.simulationRef?.getCurrentTick(),
    40,
    'the prediction replays the missing ticks instead of falling behind',
  );

  client.close();
  peer.close();
});
