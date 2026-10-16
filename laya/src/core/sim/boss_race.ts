/**
 * Authoritative `mvp_boss_race` simulation, ported from
 * `PhK-BattleServer/src/boss_race.cpp`.
 *
 * The client runs this locally for two purposes:
 *  1. Prediction / smoothing between server snapshots.
 *  2. Rendering the local player's own Boss copy and its bullet curtain with the
 *     exact same deterministic pattern timeline the server uses.
 *
 * ★ 单位与浮点：服务端的**权威**坐标是整数 milli（1/1000 px），但弹幕运动学
 * 全程在**像素浮点**里跑（原版场地 640×960），只在快照/哈希边界 `llround` 一次。
 * 客户端以前在 milli 整数上累加、每 tick 各舍入一次，轨迹逐 tick 漂移；现在改为
 * 与服务端同构：`live.motion` 是像素 `BulletMotion`，边界处才折 milli。所有算术
 * 走 `core/math/float_lib`（`sinDeg/cosDeg/normalizeDeg/llround/toMilli`），
 * 这是「客户端插帧和渲染和服务端面板不匹配」的正面修法。
 *
 * ★ 遍历顺序：服务端玩家表是 `std::map<std::string, PlayerState>`，**按 key 升序**
 * 迭代；这决定了两件事 —— 子弹 id 的分配顺序、以及快照里玩家的排列。客户端过去
 * 按 Map 插入序迭代，插入序取决于谁先被 `addPlayer`，因此必须显式按 id 排序。
 *
 * IMPORTANT input-bit convention: the battle server defines
 * `0=up, 1=right, 2=down, 3=left` (i.e. `up=0x1, right=0x2, down=0x4, left=0x8`).
 * This differs from the Godot prototype's `input_codec.gd`
 * (`left=1, right=2, up=4, down=8`). The server is authoritative, so the client
 * encodes inputs using the server convention.
 */

import { normalizeBossRaceSeed, type BossRaceSeed } from '../math/boss_race_seed';
import { bossRaceDeterministicUnit, canonicalHashPair } from '../math/deterministic';
import {
  cosDeg,
  llround,
  MILLI_PER_PIXEL,
  SCREEN_CENTER_X_PX,
  SCREEN_CENTER_Y_PX,
  SCREEN_H_PX,
  SCREEN_W_PX,
  sinDeg,
  toMilli,
  toPixels,
} from '../math/float_lib';
import {
  createBulletMotion,
  createMotionTargets,
  DeterministicRng,
  integrateVelocity,
  updateBulletMotion,
  type BulletMotion,
} from './danmaku/bullet_motion';
import {
  bossRacePatternIds,
  bossRacePatternLibraryCached,
  emitPatternTick,
  TNA_RULESET_VERSION,
  TNA_TIMELINE_IS_PRODUCTION,
  type EmitContext,
  type PatternDef,
} from './danmaku/pattern_timeline';
import {
  bossEmitterOffsetMilli,
  bossTimelinePatternIndexAt,
  findBossCatalogEntry,
  type BossCatalogEntry,
} from './danmaku/boss_catalog';
import { playerBombDamage, playerShotDamage } from './danmaku/player_loadout_damage';

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
 * 真实弹幕（千夜追忆移植）模式库 —— 服务端 `BossRacePatternLibrary()` 的镜像。
 *
 * 顺序即调度顺序（`pattern_index = (tick/45) % 10`）。这里不再是样板时间线：
 * 见 `core/sim/danmaku/pattern_timeline.ts`。
 */
export const BOSS_RACE_TNA_PATTERNS: readonly PatternDef[] = bossRacePatternLibraryCached();

/** 真实弹幕模式 id，顺序即调度顺序。 */
export const BOSS_RACE_TNA_PATTERN_IDS: readonly string[] = bossRacePatternIds();

/**
 * 是否为千夜追忆真实弹幕规则集（`tna-1.40-phase`）。
 *
 * 注意这是「这个字符串是不是 TNA 版本」，**不是**「服务端会不会走真实弹幕」——
 * 后者见 {@link usesRealDanmaku}：服务端只对 `mvp-boss-race-s0` 走合成弹幕，
 * 其余（含大厅当前下发的 `ruleset-local-s0`）一律走真实弹幕。
 */
export function isTnaRuleset(rulesetVersion: string): boolean {
  return rulesetVersion === TNA_RULESET_VERSION;
}

