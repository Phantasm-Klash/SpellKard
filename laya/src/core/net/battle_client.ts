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
import type { BattleHandshakeHello, BattleInput, BattlePacketHeader } from '../protocol/types';
import { BattlePayloadType, emptyVersionStamp } from '../protocol/types';
import {
  decodeBattleResult,
  decodeBossRaceSnapshot,
  decodeCoopBossSnapshot,
  decodeEncryptedPacket,
  decodeHandshakeAccept,
  decodeUtf8,
  encodeBattleInput,
  encodeBattleInputWithTicket,
  encodeEncryptedPacket,
  encodeHandshakeHello,
  peekPayloadType,
  type BattleResultPayload,
} from './battle_codec';
import {
  resolveCipher,
  sealsClientToServer,
  sealsServerToClient,
  selectBattleCipher,
  selectBattleCipherWithSessionKey,
  type AeadSelection,
  type BattleCryptoProvider,
} from './battle_aead';
import {
  BATTLE_AEAD_CHACHA20_POLY1305,
  BATTLE_AEAD_XCHACHA20_POLY1305,
  BATTLE_DIRECTION_CLIENT_TO_SERVER,
  BATTLE_DIRECTION_SERVER_TO_CLIENT,
  devBattleAadBytes,
  devBattleNonceHex,
  devHandshakeKeyRef,
  aeadHexToBytes as hexToBytes,
  type BattleCipher,
  UnsupportedKeyAgreement,
} from './battle_crypto';
import { KcpSession } from './kcp_transport';
import type { DatagramFactory, DatagramLike, Logger, TimerLike } from './transport';
import { nullLogger } from './transport';

/**
 * How many ticks a single snapshot may replay before the prediction is reseeded
 * onto the server state instead. Bounds the work a badly stalled client (a
 * backgrounded tab, a long GC pause) can do inside one frame.
 */
const BATTLE_MAX_CATCH_UP_TICKS = 600;

/**
 * How long {@link BattleClient.performHandshake} waits for `HANDSHAKE_ACCEPT`
 * before giving up and leaving the session on plaintext.
 */
const BATTLE_HANDSHAKE_TIMEOUT_MS = 5000;

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
  /**
   * The AEAD suite the server selected in `BattleHandshakeAccept.selected_aead`.
   *
   * Absent means the dev plaintext path, which is what the deployed server
   * answers — so a session that does not carry this field behaves exactly as it
   * did before encryption existed. See `core/net/battle_aead.ts` for why the
   * client follows the server rather than deciding for itself.
   */
  selectedAead?: string;
  /**
   * The battle session key, delivered **out of band** by the lobby alongside the
   * ticket.
   *
   * This is the path `docs/battle-wire-scheme.md` §P2 recommends and it takes
   * precedence over {@link selectedAead}: the key already exists, so there is
   * nothing to negotiate and no round trip to spend before the match starts.
   */
  sessionKey?: Uint8Array;
  /**
   * Which key {@link sessionKey} is — the lobby stamps it so the battle server
   * can tell a rotated key from a stale one. Carried in `header.key_id`, which
   * the server checks before anything else.
   */
  battleKeyId?: string;
}

export interface BattleClientConfig {
  datagramFactory: DatagramFactory;
  timer: TimerLike;
  logger?: Logger;
  /** Overrides the derived conv; mainly for tests. */
  convOverride?: number;
  tickRateHz?: number;
  /**
   * What this platform can offer for AEAD: the X25519 + HKDF key agreement and
   * the cipher factory. Omit to stay on plaintext even if the server asks for
   * encryption — the browser build supplies the WebCrypto pair, the native build
   * the plain-TypeScript one.
   */
  crypto?: BattleCryptoProvider;
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
  /**
   * Whether this session seals its packets, and with what. Decided once, in
   * {@link connect}, from what the server negotiated — never per packet, so the
   * send and receive paths cannot disagree.
   */
  private aead: AeadSelection | null = null;
  /** The AEAD cipher, once the key agreement has derived the session key. */
  private cipher: BattleCipher | null = null;
  /**
   * The directional key reference the server expects in `header.key_id`.
   *
   * Not on the wire — `BattleHandshakeAccept` carries only the transcript hash,
   * and both sides derive the reference from it.
   */
  private keyId: string | null = null;
  /** The client's own handshake random, needed again to derive the session key. */
  private clientRandom: Uint8Array | null = null;
  /** Resolver for the promise {@link performHandshake} returned. */
  private handshakeWaiter: ((ok: boolean) => void) | null = null;
  private handshakeTimer: number | null = null;
  /** Re-entrancy guard: a flush awaits, so a second one could reorder frames. */
  private flushing = false;

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

