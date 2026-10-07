/**
 * Authoritative `mvp_boss_race` simulation, ported from
 * `PhK-BattleServer/src/boss_race.cpp`.
 *
 * The client runs this locally for two purposes:
 *  1. Prediction / smoothing between server snapshots.
 *  2. Rendering the local player's own Boss copy and its bullet curtain with the
 *     exact same deterministic pattern timeline the server uses.
 *
 * Everything here is integer/deterministic; there is no floating-point state in
 * the hashed material.
 *
 * IMPORTANT input-bit convention: the battle server defines
 * `0=up, 1=right, 2=down, 3=left` (i.e. `up=0x1, right=0x2, down=0x4, left=0x8`).
 * This differs from the Godot prototype's `input_codec.gd`
 * (`left=1, right=2, up=4, down=8`). The server is authoritative, so the client
 * encodes inputs using the server convention.
 */

import { bossRaceDeterministicUnit, canonicalHashPair } from '../math/deterministic';

export const MVP_BOSS_RACE_MODE_ID = 'mvp_boss_race';
export const BOSS_RACE_TICK_RATE_HZ = 60;
export const BOSS_RACE_DEFAULT_BOSS_HP = 6000;
export const BOSS_RACE_DAMAGE_PER_SHOT_TICK = 10;
export const BOSS_RACE_PATTERN_PERIOD_TICKS = 45;
export const BOSS_RACE_MAX_BULLETS_PER_PLAYER = 384;
export const BOSS_RACE_MAX_PLAYERS = 2;
export const BOSS_RACE_MIN_PLAYERS = 2;
export const BOSS_RACE_PATTERN_COUNT = 10;
/**
 * Default tick cap, matching the battle server's `--max-ticks 7200` (two
 * minutes at 60Hz). The client uses this only to render a countdown; the server
 * still decides when a match is timed out.
 */
export const BOSS_RACE_DEFAULT_MAX_TICKS = 7200;

export const ARENA_HALF_WIDTH_MILLI = 120000;
export const ARENA_HALF_HEIGHT_MILLI = 90000;
export const BOSS_ORIGIN_X_MILLI = 0;
export const BOSS_ORIGIN_Y_MILLI = -60000;
export const MOVE_MILLI_PER_TICK = 3000;

/** Server input direction bits. */
export const DIR_UP = 0x1;
export const DIR_RIGHT = 0x2;
export const DIR_DOWN = 0x4;
export const DIR_LEFT = 0x8;
export const DIR_MASK = 0x0f;

/** The ten MVP pattern ids, in scheduler order (index == pattern id). */
export const BOSS_RACE_PATTERN_IDS = [
  'ring',
  'gap_ring',
  'n_way',
  'aimed',
  'seeded_arc',
  'spiral',
  'laser_curtain',
  'homing',
  'sine_stream',
  'blossom',
] as const;

export type BossRacePatternId = (typeof BOSS_RACE_PATTERN_IDS)[number];

export enum BossRaceState {
  Waiting = 0,
  Running = 1,
  Finished = 2,
}

export interface BossRaceBullet {
  bulletId: string;
  ownerPlayerId: string;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
  radiusMilli: number;
  patternId: string;
}

export interface BossRacePlayerSnapshot {
  playerId: string;
  xMilli: number;
  yMilli: number;
  bossCurrentHp: number;
  damageDealt: number;
  connected: boolean;
}

export interface BossRaceSnapshot {
  tick: number;
  state: BossRaceState;
  winnerPlayerId: string;
  winnerTick: number;
  players: BossRacePlayerSnapshot[];
  bullets: BossRaceBullet[];
  stateHash: string;
}

export interface BossRaceConfig {
  matchId: string;
  modeId: string;
  rulesetVersion: string;
  matchSeed: number;
  bossMaxHp: number;
  tickRateHz: number;
  patternPeriodTicks: number;
}

export interface BossRaceInput {
  playerId: string;
  tick: number;
  seq: number;
  directionBits: number;
  slow: boolean;
  shoot: boolean;
  bomb: boolean;
  cardSlot: number;
  modeActionId: string;
}

export function defaultBossRaceConfig(matchId: string, matchSeed: number): BossRaceConfig {
  return {
    matchId,
    modeId: MVP_BOSS_RACE_MODE_ID,
    rulesetVersion: 'mvp-boss-race-s0',
    matchSeed: matchSeed >>> 0,
    bossMaxHp: BOSS_RACE_DEFAULT_BOSS_HP,
    tickRateHz: BOSS_RACE_TICK_RATE_HZ,
    patternPeriodTicks: BOSS_RACE_PATTERN_PERIOD_TICKS,
  };
}