/**
 * Default tick cap, matching the battle server's `--max-ticks 7200` (two
 * minutes at 60Hz). The client uses this only to render a countdown; the server
 * still decides when a match is timed out.
 */
export const BOSS_RACE_DEFAULT_MAX_TICKS = 7200;

/**
 * How many recent per-tick canonical hashes the prediction keeps.
 *
 * `CanonicalStateHash` folds in the tick counter, and a client that predicts is
 * always at least one tick ahead of the snapshot it reconciles against, so
 * hashing "now" can never equal the server's hash for an older tick. Keeping a
 * short history lets the client compare like with like — the hash this
 * simulation produced back when it *was* at the snapshot's tick. 120 ticks is
 * two seconds at 60 Hz, comfortably more than any relay round trip.
 */
export const BOSS_RACE_HASH_HISTORY_TICKS = 120;

export const ARENA_HALF_WIDTH_MILLI = 120000;
export const ARENA_HALF_HEIGHT_MILLI = 90000;
export const BOSS_ORIGIN_X_MILLI = 0;
export const BOSS_ORIGIN_Y_MILLI = -60000;
export const MOVE_MILLI_PER_TICK = 3000;

/**
 * The 640×960 screen the bullet library integrates in, in milli-units.
 *
 * `BossRaceSimulation::AdvanceBullets` culls on the **screen** box
 * (`x < -20 || x > kScreenW + 20`, likewise for y) rather than on the arena box
 * the players are clamped to, so the bounds are ±(320+20)·1000 and
 * ±(480+20)·1000. Culling on the arena bounds instead (which this client used to
 * do) drops bullets the server still has, which alone breaks the state hash.
 */
export const BULLET_CULL_HALF_WIDTH_MILLI = 340000;
export const BULLET_CULL_HALF_HEIGHT_MILLI = 500000;

/** Screen-space (pixel) constants the bullet library works in. */
export { SCREEN_CENTER_X_PX, SCREEN_CENTER_Y_PX, MILLI_PER_PIXEL };

/**
 * The ruleset the C++ server reserves for its legacy 10-pattern synthetic
 * scheduler. `BossRaceSimulation::SpawnBulletsForTick` picks that path **only**
 * for this exact string; every other ruleset — including the `ruleset-local-s0`
 * the lobby currently mints battle tickets with — takes the ported real-danmaku
 * path.
 */
export const MVP_SYNTHETIC_RULESET_VERSION = 'mvp-boss-race-s0';

/**
 * True when a ruleset version selects the real-danmaku path, mirroring the C++
 * branch predicate exactly (including the empty string, which the server treats
 * as "not the legacy ruleset").
 */
export function usesRealDanmaku(rulesetVersion: string): boolean {
  return rulesetVersion !== MVP_SYNTHETIC_RULESET_VERSION;
}

/** Server input direction bits. */
export const DIR_UP = 0x1;
export const DIR_RIGHT = 0x2;
export const DIR_DOWN = 0x4;
export const DIR_LEFT = 0x8;
export const DIR_MASK = 0x0f;

/**
 * The ten legacy synthetic pattern ids, in scheduler order.
 *
 * ★ 这些名字**只属于**客户端的 `mvp-boss-race-s0` 兼容路径（服务端那边的合成
 * 调度器不再给模式起名，`pattern_id` 已改用真实库的 id）。真实弹幕路径用
 * {@link BOSS_RACE_TNA_PATTERN_IDS}。列表本身仍被 `bullet_visual` 的旧版
 * 轨迹分类与 HUD 用着。
 */
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
  /** 真实弹幕：`kEnemyBullet` 值（仅 TNA 规则集有）。 */
  bulletKind?: number;
  /** 真实弹幕：`bulletFunc` 编号（仅 TNA 规则集有）。 */
  motionFunc?: number;
  /** 真实弹幕：当前朝向（度，仅 TNA 规则集有）。 */
  angleDeg?: number;
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

/**
 * 每玩家自机 loadout —— 服务端 `phk::battle::PlayerLoadoutSpec` 的镜像。
 *
 * `shotType` / `bombType` 取自 `danmaku/player_loadout.ts` 的名字空间；为空 =
 * 默认自机行为（复现现状）。`characterId` 仅作透传/展示（协议白名单在服务端）。
 */
export interface BossRaceLoadout {
  playerId: string;
  characterId: string;
  shotType: string;
  bombType: string;
}