    // Decide the cipher once, so the send and receive paths cannot disagree.
    //
    // A session key from the lobby wins over anything the server might have
    // negotiated: the key already exists, so the cipher does too, and the first
    // input frame of the match goes out sealed with no handshake in between.
    // Without one, fall back to what the server negotiated — which for the
    // deployed battle server is the dev plaintext path.
    this.aead =
      info.sessionKey !== undefined && info.sessionKey.length > 0
        ? selectBattleCipherWithSessionKey(info.sessionKey, this.config.crypto)
        : selectBattleCipher(info.selectedAead ?? 'PLAINTEXT_DEV', this.config.crypto);
    this.cipher = this.aead.cipher;
    this.keyId = info.battleKeyId ?? null;
    this.logger.info(
      `battle aead: selected=${this.aead.selected} encrypted=${this.aead.encrypted} ` +
        `direction=${this.aead.direction} (${this.aead.reason})`,
    );

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
    // Opening a sealed frame awaits the cipher, so the receive path is async.
    // The KCP callback cannot await it; a rejection would be swallowed, which is
    // why `openFromWire` never throws.
    this.session.onMessage((payload) => this.receive(payload));

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
    // Sealing awaits, so the flush is no longer synchronous with the send. The
    // input is already in the queue and in the local prediction, which is what
    // keeps the tick loop moving regardless.
    void this.flushInputQueue();
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
    // A handshake that never got its accept must not leave a promise pending.
    if (this.handshakeWaiter !== null) {
      this.settleHandshake(false, 'battle_handshake_closed');
    }
    this.session?.close();
    this.session = null;
    this.datagram = null;
    if (this.state !== BattleConnectionState.Failed) {
      this.state = BattleConnectionState.Closed;
    }
  }

  /**
   * Drains the input queue onto the channel.
   *
   * The plaintext path is **synchronous** on purpose: `sendInput` and the tests
   * both assume the frame is on the wire before `sendInput` returns, and
   * awaiting there would put every send a microtask late for no reason. Only
   * the sealed path pays for the async cipher.
   */
  private flushInputQueue(): void {
    // Nothing may go out before the handshake has produced the session key —
    // a frame sealed with no cipher, or sent in the clear after one, would be
    // rejected by the server.
    if (this.handshakeWaiter !== null) {
      return;
    }
    if (this.sealsOutgoing()) {
      void this.flushSealedQueue();
      return;
    }
    this.flushPlainQueue();
  }

  private flushPlainQueue(): void {
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

  private async flushSealedQueue(): Promise<void> {
    // Sealing is async (WebCrypto, and the native binding returns a promise), so
    // a flush can overlap the next `sendInput`. One flush at a time keeps the
    // queue FIFO — a second concurrent one could reorder frames, and the server
    // rejects out-of-order `seq`.
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    try {
      while (this.inputQueue.length > 0) {
        const session = this.session;
        if (session === null) {
          return;
        }
        const input = this.inputQueue[0];
        const ticket = this.sessionInfo?.signedTicket;
        let sent: boolean;
        try {
          const body = ticket === undefined ? encodeBattleInput(input) : encodeBattleInputWithTicket(input, ticket);
          sent = session.send(await this.sealForWire(body, input, peekPayloadType(body)));
        } catch (error) {
          this.lastError = `battle_send_threw:${String(error)}`;
          this.logger.warn(this.lastError);
          sent = true;
        }
        if (!sent) {
          this.lastError = 'battle_send_failed';
          return;
        }
        this.inputQueue.shift();
      }
    } finally {
      this.flushing = false;
    }
  }

  private receive(payload: Uint8Array): void {
    // The handshake itself is always in the clear — there is no key yet.
    if (peekPayloadType(payload) === BattlePayloadType.HANDSHAKE_ACCEPT) {
      void this.completeHandshake(payload);
      return;
    }
    if (this.opensIncoming()) {
      void this.receiveSealed(payload);
      return;
    }
    this.handleFrame(payload);
  }

  private async receiveSealed(payload: Uint8Array): Promise<void> {
    const opened = await this.openFromWire(payload);
    if (opened === null) {
      // The auth tag failed. Dropping the packet is the only safe response:
      // retrying it as plaintext would turn a forgery into an accepted frame,
      // which is exactly what the tag exists to prevent.
      this.lastError = 'battle_auth_tag_invalid';
      this.logger.warn(this.lastError);
      return;
    }
    this.handleFrame(opened);
  }

  /** Dispatches one already-decoded frame by its payload type. */
  private handleFrame(frame: Uint8Array): void {
    switch (peekPayloadType(frame)) {
      case 4: {
        // Snapshot
        const snapshot = decodeBossRaceSnapshot(frame);
        if (snapshot !== null) {
          this.applySnapshot(snapshot);
        }
        break;
      }
      case 12: {
        // CoopSnapshot（合作模式；JSON 体）
        const coop = decodeCoopBossSnapshot(frame);
        if (coop !== null) {
          for (const listener of this.coopSnapshotListeners) {
            listener(coop);
          }
        }
        break;
      }
      case 8: {
        // Result
        const result = decodeBattleResult(frame);
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

  /**
   * Whether this session seals the frames it sends.
   *
   * Deliberately separate from {@link opensIncoming}. A session seals only the
   * direction it needs to — the input direction, which is the cheat-sensitive
   * half and the tiny half — while the snapshot broadcast comes back in the
   * clear because it is the same bytes for every player. A single shared flag
   * would make the receive path try to open that broadcast and drop every
   * frame. See `docs/battle-wire-scheme.md` §P2.
   */
  private sealsOutgoing(): boolean {
    return sealsClientToServer(this.aead);
  }

  /** Whether the frames this session receives are sealed. */
  private opensIncoming(): boolean {
    return sealsServerToClient(this.aead);
  }

  /**
   * Performs the AEAD handshake and installs the session cipher.
   *
   * Sends `HANDSHAKE_HELLO` and resolves once the server answers
   * `HANDSHAKE_ACCEPT` and the session key has been derived — or `false` if the
   * platform has no key agreement, no channel is open, or the server never
   * answers within {@link BATTLE_HANDSHAKE_TIMEOUT_MS}.
   *
   * **Nothing calls this on the live path.** `MatchServer`, the deployed battle
   * server, decodes `BattleInput` straight off the wire and has no handshake at
   * all (`src/match_lifecycle.cpp`); sending a hello there would make every
   * input undeliverable. It is here so that flipping the client onto the
   * `battle.proto` AEAD path is one call once the server answers it — see
   * `docs/battle-aead-server-spec.md`.
   */
  async performHandshake(): Promise<boolean> {
    const info = this.sessionInfo;
    const crypto = this.config.crypto;
    if (info === null || this.session === null || crypto === undefined) {
      return false;
    }
    if (crypto.keyAgreement instanceof UnsupportedKeyAgreement) {
      return false;
    }
    if (this.sealsOutgoing() || this.opensIncoming()) {
      return true;
    }
    let pair: { publicKey: Uint8Array; random: Uint8Array };
    try {
      pair = await crypto.keyAgreement.generateClientKeyPair();
    } catch (error) {
      this.lastError = `battle_handshake_keypair_failed:${String(error)}`;
      this.logger.warn(this.lastError);
      return false;
    }
    this.clientRandom = pair.random;
    this.session.send(
      encodeHandshakeHello({
        version: { ...emptyVersionStamp(), protocolVersion: 1 },
        clientX25519Pub: pair.publicKey,
        clientRandom: pair.random,
        supportedAead: [BATTLE_AEAD_CHACHA20_POLY1305, BATTLE_AEAD_XCHACHA20_POLY1305],
        ...(info.signedTicket === undefined
          ? {}
          : { battleTicket: info.signedTicket as unknown as BattleHandshakeHello['battleTicket'] }),
      }),
    );
    return await new Promise<boolean>((resolve) => {
      this.handshakeWaiter = resolve;
      this.handshakeTimer = this.config.timer.setTimeout(() => {
        this.settleHandshake(false, 'battle_handshake_timeout');
      }, BATTLE_HANDSHAKE_TIMEOUT_MS);
    });
  }

  /** Resolves the pending handshake promise exactly once. */
  private settleHandshake(ok: boolean, reason: string): void {
    if (this.handshakeTimer !== null) {
      this.config.timer.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    const waiter = this.handshakeWaiter;
    this.handshakeWaiter = null;
    if (!ok) {
      this.lastError = reason;
      this.logger.warn(reason);
    }
    waiter?.(ok);
  }

  /** Handles the server's `HANDSHAKE_ACCEPT`. */
  private async completeHandshake(payload: Uint8Array): Promise<void> {
    const accept = decodeHandshakeAccept(payload);
    const crypto = this.config.crypto;
    if (accept === null) {
      this.settleHandshake(false, 'battle_handshake_accept_undecodable');
      return;
    }
    if (crypto === undefined || this.clientRandom === null) {
      this.settleHandshake(false, 'battle_handshake_not_started');
      return;
    }
    let sessionKey: Uint8Array;
    try {
      sessionKey = await crypto.keyAgreement.deriveSessionKey(
        accept.serverX25519Pub,
        this.clientRandom,
        accept.serverRandom,
      );
    } catch (error) {
      this.settleHandshake(false, `battle_handshake_derive_failed:${String(error)}`);
      return;
    }
    const selection = selectBattleCipher(accept.selectedAead, crypto);
    const cipher = resolveCipher(selection, crypto, sessionKey);
    if (cipher === null) {
      this.settleHandshake(false, 'battle_handshake_no_cipher');
      return;
    }
    // The server validates `header.key_id` against the direction key reference
    // it derived from the transcript hash, and that reference is not on the
    // wire — only the transcript hash is. So the client recomputes it.
    //
    // `transcript_hash` is `bytes` in the proto but carries the *ASCII* of a
    // 32-character hex string: that is what the server's own check requires
    // (`handshake_transcript_hash.size() == 32 && IsHex(...)`), so it has to be
    // read as text, not re-hexed.
    this.keyId = devHandshakeKeyRef(decodeUtf8(accept.transcriptHash), BATTLE_DIRECTION_CLIENT_TO_SERVER);
    this.cipher = cipher;
    this.aead = { ...selection, cipher };
    this.logger.info(`battle handshake done: aead=${accept.selectedAead} key_id=${this.keyId}`);
    this.settleHandshake(true, 'ok');
    // Everything queued while the handshake was in flight goes out now, sealed.
    this.flushInputQueue();
  }

  /**
   * Seals an encoded input frame into a `BattleEncryptedPacket`, or returns it
   * untouched on the plaintext path.
   *
   * The nonce is derived from the header, so the header has to be built first
   * and then fed back into {@link devBattleNonceHex} — which is why this takes
   * the input rather than just the bytes: `tick` and `seq` are nonce material.
   */
  private async sealForWire(body: Uint8Array, input: BattleInput, payloadType: number): Promise<Uint8Array> {
    const cipher = this.cipher;
    if (!this.sealsOutgoing()) {
      return body;
    }
    if (cipher === null || this.keyId === null) {
      // The lobby issued a session key but no key id. The server rejects a
      // packet with an empty `key_id` outright, so sealing would only turn a
      // misconfiguration into a match that cannot be played at all.
      //
      // This is *not* a downgrade an attacker can trigger: it depends on what
      // the lobby handed the client, and there is nothing on the wire to
      // tamper with to get here. It is a loud, loggable configuration error.
      this.lastError = 'battle_key_id_missing';
      this.logger.error(`${this.lastError}: the session key has no key id, sending in the clear`);
      return body;
    }
    const nonceInput = {
      keyId: this.keyId,
      matchId: input.matchId,
      playerId: input.playerId,
      payloadType,
      tick: input.tick,
      seq: input.seq,
      ack: 0,
    };
    const nonce = hexToBytes(devBattleNonceHex(nonceInput, BATTLE_DIRECTION_CLIENT_TO_SERVER));
    const aad = devBattleAadBytes(nonceInput, BATTLE_DIRECTION_CLIENT_TO_SERVER);
    const sealed = await cipher.seal(body, aad, nonce);
    return encodeEncryptedPacket({
      header: {
        version: { ...emptyVersionStamp(), protocolVersion: 1 },
        matchId: input.matchId,
        playerId: input.playerId,
        tick: input.tick,
        seq: input.seq,
        ack: 0,
        payloadType: payloadType as BattlePacketHeader['payloadType'],
        keyId: this.keyId,
        nonce,
      },
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
    });
  }

  /**
   * Opens a sealed frame from the wire.
   *
   * @returns the plaintext body, or `null` when there was nothing to open
   *   (the plaintext path) or the auth tag failed.
   *
   * `null` therefore means two different things, which is why the caller checks
   * {@link opensIncoming} before treating it as a failure.
   */
  private async openFromWire(payload: Uint8Array): Promise<Uint8Array | null> {
    const cipher = this.cipher;
    if (!this.opensIncoming() || cipher === null) {
      return null;
    }
    const packet = decodeEncryptedPacket(payload);
    if (packet === null) {
      return null;
    }
    const header = packet.header;
    if (header === undefined) {
      return null;
    }
    const nonceInput = {
      keyId: header.keyId,
      matchId: header.matchId,
      playerId: header.playerId,
      payloadType: Number(header.payloadType),
      tick: header.tick,
      seq: header.seq,
      ack: header.ack,
    };
    try {
      return await cipher.open(
        packet.ciphertext,
        packet.authTag,
        devBattleAadBytes(nonceInput, BATTLE_DIRECTION_SERVER_TO_CLIENT),
        header.nonce,
      );
    } catch {
      // A failed tag is a failure, not an exception to propagate: the receive
      // path is called from the KCP callback, where a throw would be lost.
      return null;
    }
  }
}