interface PlayerState {
  playerId: string;
  xMilli: number;
  yMilli: number;
  lastSeq: number;
  bossCurrentHp: number;
  damageDealt: number;
  connected: boolean;
  lastInput: BossRaceInput;
}

function emptyInput(playerId: string): BossRaceInput {
  return {
    playerId,
    tick: 0,
    seq: 0,
    directionBits: 0,
    slow: false,
    shoot: false,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  };
}

function clampMilli(value: number, lo: number, hi: number): number {
  const truncated = Math.trunc(value);
  if (truncated < lo) {
    return lo;
  }
  if (truncated > hi) {
    return hi;
  }
  return truncated;
}

/** `std::llround(cos(angle) * speed)` with the same rounding as C++. */
function velocityFromAngle(angleRad: number, speed: number): { vx: number; vy: number } {
  return {
    vx: Math.round(Math.cos(angleRad) * speed),
    vy: Math.round(Math.sin(angleRad) * speed),
  };
}

export class BossRaceSimulation {
  readonly config: BossRaceConfig;

  private currentTick = 0;
  private nextBulletId = 1;
  private state = BossRaceState.Waiting;
  private winnerPlayerId = '';
  private winnerTick = 0;
  private readonly players = new Map<string, PlayerState>();
  private readonly pendingInputsByTick = new Map<number, Map<string, BossRaceInput>>();
  private bullets: BossRaceBullet[] = [];

  constructor(config: BossRaceConfig) {
    this.config = {
      ...config,
      modeId: config.modeId === '' ? MVP_BOSS_RACE_MODE_ID : config.modeId,
      tickRateHz: config.tickRateHz === 0 ? BOSS_RACE_TICK_RATE_HZ : config.tickRateHz,
      bossMaxHp: config.bossMaxHp === 0 ? BOSS_RACE_DEFAULT_BOSS_HP : config.bossMaxHp,
      patternPeriodTicks:
        config.patternPeriodTicks === 0 ? BOSS_RACE_PATTERN_PERIOD_TICKS : config.patternPeriodTicks,
    };
  }

  getState(): BossRaceState {
    return this.state;
  }

  getCurrentTick(): number {
    return this.currentTick;
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  getWinnerPlayerId(): string {
    return this.winnerPlayerId;
  }

  /** Pattern scheduled for a given tick, matching `PatternIdForTick`. */
  patternIdForTick(tick: number): string {
    const period = this.config.patternPeriodTicks;
    const index = Math.floor(tick / period) % BOSS_RACE_PATTERN_COUNT;
    return BOSS_RACE_PATTERN_IDS[index];
  }

  addPlayer(playerId: string, xMilli = 0, yMilli = 0): boolean {
    if (playerId === '' || this.players.size >= BOSS_RACE_MAX_PLAYERS) {
      return false;
    }
    if (this.players.has(playerId)) {
      return false;
    }
    this.players.set(playerId, {
      playerId,
      xMilli: clampMilli(xMilli, -ARENA_HALF_WIDTH_MILLI, ARENA_HALF_WIDTH_MILLI),
      yMilli: clampMilli(yMilli, -ARENA_HALF_HEIGHT_MILLI, ARENA_HALF_HEIGHT_MILLI),
      lastSeq: 0,
      bossCurrentHp: this.config.bossMaxHp,
      damageDealt: 0,
      connected: true,
      lastInput: emptyInput(playerId),
    });
    return true;
  }

  setPlayerConnected(playerId: string, connected: boolean): boolean {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return false;
    }
    player.connected = connected;
    return true;
  }

  /** Mirrors `SubmitInput` validation, including the +/-8 tick input window. */
  submitInput(input: BossRaceInput): boolean {
    if (this.state === BossRaceState.Finished) {
      return false;
    }
    const player = this.players.get(input.playerId);
    if (player === undefined || !player.connected) {
      return false;
    }
    if (input.seq === 0 || input.seq <= player.lastSeq) {
      return false;
    }
    if (input.tick <= this.currentTick || input.tick > this.currentTick + 8) {
      return false;
    }
    if ((input.directionBits & ~DIR_MASK) !== 0) {
      return false;
    }
    player.lastSeq = input.seq;
    let bucket = this.pendingInputsByTick.get(input.tick);
    if (bucket === undefined) {
      bucket = new Map<string, BossRaceInput>();
      this.pendingInputsByTick.set(input.tick, bucket);
    }
    bucket.set(input.playerId, input);
    return true;
  }

  private startIfReady(): void {
    if (this.state !== BossRaceState.Waiting) {
      return;
    }
    if (this.players.size >= BOSS_RACE_MIN_PLAYERS) {
      this.state = BossRaceState.Running;
    }
  }

