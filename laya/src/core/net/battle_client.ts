/**
 * Battle client for PhK-BattleServer (KCP/UDP, or the lobby WS relay on web).
 *
 * Responsibilities:
 *  - open the datagram channel and run a KCP session on the server-derived conv
 *  - encode per-tick `BattleInput` payloads using the server's real wire format
 *  - decode `BossRaceSnapshot` / result payloads and reconcile them against a
 *    locally predicted `BossRaceSimulation`
 *  - surface correction metrics so the view can smooth or hard-snap
 *
 * The datagram and timer are injected, so the same class drives a real UDP
 * socket (native) or the lobby WebSocket relay (web), and runs under tests with
 * a synthetic channel and clock.
 */

import type { BossRaceSeed } from '../math/boss_race_seed';
import { deriveDevKcpConv } from '../math/hash64';
import type { BossRaceSnapshot } from '../sim/boss_race';
import type { CoopBossSnapshot } from '../sim/coop_boss';
import {
  BossRaceSimulation,
  BOSS_RACE_HARD_SNAP_ERROR_MILLI,
  BOSS_RACE_TICK_RATE_HZ,
  bossRaceConfigForRuleset,
  classifyReconcile,
} from '../sim/boss_race';
import type { BattleInput } from '../protocol/types';
import { emptyVersionStamp } from '../protocol/types';
import {
  decodeBattleResult,
  decodeBossRaceSnapshot,
  decodeCoopBossSnapshot,
  encodeBattleInput,
  encodeBattleInputWithTicket,
  peekPayloadType,
  type BattleResultPayload,
} from './battle_codec';
import { KcpSession } from './kcp_transport';
import type { DatagramFactory, DatagramLike, Logger, TimerLike } from './transport';
import { nullLogger } from './transport';

/**
 * How many ticks a single snapshot may replay before the prediction is reseeded
 * onto the server state instead. Bounds the work a badly stalled client (a
 * backgrounded tab, a long GC pause) can do inside one frame.
 */
const BATTLE_MAX_CATCH_UP_TICKS = 600;

export enum BattleConnectionState {
  Idle = 'idle',
  Connecting = 'connecting',
  Running = 'running',
  Finished = 'finished',
  Closed = 'closed',
  Failed = 'failed',
}

export interface BattleSessionInfo {
  matchId: string;
  playerId: string;
  playerIds: string[];
  modeId: string;
  rulesetVersion: string;
  endpoint: string;
  /**
   * The full-width match seed. Build it with `bossRaceSeedFromHex` from the
   * lobby's `server_seed_hex` — the value spans the whole uint64 range and both
   * the RNG material and the state hash print it in full.
   */
  serverSeed: BossRaceSeed;
  /**
   * Raw signed battle ticket (the `battle.ticket` response payload). When set it
   * rides on every input frame, which is what lets the battle server bind the
   * session to a verified account and fill `players[].user_id` in the `.dem`.
   * Without it the server logs `reason=ticket_missing` and keeps recording, so
   * the field is optional by design.
   */
  signedTicket?: Record<string, unknown>;
}

export interface BattleClientConfig {
  datagramFactory: DatagramFactory;
  timer: TimerLike;
  logger?: Logger;
  /** Overrides the derived conv; mainly for tests. */
  convOverride?: number;
  tickRateHz?: number;
}

export interface BattleCorrectionMetrics {
  snapshotsReceived: number;
  maxPositionErrorMilli: number;
  averagePositionErrorMilli: number;
  hashMatches: number;
  hashMismatches: number;
  /**
   * Snapshots whose state hash was worth comparing at all, i.e. where the local
   * simulation's bullet set is expected to reproduce the server's — see
   * `BossRaceSimulation.hashComparable`. On the live ruleset this equals
   * `snapshotsReceived`, because the client's danmaku library is the server's.
   * It is only zero for a build shipping a provisional timeline, where the hash
   * numbers would say nothing about a desync.
   */
  hashComparable: number;
  hardSnaps: number;
  lateInputs: number;
}