export interface BossRaceConfig {
  matchId: string;
  modeId: string;
  rulesetVersion: string;
  /** Full-width match seed — see `BossRaceSeed` for why it is not a `number`. */
  matchSeed: BossRaceSeed;
  bossMaxHp: number;
  tickRateHz: number;
  patternPeriodTicks: number;
  /**
   * 房间级 boss 选择（`tian` / `hui`）；空 = 默认 timeline（复现现状）。
   * 命中目录时 pattern 调度与发射点偏移均由 `danmaku/boss_catalog` 驱动，
   * 与服务端 `BossRaceSimulation::PatternIndexForTick` / `BossEmitterOffsetMilli`
   * 逐位一致。
   */
  bossId?: string;
  /** 每玩家自机 loadout（空/缺省 = 默认自机行为）。 */
  loadouts?: readonly BossRaceLoadout[];
  /**
   * Whether the real-danmaku timeline in this build is the reverse-engineered
   * production one. Defaults to {@link TNA_TIMELINE_IS_PRODUCTION} — now `true`,
   * because the library here **is** the server's. Only tests that want to
   * exercise the "provisional timeline" branch override it.
   *
   * See {@link BossRaceSimulation.hashComparable}.
   */
  realDanmakuIsProduction?: boolean;
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

export function defaultBossRaceConfig(
  matchId: string,
  matchSeed: BossRaceSeed | number,
): BossRaceConfig {
  return {
    matchId,
    modeId: MVP_BOSS_RACE_MODE_ID,
    rulesetVersion: MVP_SYNTHETIC_RULESET_VERSION,
    matchSeed: normalizeBossRaceSeed(matchSeed),
    bossMaxHp: BOSS_RACE_DEFAULT_BOSS_HP,
    tickRateHz: BOSS_RACE_TICK_RATE_HZ,
    patternPeriodTicks: BOSS_RACE_PATTERN_PERIOD_TICKS,
  };
}

/**
 * 真实弹幕规则集配置（`tna-1.40-phase`）。服务端切换后客户端与之对齐。
 */
export function defaultTnaBossRaceConfig(
  matchId: string,
  matchSeed: BossRaceSeed | number,
): BossRaceConfig {
  return {
    ...defaultBossRaceConfig(matchId, matchSeed),
    rulesetVersion: TNA_RULESET_VERSION,
    patternPeriodTicks: BOSS_RACE_TNA_PATTERNS[0]?.period_ticks ?? BOSS_RACE_PATTERN_PERIOD_TICKS,
  };
}

/**
 * Config for whatever ruleset the battle ticket carries.
 *
 * The lobby signs the ticket with `RulesetVersion` from the protocol manifest
 * (`ruleset-local-s0` today), which is **not** the legacy `mvp-boss-race-s0`, so
 * the battle server runs its real-danmaku path. Building the client prediction
 * with `defaultBossRaceConfig` regardless — as this client used to — put the two
 * sides on different bullet models, so the bullet sets could never agree.
 */
export function bossRaceConfigForRuleset(
  matchId: string,
  matchSeed: BossRaceSeed | number,
  rulesetVersion: string,
): BossRaceConfig {
  return usesRealDanmaku(rulesetVersion)
    ? defaultTnaBossRaceConfig(matchId, matchSeed)
    : defaultBossRaceConfig(matchId, matchSeed);
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

/**
 * 一颗在场子弹 —— 对应服务端 `struct LiveBullet`。
 *
 * `motion` 是**像素浮点**运动状态（`bullet_motion` 的 `BulletMotion`），
 * 两条路径（真实 / 合成）共用同一种表示，因此推进逻辑只有一份。
 */
interface LiveBullet {
  bulletId: string;
  ownerPlayerId: string;
  patternId: string;
  patternIndex: number;
  spawnIndex: number;
  motion: BulletMotion;
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

/** 屏幕系发射点 —— 服务端 `ctx.emitter_x/y = kScreenCenter + ToPixels(origin)`。 */
const EMITTER_X_PX = SCREEN_CENTER_X_PX + toPixels(BOSS_ORIGIN_X_MILLI);
const EMITTER_Y_PX = SCREEN_CENTER_Y_PX + toPixels(BOSS_ORIGIN_Y_MILLI);

/** 屏幕系自机坐标 —— 服务端 `kScreenCenter + ToPixels(player.x_milli)`。 */
function shipXpx(xMilli: number): number {
  return SCREEN_CENTER_X_PX + toPixels(xMilli);
}

function shipYpx(yMilli: number): number {
  return SCREEN_CENTER_Y_PX + toPixels(yMilli);
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
  private liveBullets: LiveBullet[] = [];
  /** 解析后的 boss 目录项（bossId 为空/未知 → null = 默认 timeline）。 */
  private readonly bossEntry: BossCatalogEntry | null;
  /** 已解析的每玩家 shot/bomb 伤害（无 loadout → 缺省，走 BOSS_RACE_DAMAGE_PER_SHOT_TICK）。 */
  private readonly shotDamageByPlayer = new Map<string, number>();
  private readonly bombDamageByPlayer = new Map<string, number>();
  /**
   * `tick -> canonicalStateHash`, oldest first. Ticks only ever move forward, so
   * insertion order is tick order and the first key is always the oldest.
   */
  private readonly hashHistory = new Map<number, string>();

  constructor(config: BossRaceConfig) {
    this.bossEntry = findBossCatalogEntry(config.bossId ?? '');
    const catalogHp = this.bossEntry === null ? null : this.bossEntry.bossMaxHp;
    this.config = {
      ...config,
      modeId: config.modeId === '' ? MVP_BOSS_RACE_MODE_ID : config.modeId,
      tickRateHz: config.tickRateHz === 0 ? BOSS_RACE_TICK_RATE_HZ : config.tickRateHz,
      // boss 目录存在时以目录 HP 为准（与服务端 MakeBossRaceConfig/BossRaceSimulation 一致）。
      bossMaxHp:
        config.bossMaxHp === 0 ? catalogHp ?? BOSS_RACE_DEFAULT_BOSS_HP : config.bossMaxHp,
      patternPeriodTicks:
        config.patternPeriodTicks === 0 ? BOSS_RACE_PATTERN_PERIOD_TICKS : config.patternPeriodTicks,
    };
    for (const loadout of config.loadouts ?? []) {
      if (loadout.playerId === '') {
        continue;
      }
      if (loadout.shotType !== '') {
        this.shotDamageByPlayer.set(loadout.playerId, playerShotDamage(loadout.shotType));
      }
      if (loadout.bombType !== '') {
        this.bombDamageByPlayer.set(loadout.playerId, playerBombDamage(loadout.bombType));
      }
    }
  }

  /** 已解析的 boss 目录项（无 boss / 未知 boss → null）。 */
  getBossEntry(): BossCatalogEntry | null {
    return this.bossEntry;
  }

  /**
   * 该 tick 使用的库内 pattern index —— 服务端 `PatternIndexForTick` 的镜像。
   *
   * boss 目录命中时按阶段组展开（`bossTimelinePatternIndexAt`），否则回退原
   * `(tick / period) % 10` 轮转（默认路径逐位保持现状）。
   */
  patternIndexForTick(tick: number): number {
    const period =
      this.config.patternPeriodTicks === 0 ? BOSS_RACE_PATTERN_PERIOD_TICKS : this.config.patternPeriodTicks;
    const waveIndex = Math.floor(tick / period);
    if (this.bossEntry !== null) {
      return bossTimelinePatternIndexAt(this.bossEntry, waveIndex, BOSS_RACE_TNA_PATTERN_IDS);
    }
    return waveIndex % BOSS_RACE_PATTERN_COUNT;
  }

  /** 某 tick 的 boss 发射点偏移（milli）；无 boss → (0, 0)。 */
  private bossOffsetForTick(tick: number): { xMilli: number; yMilli: number } {
    if (this.bossEntry === null) {
      return { xMilli: 0, yMilli: 0 };
    }
    return bossEmitterOffsetMilli(this.bossEntry.movement, tick);
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

  /** Player ids in `std::map` key order — the order the server iterates in. */
  private sortedPlayerIds(): string[] {
    return [...this.players.keys()].sort();
  }

  /** Pattern scheduled for a given tick, matching `PatternIdForTick`. */
  patternIdForTick(tick: number): string {
    const index = this.patternIndexForTick(tick);
    if (this.usesRealDanmaku()) {
      return BOSS_RACE_TNA_PATTERN_IDS[index] ?? '';
    }
    return BOSS_RACE_PATTERN_IDS[index % BOSS_RACE_PATTERN_COUNT];
  }

  /** True when this simulation mirrors the ported 千夜追忆 danmaku timeline. */
  isTnaRuleset(): boolean {
    return isTnaRuleset(this.config.rulesetVersion);
  }

  /**
   * True when this simulation must take the real-danmaku path.
   *
   * Mirrors `BossRaceSimulation::SpawnBulletsForTick` exactly: the legacy
   * synthetic scheduler runs only for {@link MVP_SYNTHETIC_RULESET_VERSION}.
   */
  usesRealDanmaku(): boolean {
    return usesRealDanmaku(this.config.rulesetVersion);
  }

  /**
   * True when this simulation's bullet set is expected to reproduce the server's
   * exactly — which is both when a `CanonicalStateHash` comparison carries
   * information **and** when the local bullet set is worth maintaining at all.
   *
   * The legacy synthetic scheduler is a faithful port, so it is comparable. The
   * real-danmaku path is comparable because the library in
   * `core/sim/danmaku/pattern_timeline` **is** the server's — see
   * `TNA_TIMELINE_IS_PRODUCTION`. Should a future build ship a provisional
   * timeline again, this flag lets the simulation drop the bullet set rather than
   * report a count the server never had.
   */
  hashComparable(): boolean {
    if (!this.usesRealDanmaku()) {
      return true;
    }
    return this.config.realDanmakuIsProduction ?? TNA_TIMELINE_IS_PRODUCTION;
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

  /**
   * Adopts an authoritative server snapshot into the local prediction.
   *
   * `BattleClient` calls this to bootstrap the prediction and to recover from a
   * hard snap. Without it the local simulation only ever *measured* its error
   * against the server (see `classifyReconcile`) but was never corrected: it
   * kept the `addPlayer(playerId)` default spawn `(0, 0)` and its own tick
   * counter from 0, so against a server that spawns at `(±20000, 60000)` every
   * snapshot reported the same constant 60000-milli error and every frame
   * hard-snapped, making the local prediction dead weight.
   *
   * `alignTick` additionally raises the local tick to the server's. It never
   * rewinds — a rewind would invalidate inputs already sent for ticks the server
   * has not consumed yet, and the server rejects `tick <= current_tick` — and it
   * drops buffered inputs that target ticks the server has already passed.
   */
  adoptAuthoritativeSnapshot(
    snapshot: BossRaceSnapshot,
    options: { alignTick?: boolean } = {},
  ): void {
    if (options.alignTick === true && snapshot.tick > this.currentTick) {
      this.currentTick = snapshot.tick;
      this.pendingInputsByTick.clear();
    }
    this.state = snapshot.state as BossRaceState;
    this.winnerPlayerId = snapshot.winnerPlayerId;
    this.winnerTick = snapshot.winnerTick;
    for (const serverPlayer of snapshot.players) {
      if (!this.players.has(serverPlayer.playerId)) {
        this.addPlayer(serverPlayer.playerId, serverPlayer.xMilli, serverPlayer.yMilli);
      }
      const player = this.players.get(serverPlayer.playerId);
      if (player === undefined) {
        // The roster is full (`BOSS_RACE_MAX_PLAYERS`) or the id was empty, so
        // this simulation cannot hold the player. Skip it rather than evicting
        // one it already tracks.
        continue;
      }
      player.xMilli = clampMilli(serverPlayer.xMilli, -ARENA_HALF_WIDTH_MILLI, ARENA_HALF_WIDTH_MILLI);
      player.yMilli = clampMilli(serverPlayer.yMilli, -ARENA_HALF_HEIGHT_MILLI, ARENA_HALF_HEIGHT_MILLI);
      player.bossCurrentHp = serverPlayer.bossCurrentHp;
      player.damageDealt = serverPlayer.damageDealt;
      player.connected = serverPlayer.connected;
    }
    // Record the adopted state too, so the very first reconciliation has a hash
    // for the tick the snapshot was taken at.
    this.rememberHash(this.currentTick);
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
    for (const playerId of this.sortedPlayerIds()) {
      const player = this.players.get(playerId);
      if (player === undefined || !player.connected) {
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

      // 伤害：默认每 tick BOSS_RACE_DAMAGE_PER_SHOT_TICK（与现状一致）。
      // 配置自机 loadout 后改为真实自机表（shot 主弹伤害 / bomb 主弹伤害），
      // 与服务端 `ApplyPlayerTick` 逐位一致。
      if (player.bossCurrentHp > 0) {
        let tickDamage = 0;
        if (input.shoot) {
          tickDamage += BOSS_RACE_DAMAGE_PER_SHOT_TICK;
          const shotDamage = this.shotDamageByPlayer.get(player.playerId);
          if (shotDamage !== undefined && shotDamage >= 0) {
            tickDamage = shotDamage;
          }
        }
        if (input.bomb) {
          const bombDamage = this.bombDamageByPlayer.get(player.playerId);
          if (bombDamage !== undefined && bombDamage >= 0) {
            tickDamage += bombDamage;
          }
        }
        if (tickDamage > 0) {
          const damage = Math.min(tickDamage, player.bossCurrentHp);
          player.bossCurrentHp -= damage;
          player.damageDealt += damage;
        }
      }
    }
    if (bucket !== undefined) {
      this.pendingInputsByTick.delete(tick);
    }
  }

  /** `EmittedBulletsFor` — count of live bullets owned by one player. */
  private emittedBulletsFor(playerId: string): number {
    let count = 0;
    for (const live of this.liveBullets) {
      if (live.ownerPlayerId === playerId) {
        count += 1;
      }
    }
    return count;
  }

  private spawnBulletsForTick(tick: number): void {
    // 主路径 = 真实弹幕；旧合成弹幕仅在 mvp-boss-race-s0 下保留兼容。
    if (!this.hashComparable()) {
      return;
    }
    if (this.usesRealDanmaku()) {
      this.spawnRealBulletsForTick(tick);
    } else {
      this.spawnSyntheticBulletsForTick(tick);
    }
  }

  /** `SpawnRealBulletsForTick` —— 服务端真实弹幕路径的逐行镜像。 */
  private spawnRealBulletsForTick(tick: number): void {
    if (tick === 0 || tick % this.config.patternPeriodTicks !== 0) {
      return;
    }
    const patternIndex = this.patternIndexForTick(tick);
    const def = BOSS_RACE_TNA_PATTERNS[patternIndex];
    if (def === undefined) {
      return;
    }
    // boss 移动：整数三角波发射点偏移（无 boss → (0,0)，与现状一致）。
    const bossOffset = this.bossOffsetForTick(tick);

    for (const playerId of this.sortedPlayerIds()) {
      const player = this.players.get(playerId);
      if (player === undefined || !player.connected || player.bossCurrentHp === 0) {
        continue;
      }
      if (this.emittedBulletsFor(playerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
        continue;
      }

      // 与服务端 `kScreenCenter + ToPixels(origin + offset)` 逐位一致：
      // 先把 milli 相加再除，避免 a/1000 + b/1000 的末位差异。
      const ctx: EmitContext = {
        emitter_x: SCREEN_CENTER_X_PX + toPixels(BOSS_ORIGIN_X_MILLI + bossOffset.xMilli),
        emitter_y: SCREEN_CENTER_Y_PX + toPixels(BOSS_ORIGIN_Y_MILLI + bossOffset.yMilli),
      };
      const targets = createMotionTargets({
        has_my_ship: true,
        my_ship_x: shipXpx(player.xMilli),
        my_ship_y: shipYpx(player.yMilli),
        has_enemy: true,
        enemy_x: ctx.emitter_x,
        enemy_y: ctx.emitter_y,
      });

      const emitted = emitPatternTick(def, tick, ctx, targets);

      let spawnIndex = 0;
      for (const motion of emitted) {
        if (this.emittedBulletsFor(playerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
          break;
        }
        this.liveBullets.push({
          bulletId: `b${this.nextBulletId}`,
          ownerPlayerId: playerId,
          patternId: def.id,
          patternIndex,
          spawnIndex: spawnIndex++,
          motion,
        });
        this.nextBulletId += 1;
      }
    }
  }

  /**
   * `mvp-boss-race-s0` 兼容路径：保留旧 10 个合成模式（非主路径）。
   *
   * 与真实路径共用同一套 `BulletMotion` 表示与推进逻辑，只是发射参数不同 ——
   * 服务端也是同一个 `push` lambda 造 `BulletMotion` 再交给 `AdvanceBullets`。
   */
  private spawnSyntheticBulletsForTick(tick: number): void {
    if (tick === 0 || tick % this.config.patternPeriodTicks !== 0) {
      return;
    }
    const patternIndex = Math.floor(tick / this.config.patternPeriodTicks) % BOSS_RACE_PATTERN_COUNT;
    const patternId = BOSS_RACE_PATTERN_IDS[patternIndex];

    for (const playerId of this.sortedPlayerIds()) {
      const player = this.players.get(playerId);
      if (player === undefined || !player.connected || player.bossCurrentHp === 0) {
        continue;
      }
      if (this.emittedBulletsFor(playerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
        continue;
      }

      const aim = Math.atan2(
        player.yMilli - BOSS_ORIGIN_Y_MILLI,
        player.xMilli - BOSS_ORIGIN_X_MILLI,
      );

      let spawnIndex = 0;
      const push = (
        angleRad: number,
        speedMilli: number,
        radiusMilli: number,
        offsetXMilli = 0,
        offsetYMilli = 0,
      ): void => {
        if (this.emittedBulletsFor(playerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
          return;
        }
        const motion = createBulletMotion();
        motion.x = EMITTER_X_PX + toPixels(offsetXMilli);
        motion.y = EMITTER_Y_PX + toPixels(offsetYMilli);
        motion.angle = angleRad * (180 / Math.PI);
        motion.angle_init = -1;
        motion.speed = toPixels(speedMilli);
        motion.spd_init2 = motion.speed;
        motion.bullet_func_no = 0;
        motion.hit_dis = toPixels(radiusMilli);
        integrateVelocity(motion);
        this.liveBullets.push({
          bulletId: `b${this.nextBulletId}`,
          ownerPlayerId: playerId,
          patternId,
          patternIndex,
          spawnIndex: spawnIndex++,
          motion,
        });
        this.nextBulletId += 1;
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

  /**
   * Mirrors `BossRaceSimulation::AdvanceBullets`'s cull: the screen box the
   * bullet library integrates in, not the (smaller) arena box players are
   * clamped to. See {@link BULLET_CULL_HALF_WIDTH_MILLI}.
   */
  private static keepsBullet(live: LiveBullet): boolean {
    const m = live.motion;
    return !(m.x < -20 || m.x > SCREEN_W_PX + 20 || m.y < -20 || m.y > SCREEN_H_PX + 20);
  }

  /**
   * `AdvanceBullets` —— 逐 tick 推进全部在场子弹。
   *
   * 每颗子弹：
   *  1. 组 `MotionTargets`（自机 = 拥有者当前像素坐标，敌机 = 发射点）；
   *  2. `DeterministicRng(match_seed, tick, pattern_index, spawn_index)`；
   *  3. `updateBulletMotion`（delay → 角积分 → bulletFunc → IntegrateVelocity）；
   *  4. `x += vx; y += vy; t += 1`；
   * 最后按屏幕盒剔除。
   */
  private advanceBullets(tick: number): void {
    if (!this.hashComparable()) {
      return;
    }
    // 敌机（boss）随三角波移动；无 boss → 常量发射点（与现状一致）。
    const bossOffset = this.bossOffsetForTick(tick);
    const enemyX = SCREEN_CENTER_X_PX + toPixels(BOSS_ORIGIN_X_MILLI + bossOffset.xMilli);
    const enemyY = SCREEN_CENTER_Y_PX + toPixels(BOSS_ORIGIN_Y_MILLI + bossOffset.yMilli);
    for (const live of this.liveBullets) {
      const targets = createMotionTargets({
        has_enemy: true,
        enemy_x: enemyX,
        enemy_y: enemyY,
      });
      const owner = this.players.get(live.ownerPlayerId);
      if (owner !== undefined) {
        targets.has_my_ship = true;
        targets.my_ship_x = shipXpx(owner.xMilli);
        targets.my_ship_y = shipYpx(owner.yMilli);
      }

      const rng = new DeterministicRng(this.config.matchSeed, tick, live.patternIndex, live.spawnIndex);
      updateBulletMotion(live.motion, targets, rng);
      live.motion.x += live.motion.vx;
      live.motion.y += live.motion.vy;
      live.motion.t += 1;
    }
    this.liveBullets = this.liveBullets.filter((live) => BossRaceSimulation.keepsBullet(live));
  }

  private checkRaceWinner(tick: number): void {
    if (this.state === BossRaceState.Finished) {
      return;
    }
    // `std::map` iterates in key order; replicate by sorting player ids.
    let winner = '';
    for (const playerId of this.sortedPlayerIds()) {
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
      this.advanceBullets(tickToApply);
      this.checkRaceWinner(tickToApply);
    }
    this.currentTick = tickToApply;
    this.rememberHash(tickToApply);
    return this.snapshot();
  }

  /**
   * The canonical hash this simulation produced when it was at `tick`, or `null`
   * when that tick is outside the retained history.
   *
   * Lets a predicting client compare its replay against a server snapshot taken
   * at an older tick; see {@link BOSS_RACE_HASH_HISTORY_TICKS}.
   */
  hashAtTick(tick: number): string | null {
    return this.hashHistory.get(tick) ?? null;
  }

  private rememberHash(tick: number): void {
    this.hashHistory.set(tick, this.canonicalStateHash());
    while (this.hashHistory.size > BOSS_RACE_HASH_HISTORY_TICKS) {
      const oldest = this.hashHistory.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.hashHistory.delete(oldest.value);
    }
  }

  snapshot(): BossRaceSnapshot {
    const players: BossRacePlayerSnapshot[] = [];
    for (const playerId of this.sortedPlayerIds()) {
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
    const real = this.usesRealDanmaku();
    const bullets: BossRaceBullet[] = this.liveBullets.map((live) => {
      const m = live.motion;
      const bullet: BossRaceBullet = {
        bulletId: live.bulletId,
        ownerPlayerId: live.ownerPlayerId,
        xMilli: toMilli(m.x - SCREEN_CENTER_X_PX),
        yMilli: toMilli(m.y - SCREEN_CENTER_Y_PX),
        vxMilli: toMilli(m.vx),
        vyMilli: toMilli(m.vy),
        radiusMilli: llround(m.hit_dis * MILLI_PER_PIXEL),
        patternId: live.patternId,
      };
      if (real) {
        bullet.bulletKind = m.bullet_kind;
        bullet.motionFunc = m.bullet_func_no;
        bullet.angleDeg = m.angle;
      }
      return bullet;
    });
    return {
      tick: this.currentTick,
      state: this.state,
      winnerPlayerId: this.winnerPlayerId,
      winnerTick: this.winnerTick,
      players,
      bullets,
      stateHash: this.canonicalStateHash(),
    };
  }

  /**
   * Byte-compatible with `BossRaceSimulation::CanonicalStateHash`.
   *
   * The material is
   * `match_id | match_seed | tick | state | winner | winner_tick`,
   * then `|p:<id>:<x>:<y>:<hp>:<dmg>` per player in id order (`std::map`
   * iterates in key order), then `|b:<count>`, then
   * `|<id>:<x>:<y>:<kind>:<func>` per live bullet.
   *
   * Three things are easy to get wrong and all three were wrong here:
   *  - the seed is printed **in full** (`std::to_string(uint64_t)`), so the
   *    decimal text of the whole 64-bit value is used, not its low 32 bits;
   *  - every bullet contributes its `bullet_kind` and `bullet_func_no`, which
   *    the snapshot protocol does not carry but the simulation does. Omitting
   *    them made the material shorter than the server's for any bullet at all;
   *  - the per-bullet position is `ToMilli(x - kScreenCenterX)`, i.e. folded from
   *    the **pixel** motion once, not accumulated in milli.
   */
  canonicalStateHash(): string {
    let material =
      `${this.config.matchId}|${this.config.matchSeed.decimal}|${this.currentTick}|` +
      `${this.state as number}|${this.winnerPlayerId}|${this.winnerTick}`;
    for (const playerId of this.sortedPlayerIds()) {
      const player = this.players.get(playerId);
      if (player === undefined) {
        continue;
      }
      material += `|p:${playerId}:${player.xMilli}:${player.yMilli}:${player.bossCurrentHp}:${player.damageDealt}`;
    }
    material += `|b:${this.liveBullets.length}`;
    for (const live of this.liveBullets) {
      const m = live.motion;
      material +=
        `|${live.bulletId}:${toMilli(m.x - SCREEN_CENTER_X_PX)}:${toMilli(m.y - SCREEN_CENTER_Y_PX)}:` +
        `${m.bullet_kind}:${m.bullet_func_no}`;
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
    // Only a position error justifies discarding the prediction. A hash
    // mismatch on its own means the local *bullet* set differs, which resyncing
    // the players cannot repair — and for any ruleset whose client-side bullet
    // timeline is still provisional it mismatches by construction, so folding it
    // in here made every single frame look like a desync.
    hardSnap: maxPositionErrorMilli > BOSS_RACE_HARD_SNAP_ERROR_MILLI,
  };
}

// 三角函数从统一浮点库转出（历史导出名保留，避免调用点批量改动）。
export { cosDeg, sinDeg };