  private applyPlayerTick(tick: number): void {
    const bucket = this.pendingInputsByTick.get(tick);
    for (const player of this.players.values()) {
      if (!player.connected) {
        continue;
      }
      let input = player.lastInput;
      const pending = bucket?.get(player.playerId);
      if (pending !== undefined) {
        input = pending;
        player.lastInput = input;
      }
      if ((input.directionBits & DIR_UP) !== 0) {
        player.yMilli -= MOVE_MILLI_PER_TICK;
      }
      if ((input.directionBits & DIR_RIGHT) !== 0) {
        player.xMilli += MOVE_MILLI_PER_TICK;
      }
      if ((input.directionBits & DIR_DOWN) !== 0) {
        player.yMilli += MOVE_MILLI_PER_TICK;
      }
      if ((input.directionBits & DIR_LEFT) !== 0) {
        player.xMilli -= MOVE_MILLI_PER_TICK;
      }
      player.xMilli = clampMilli(player.xMilli, -ARENA_HALF_WIDTH_MILLI, ARENA_HALF_WIDTH_MILLI);
      player.yMilli = clampMilli(player.yMilli, -ARENA_HALF_HEIGHT_MILLI, ARENA_HALF_HEIGHT_MILLI);

      if (input.shoot && player.bossCurrentHp > 0) {
        const damage = Math.min(BOSS_RACE_DAMAGE_PER_SHOT_TICK, player.bossCurrentHp);
        player.bossCurrentHp -= damage;
        player.damageDealt += damage;
      }
    }
    if (bucket !== undefined) {
      this.pendingInputsByTick.delete(tick);
    }
  }

  private spawnBulletsForTick(tick: number): void {
    if (tick === 0 || tick % this.config.patternPeriodTicks !== 0) {
      return;
    }
    const patternIndex = Math.floor(tick / this.config.patternPeriodTicks) % BOSS_RACE_PATTERN_COUNT;
    const patternId = BOSS_RACE_PATTERN_IDS[patternIndex];

    for (const player of this.players.values()) {
      if (!player.connected || player.bossCurrentHp === 0) {
        continue;
      }
      let emitted = 0;
      for (const bullet of this.bullets) {
        if (bullet.ownerPlayerId === player.playerId) {
          emitted += 1;
        }
      }
      if (emitted >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
        continue;
      }

      const aim = Math.atan2(player.yMilli - BOSS_ORIGIN_Y_MILLI, player.xMilli - BOSS_ORIGIN_X_MILLI);

      const push = (
        angle: number,
        speed: number,
        radius: number,
        offsetX = 0,
        offsetY = 0,
      ): void => {
        if (emitted >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
          return;
        }
        const velocity = velocityFromAngle(angle, speed);
        this.bullets.push({
          bulletId: `b${this.nextBulletId}`,
          ownerPlayerId: player.playerId,
          xMilli: BOSS_ORIGIN_X_MILLI + offsetX,
          yMilli: BOSS_ORIGIN_Y_MILLI + offsetY,
          vxMilli: velocity.vx,
          vyMilli: velocity.vy,
          radiusMilli: radius,
          patternId,
        });
        this.nextBulletId += 1;
        emitted += 1;
      };

      switch (patternIndex) {
        case 0: // ring
          for (let i = 0; i < 16; i += 1) {
            push((2 * Math.PI * i) / 16, 3000, 4000);
          }
          break;
        case 1: // gap_ring
          for (let i = 0; i < 16; i += 1) {
            if (i % 5 === 0) {
              continue;
            }
            push((2 * Math.PI * i) / 16, 3000, 4000);
          }
          break;
        case 2: // n_way
          for (let i = -2; i <= 2; i += 1) {
            push(aim + i * (Math.PI / 12), 3600, 4200);
          }
          break;
        case 3: // aimed
          push(aim, 4400, 4000);
          break;
        case 4: {
          // seeded_arc
          const offset = (bossRaceDeterministicUnit(this.config.matchSeed, tick, 4, 0) - 0.5) * (Math.PI / 2);
          for (let i = 0; i < 8; i += 1) {
            push(aim + offset + (i - 3.5) * (Math.PI / 16), 3200, 4000);
          }
          break;
        }
        case 5: {
          // spiral
          const base = (tick % 360) * (Math.PI / 180);
          for (let i = 0; i < 4; i += 1) {
            push(base + i * (Math.PI / 2), 3400, 4200);
          }
          break;
        }
        case 6: // laser_curtain
          for (let i = -1; i <= 1; i += 1) {
            push(Math.PI / 2, 1500, 9000, i * 40000, 0);
          }
          break;
        case 7: // homing (straight approximation at fire time)
          push(aim - 0.12, 2600, 4200);
          push(aim + 0.12, 2600, 4200);
          break;
        case 8: {
          // sine_stream
          const wobble = Math.sin(tick * 0.2) * 0.4;
          push(aim + wobble, 3400, 4000);
          break;
        }
        default: {
          // blossom
          for (let i = 0; i < 12; i += 1) {
            push((2 * Math.PI * i) / 12, 2600, 4000);
          }
          for (let i = 0; i < 6; i += 1) {
            push((2 * Math.PI * i) / 6 + Math.PI / 6, 4200, 3600);
          }
          break;
        }
      }
    }
  }

