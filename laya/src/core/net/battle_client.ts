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

import { deriveDevKcpConv } from '../math/hash64';
import type { BossRaceSnapshot } from '../sim/boss_race';
import { BossRaceSimulation, classifyReconcile, defaultBossRaceConfig } from '../sim/boss_race';
import type { BattleInput } from '../protocol/types';
import { emptyVersionStamp } from '../protocol/types';
import {
  decodeBattleResult,
  decodeBossRaceSnapshot,
  encodeBattleInput,
  peekPayloadType,
  type BattleResultPayload,
} from './battle_codec';
import { KcpSession } from './kcp_transport';
import type { DatagramFactory, DatagramLike, Logger, TimerLike } from './transport';
import { nullLogger } from './transport';

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
  /** Server seed as an unsigned 32-bit value (see `seedFromHex`). */
  serverSeed: number;
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
  private resultListeners: ResultListener[] = [];

  private seq = 0;
  private inputQueue: BattleInput[] = [];

  state = BattleConnectionState.Idle;
  lastError = '';
  readonly metrics: BattleCorrectionMetrics = {
    snapshotsReceived: 0,
    maxPositionErrorMilli: 0,
    averagePositionErrorMilli: 0,
    hashMatches: 0,
    hashMismatches: 0,
    hardSnaps: 0,
    lateInputs: 0,
  };
  /** Latest authoritative snapshot received from the server. */
  latestSnapshot: BossRaceSnapshot | null = null;

  constructor(config: BattleClientConfig) {
    this.config = config;
    this.logger = config.logger ?? nullLogger;
    this.tickRateHz = config.tickRateHz ?? 60;
  }

  get conv(): number {
    if (this.sessionInfo === null) {
      return 0;
    }
    return this.config.convOverride ?? deriveDevKcpConv(this.sessionInfo.matchId, this.sessionInfo.playerId);
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

    this.simulation = new BossRaceSimulation(defaultBossRaceConfig(info.matchId, info.serverSeed));
    for (const playerId of info.playerIds) {
      this.simulation.addPlayer(playerId);
    }
    // Ensure the local player always exists even if the roster was empty.
    if (info.playerId !== '') {
      this.simulation.addPlayer(info.playerId);
    }

    try {
      this.datagram = this.config.datagramFactory.open(info.endpoint);
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
   */
  sendInput(
    tick: number,
    directionBits: number,
    slow: boolean,
    shoot: boolean,
    bomb: boolean,
    cardSlot = -1,
    modeActionId = '',
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
    };
    this.inputQueue.push(input);
    this.flushInputQueue();
    // Feed the local prediction too, so rendering stays smooth between snapshots.
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
      if (!session.send(encodeBattleInput(input))) {
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

  private applySnapshot(snapshot: BossRaceSnapshot): void {
    this.metrics.snapshotsReceived += 1;
    this.latestSnapshot = snapshot;

    const local = this.simulation;
    let maxError = 0;
    if (local !== null) {
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
    }

    const hashMatch = local !== null && local.canonicalStateHash() === snapshot.stateHash;
    const reconcile = classifyReconcile(maxError, hashMatch);
    this.metrics.maxPositionErrorMilli = Math.max(this.metrics.maxPositionErrorMilli, maxError);
    const count = this.metrics.snapshotsReceived;
    this.metrics.averagePositionErrorMilli =
      (this.metrics.averagePositionErrorMilli * (count - 1) + maxError) / count;
    if (hashMatch) {
      this.metrics.hashMatches += 1;
    } else {
      this.metrics.hashMismatches += 1;
    }
    if (reconcile.hardSnap) {
      this.metrics.hardSnaps += 1;
    }

    for (const listener of this.snapshotListeners) {
      listener(snapshot, reconcile.hardSnap);
    }
  }
}