export type SnapshotListener = (snapshot: BossRaceSnapshot, hardSnap: boolean) => void;
export type ResultListener = (result: BattleResultPayload) => void;

export class BattleClient {
  private readonly config: BattleClientConfig;
  private readonly logger: Logger;
  private readonly tickRateHz: number;

  private datagram: DatagramLike | null = null;
  private session: KcpSession | null = null;
  private simulation: BossRaceSimulation | null = null;
  private sessionInfo: BattleSessionInfo | null = null;

  private snapshotListeners: SnapshotListener[] = [];
  // 合作模式快照（payload 字节 12）单独一条监听链：race 与 coop 的帧模型
  // 完全不同，混在一条链上会让每个消费者都要做类型判断。
  private coopSnapshotListeners: Array<(snapshot: CoopBossSnapshot) => void> = [];
  private resultListeners: ResultListener[] = [];

  private seq = 0;
  private inputQueue: BattleInput[] = [];
  /**
   * Whether the local prediction has been seeded from the first authoritative
   * snapshot. Reset by every {@link connect}, since that is where a fresh
   * `BossRaceSimulation` is built with no server state at all.
   */
  private adoptedAuthoritative = false;

  state = BattleConnectionState.Idle;
  lastError = '';
  readonly metrics: BattleCorrectionMetrics = {
    snapshotsReceived: 0,
    maxPositionErrorMilli: 0,
    averagePositionErrorMilli: 0,
    hashMatches: 0,
    hashMismatches: 0,
    hashComparable: 0,
    hardSnaps: 0,
    lateInputs: 0,
  };
  /** Latest authoritative snapshot received from the server. */
  latestSnapshot: BossRaceSnapshot | null = null;

  constructor(config: BattleClientConfig) {
    this.config = config;
    this.logger = config.logger ?? nullLogger;
    this.tickRateHz = config.tickRateHz ?? BOSS_RACE_TICK_RATE_HZ;
  }

  get conv(): number {
    if (this.sessionInfo === null) {
      return 0;
    }
    return this.config.convOverride ?? deriveDevKcpConv(this.sessionInfo.matchId, this.sessionInfo.playerId);
  }

  /**
   * T10 rule 4: adopt the lobby's match tick after a passive drop and present
   * the local player alive again — they died on drop, and the resync revives
   * them. Forward only, and refused when there is nothing to resync yet.
   */
  resyncTick(tick: number): boolean {
    const simulation = this.simulation;
    const playerId = this.sessionInfo?.playerId ?? '';
    if (simulation === null || playerId === '') {
      return false;
    }
    if (!simulation.resyncTick(tick)) {
      return false;
    }
    simulation.setPlayerConnected(playerId, true);
    return true;
  }

  get simulationRef(): BossRaceSimulation | null {
    return this.simulation;
  }

  get info(): BattleSessionInfo | null {
    return this.sessionInfo;
  }

  onSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.push(listener);
    return () => {
      const index = this.snapshotListeners.indexOf(listener);
      if (index >= 0) {
        this.snapshotListeners.splice(index, 1);
      }
    };
  }

  /** 合作模式快照（mode_id = coop_boss 时由字节 12 载荷驱动）。 */
  onCoopSnapshot(listener: (snapshot: CoopBossSnapshot) => void): () => void {
    this.coopSnapshotListeners.push(listener);
    return () => {
      const index = this.coopSnapshotListeners.indexOf(listener);
      if (index >= 0) {
        this.coopSnapshotListeners.splice(index, 1);
      }
    };
  }

  onResult(listener: ResultListener): () => void {
    this.resultListeners.push(listener);
    return () => {
      const index = this.resultListeners.indexOf(listener);
      if (index >= 0) {
        this.resultListeners.splice(index, 1);
      }
    };
  }

  /**
   * Open the channel and start the local prediction simulation.
   * Returns false if the datagram channel could not be opened.
   */
  connect(info: BattleSessionInfo): boolean {
    if (this.state === BattleConnectionState.Running) {
      return true;
    }
    this.sessionInfo = info;
    this.state = BattleConnectionState.Connecting;
    this.lastError = '';

    // Pick the bullet model the *ticket's* ruleset selects, not a hard-coded
    // one: the battle server runs its real-danmaku path for everything except
    // the legacy `mvp-boss-race-s0`, and the lobby signs tickets with
    // `ruleset-local-s0`. Building the MVP synthetic model here put the two
    // sides on different bullet sets, so the state hash could never agree.
    this.simulation = new BossRaceSimulation(
      bossRaceConfigForRuleset(info.matchId, info.serverSeed, info.rulesetVersion),
    );
    // The prediction starts with no server state, so the first snapshot must
    // seed it (tick + roster positions) before any error is measured.
    this.adoptedAuthoritative = false;
    for (const playerId of info.playerIds) {
      this.simulation.addPlayer(playerId);
    }
    // Ensure the local player always exists even if the roster was empty.
    if (info.playerId !== '') {
      this.simulation.addPlayer(info.playerId);
    }

    try {
      this.datagram = this.config.datagramFactory.open(info.endpoint, {
        matchId: info.matchId,
        playerId: info.playerId,
      });
    } catch (error) {
      this.state = BattleConnectionState.Failed;
      this.lastError = `battle_datagram_open_failed:${String(error)}`;
      this.logger.error(this.lastError);
      return false;
    }

    const conv = this.conv;
    this.session = new KcpSession(this.datagram, this.config.timer, {
      conv,
      noDelay: 1,
      intervalMs: 10,
      fastResend: 2,
      noCongestion: true,
      logger: this.logger,
    });
    this.session.onMessage((payload) => this.handlePayload(payload));

    this.state = BattleConnectionState.Running;
    this.logger.info(`battle connected: match=${info.matchId} player=${info.playerId} conv=${conv}`);
    return true;
  }

  /**
   * Queue the local player's input for a tick. The input is buffered locally and
   * sent as soon as the previous send completes.
   *
   * `cardDraw` / `cardSelect` / `cardUse` are the §2.3 in-match card actions.
   * They are server-only (the local prediction ignores them) and optional, so
   * every existing caller keeps producing byte-identical frames when it does
   * not pass them.
   */
  sendInput(
    tick: number,
    directionBits: number,
    slow: boolean,
    shoot: boolean,
    bomb: boolean,
    cardSlot = -1,
    modeActionId = '',
    cardDraw = false,
    cardSelect = -1,
    cardUse = false,
  ): boolean {
    const info = this.sessionInfo;
    if (info === null || this.state !== BattleConnectionState.Running) {
      return false;
    }
    this.seq += 1;
    const input: BattleInput = {
      version: { ...emptyVersionStamp(), protocolVersion: 1 },
      matchId: info.matchId,
      playerId: info.playerId,
      tick,
      seq: this.seq,
      directionBits: directionBits & 0x0f,
      slow,
      shoot,
      bomb,
      cardSlot,
      modeActionId,
      cardDraw,
      cardSelect,
      cardUse,
    };
    // Feed the local prediction *before* touching the transport. The transport
    // may be an offline/degraded channel that cannot actually send; if a send
    // failure unwound this method the caller's tick loop would stop feeding the
    // simulation and the local player would appear frozen.
    this.simulation?.submitInput({
      playerId: input.playerId,
      tick: input.tick,
      seq: input.seq,
      directionBits: input.directionBits,
      slow: input.slow,
      shoot: input.shoot,
      bomb: input.bomb,
      cardSlot: input.cardSlot,
      modeActionId: input.modeActionId,
    });
    this.inputQueue.push(input);
    this.flushInputQueue();
    return true;
  }

  /** Advance the local prediction by one tick. */
  tick(): BossRaceSnapshot | null {
    if (this.simulation === null) {
      return null;
    }
    return this.simulation.tick();
  }

  /** Time between ticks in milliseconds. */
  get tickIntervalMs(): number {
    return 1000 / this.tickRateHz;
  }

  close(): void {
    this.session?.close();
    this.session = null;
    this.datagram = null;
    if (this.state !== BattleConnectionState.Failed) {
      this.state = BattleConnectionState.Closed;
    }
  }

  private flushInputQueue(): void {
    const session = this.session;
    if (session === null) {
      return;
    }
    while (this.inputQueue.length > 0) {
      const input = this.inputQueue[0];
      const ticket = this.sessionInfo?.signedTicket;
      let sent: boolean;
      try {
        sent = session.send(
          ticket === undefined ? encodeBattleInput(input) : encodeBattleInputWithTicket(input, ticket),
        );
      } catch (error) {
        // A broken or offline channel must degrade to a dropped datagram, never
        // an exception that unwinds `sendInput` and stalls the whole input
        // chain. Drop the input so the queue cannot grow without bound.
        this.lastError = `battle_send_threw:${String(error)}`;
        this.logger.warn(this.lastError);
        sent = true;
      }
      if (!sent) {
        // Backpressure (e.g. a full KCP window): keep the input queued and
        // retry on the next flush instead of blocking the chain.
        this.lastError = 'battle_send_failed';
        return;
      }
      this.inputQueue.shift();
    }
  }

  private handlePayload(payload: Uint8Array): void {
    switch (peekPayloadType(payload)) {
      case 4: {
        // Snapshot
        const snapshot = decodeBossRaceSnapshot(payload);
        if (snapshot !== null) {
          this.applySnapshot(snapshot);
        }
        break;
      }
      case 12: {
        // CoopSnapshot（合作模式；JSON 体）
        const coop = decodeCoopBossSnapshot(payload);
        if (coop !== null) {
          for (const listener of this.coopSnapshotListeners) {
            listener(coop);
          }
        }
        break;
      }
      case 8: {
        // Result
        const result = decodeBattleResult(payload);
        if (result !== null) {
          this.state = BattleConnectionState.Finished;
          for (const listener of this.resultListeners) {
            listener(result);
          }
        }
        break;
      }
      default:
        // Ping / event / unknown payloads are tolerated for forward compatibility.
        break;
    }
  }

  /**
   * Replays the ticks the local prediction is missing so it stops falling
   * behind the server.
   *
   * `BattleScene.step()` drives the simulation from a `setInterval`, which does
   * not hold a strict 60 Hz. Measured against the live lobby the local tick ran
   * at ~23 Hz while the server advanced exactly 60, so the prediction sat ~380
   * ticks behind after ten seconds — and it keeps falling. That is not cosmetic:
   * `step()` stamps every input with `localTick + 1` and the server rejects
   * `tick <= current_tick`, so a lagging prediction has every input dropped and
   * the local ship freezes.
   *
   * Replaying is exact — the simulation is a pure function of (config, inputs) —
   * so ticking forward reproduces the state the server already reached. Past
   * {@link BATTLE_MAX_CATCH_UP_TICKS} the gap is too large to replay in one frame
   * and the prediction is reseeded onto the server state instead.
   */
  private catchUpPrediction(local: BossRaceSimulation, snapshot: BossRaceSnapshot): void {
    let replayed = 0;
    while (local.getCurrentTick() < snapshot.tick) {
      const before = local.getCurrentTick();
      local.tick();
      if (local.getCurrentTick() === before) {
        // `tick()` is a no-op once the match is Finished, so replaying can never
        // close the gap.
        return;
      }
      replayed += 1;
      if (replayed >= BATTLE_MAX_CATCH_UP_TICKS) {
        this.logger.warn(
          `battle prediction lagging by more than ${BATTLE_MAX_CATCH_UP_TICKS} ticks; reseeding onto the server state`,
        );
        local.adoptAuthoritativeSnapshot(snapshot, { alignTick: true });
        return;
      }
    }
  }

  /**
   * Seeds the local prediction from the first authoritative snapshot.
   *
   * The simulation is built in `connect()` before the server has said anything,
   * so it sits on tick 0 with the `addPlayer` default spawn `(0, 0)`. Seeding
   * does three things, in order:
   *
   *  1. take the server's spawn onto tick 0 — the first snapshot's player
   *     positions, which is where the players still are at match start;
   *  2. replay every tick the server has already run. Bullets are a pure function
   *     of `(seed, tick)` and do not depend on player input, so the replay
   *     reproduces the server's bullet set *including its ids*, which is exactly
   *     what `canonicalStateHash` compares. Simply adopting the server's tick
   *     instead would leave the prediction with none of the bullets the server
   *     already spawned, so its hash could never match;
   *  3. take the server's authoritative player state at the snapshot tick, so any
   *     input the server already applied is reflected.
   *
   * Without this the prediction kept its `(0, 0)` spawn and tick 0 forever, so
   * every snapshot measured the same constant spawn-delta error and every frame
   * hard-snapped.
   */
  private seedPrediction(local: BossRaceSimulation, snapshot: BossRaceSnapshot): void {
    local.adoptAuthoritativeSnapshot({ ...snapshot, tick: 0 }, { alignTick: true });
    this.catchUpPrediction(local, snapshot);
    local.adoptAuthoritativeSnapshot(snapshot);
  }

  private applySnapshot(snapshot: BossRaceSnapshot): void {
    this.metrics.snapshotsReceived += 1;
    this.latestSnapshot = snapshot;

    const local = this.simulation;
    let maxError = 0;
    if (local !== null) {
      if (!this.adoptedAuthoritative) {
        this.adoptedAuthoritative = true;
        this.seedPrediction(local, snapshot);
      } else {
        // Every later snapshot closes whatever tick gap the local loop has
        // accumulated, so the prediction stays in step with the server.
        this.catchUpPrediction(local, snapshot);
      }
      const localSnapshot = local.snapshot();
      for (const serverPlayer of snapshot.players) {
        const localPlayer = localSnapshot.players.find((player) => player.playerId === serverPlayer.playerId);
        if (localPlayer === undefined) {
          continue;
        }
        const error = Math.max(
          Math.abs(localPlayer.xMilli - serverPlayer.xMilli),
          Math.abs(localPlayer.yMilli - serverPlayer.yMilli),
        );
        maxError = Math.max(maxError, error);
      }
      // A genuine desync is snapped away, keyed on the position error alone —
      // see `classifyReconcile` for why a hash mismatch must not force a snap.
      if (maxError > BOSS_RACE_HARD_SNAP_ERROR_MILLI) {
        local.adoptAuthoritativeSnapshot(snapshot);
      }
    }

    // Compare like with like. `canonicalStateHash` covers the tick counter, and a
    // predicting client is by construction at least one tick ahead of the
    // snapshot it reconciles against, so hashing "now" could never equal the
    // server's hash for an older tick — which made every frame look desynced
    // (measured 584/584 on a live match). The simulation keeps a short per-tick
    // history so the comparison uses the hash it produced *at* that tick.
    //
    // The comparison is only counted when the local bullet set is expected to
    // reproduce the server's — see `BossRaceSimulation.hashComparable`. On the
    // live ruleset that is every snapshot, because the client's danmaku library
    // is the server's own; a build that ships a provisional timeline instead
    // skips the count rather than reporting a permanent "0/n" that says nothing
    // about player sync.
    const comparable = local !== null && local.hashComparable();
    const localHash = comparable ? local.hashAtTick(snapshot.tick) : null;
    const hashMatch = comparable && localHash !== null && localHash === snapshot.stateHash;
    const reconcile = classifyReconcile(maxError, hashMatch);
    this.metrics.maxPositionErrorMilli = Math.max(this.metrics.maxPositionErrorMilli, maxError);
    const count = this.metrics.snapshotsReceived;
    this.metrics.averagePositionErrorMilli =
      (this.metrics.averagePositionErrorMilli * (count - 1) + maxError) / count;
    if (comparable) {
      this.metrics.hashComparable += 1;
      if (hashMatch) {
        this.metrics.hashMatches += 1;
      } else {
        this.metrics.hashMismatches += 1;
      }
    }
    if (reconcile.hardSnap) {
      this.metrics.hardSnaps += 1;
    }

    for (const listener of this.snapshotListeners) {
      listener(snapshot, reconcile.hardSnap);
    }
  }
}