  private advanceBullets(): void {
    for (const bullet of this.bullets) {
      bullet.xMilli += bullet.vxMilli;
      bullet.yMilli += bullet.vyMilli;
    }
    this.bullets = this.bullets.filter(
      (bullet) =>
        Math.abs(bullet.xMilli) <= ARENA_HALF_WIDTH_MILLI + 20000 &&
        Math.abs(bullet.yMilli) <= ARENA_HALF_HEIGHT_MILLI + 20000,
    );
  }

  private checkRaceWinner(tick: number): void {
    if (this.state === BossRaceState.Finished) {
      return;
    }
    // `std::map` iterates in key order; replicate by sorting player ids.
    const ordered = [...this.players.keys()].sort();
    let winner = '';
    for (const playerId of ordered) {
      if (this.players.get(playerId)?.bossCurrentHp === 0) {
        winner = playerId;
        break;
      }
    }
    if (winner !== '') {
      this.state = BossRaceState.Finished;
      this.winnerPlayerId = winner;
      this.winnerTick = tick;
    }
  }

  /** Advance exactly one fixed tick. */
  tick(): BossRaceSnapshot {
    if (this.state === BossRaceState.Finished) {
      return this.snapshot();
    }
    const tickToApply = this.currentTick + 1;
    this.startIfReady();
    if (this.state === BossRaceState.Running) {
      this.applyPlayerTick(tickToApply);
      this.spawnBulletsForTick(tickToApply);
      this.advanceBullets();
      this.checkRaceWinner(tickToApply);
    }
    this.currentTick = tickToApply;
    return this.snapshot();
  }

  snapshot(): BossRaceSnapshot {
    const players: BossRacePlayerSnapshot[] = [];
    for (const playerId of [...this.players.keys()].sort()) {
      const player = this.players.get(playerId);
      if (player === undefined) {
        continue;
      }
      players.push({
        playerId: player.playerId,
        xMilli: player.xMilli,
        yMilli: player.yMilli,
        bossCurrentHp: player.bossCurrentHp,
        damageDealt: player.damageDealt,
        connected: player.connected,
      });
    }
    return {
      tick: this.currentTick,
      state: this.state,
      winnerPlayerId: this.winnerPlayerId,
      winnerTick: this.winnerTick,
      players,
      bullets: this.bullets.map((bullet) => ({ ...bullet })),
      stateHash: this.canonicalStateHash(),
    };
  }

  /** Byte-compatible with `BossRaceSimulation::CanonicalStateHash`. */
  canonicalStateHash(): string {
    let material =
      `${this.config.matchId}|${this.config.matchSeed}|${this.currentTick}|` +
      `${this.state as number}|${this.winnerPlayerId}|${this.winnerTick}`;
    for (const playerId of [...this.players.keys()].sort()) {
      const player = this.players.get(playerId);
      if (player === undefined) {
        continue;
      }
      material += `|p:${playerId}:${player.xMilli}:${player.yMilli}:${player.bossCurrentHp}:${player.damageDealt}`;
    }
    material += `|b:${this.bullets.length}`;
    for (const bullet of this.bullets) {
      material += `|${bullet.bulletId}:${bullet.xMilli}:${bullet.yMilli}`;
    }
    return canonicalHashPair(material);
  }
}

/** Apply a server snapshot to a local simulation for reconciliation. */
export interface SnapshotReconcileResult {
  /** Maximum per-player position error in milli-units. */
  maxPositionErrorMilli: number;
  /** True when the local simulation's canonical hash matches the server's. */
  hashMatch: boolean;
  /** True when the error exceeds the hard-snap threshold and the client should resync. */
  hardSnap: boolean;
}

export const BOSS_RACE_SMOOTH_ERROR_MILLI = 3000;
export const BOSS_RACE_HARD_SNAP_ERROR_MILLI = 24000;

export function classifyReconcile(
  maxPositionErrorMilli: number,
  hashMatch: boolean,
): SnapshotReconcileResult {
  return {
    maxPositionErrorMilli,
    hashMatch,
    hardSnap: !hashMatch || maxPositionErrorMilli > BOSS_RACE_HARD_SNAP_ERROR_MILLI,
  };
}
