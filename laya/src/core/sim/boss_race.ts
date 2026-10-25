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
  CHAIN_SPLIT_CHILDREN_PER_HOST,
  CHAIN_SPLIT_HOSTS_PER_PLAYER_PER_TICK,
  CHAIN_SPLIT_MAX_GENERATION,
  chainSplitRequested,
  computeChainSplitChildren,
  makeChainSplitChildMotion,
} from './danmaku/chain_split';
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
import {
  accrueCardEnergy,
  applyCast,
  buildCardActivation,
  createHandState,
  trimCardId,
  type CardDefinition,
  type HandState,
} from './card_hand';
import {
  applyBulletPurge,
  applyFinisher,
  applyInvulnerable,
  applyOpponentPattern,
  type CardBulletDelta,
  type CardBulletSnapshot,
  type CardEffectResult,
  type CardPlayerSnapshot,
} from './card_effects';

export const MVP_BOSS_RACE_MODE_ID = 'mvp_boss_race';
/**
 * 权威 tick 率：**64**（千夜贴引擎迁移，2026-10-24 冻结）。
 *
 * ★ 这是「每秒多算 4 tick」的**真实加速**，不是把原 60 采样重排：镜像层所有
 * 「每帧」常量（速度 px/帧、角度增量 °/帧、周期 tick 数 45/90/600……）数值
 * 原样保留，直接当「每 tick」用。**禁止**任何 ×60/64 缩放 —— 唯一改动就是
 * 这一处（及随它派生的倒计时/秒换算）。
 */
export const BOSS_RACE_TICK_RATE_HZ = 64;
export const BOSS_RACE_DEFAULT_BOSS_HP = 6000;
export const BOSS_RACE_DAMAGE_PER_SHOT_TICK = 10;
export const BOSS_RACE_PATTERN_PERIOD_TICKS = 45;
export const BOSS_RACE_MAX_BULLETS_PER_PLAYER = 384;
export const BOSS_RACE_MAX_PLAYERS = 2;
export const BOSS_RACE_MIN_PLAYERS = 2;
export const BOSS_RACE_PATTERN_COUNT = 10;

/**
 * The boss-race per-tick damage rule — the pure function behind C++
 * `BossRaceSimulation::ApplyPlayerTick` (`boss_race.cpp:395-414`).
 *
 * The rule, verbatim from the server:
 *
 *  - shooting adds {@link BOSS_RACE_DAMAGE_PER_SHOT_TICK} (10) per tick, and a
 *    configured self loadout **replaces** that number with the loadout table's
 *    main-shot damage (`tick_damage = spec->damage` — a replace, not an add);
 *  - a bomb **adds** the loadout table's bomb damage on top;
 *  - without a loadout the bomb contributes nothing at all (the server's
 *    `PlayerBombSpecFor` returns `nullptr`).
 *
 * @param shotDamage the loadout's main-shot damage, or `undefined` without a loadout
 * @param bombDamage the loadout's bomb damage, or `undefined` without a loadout
 */
export function bossRaceTickDamage(
  shoot: boolean,
  bomb: boolean,
  shotDamage: number | undefined,
  bombDamage: number | undefined,
): number {
  let damage = 0;
  if (shoot) {
    damage += BOSS_RACE_DAMAGE_PER_SHOT_TICK;
    if (shotDamage !== undefined && shotDamage >= 0) {
      damage = shotDamage;
    }
  }
  if (bomb) {
    if (bombDamage !== undefined && bombDamage >= 0) {
      damage += bombDamage;
    }
  }
  return damage;
}

/**
 * The focus ("集中") movement speed — C++ `BattleSimulation::ApplyInput`
 * (`simulation.cpp:2181`): `const std::int32_t speed = input.slow ? 2500 : 5000;`.
 *
 * ★ The **boss-race** mode does not model focus: the C++ race simulation moves
 * the ship by a flat 3000 milli/tick whatever `slow` says
 * (`boss_race.cpp:356-369`), and this client mirrors that server byte for
 * byte — applying the half-speed rule here would make the local prediction
 * lag the authoritative one and hard-snap every frame. The rule is ported so
 * the shared-boss mode can use it unchanged, and so the server-side gap is
 * visible in one place.
 */
export const FOCUS_MOVE_SPEED_MILLI = 2500;
export const NORMAL_MOVE_SPEED_MILLI = 5000;

/**
 * The movement speed while the focus key is held: half the normal speed.
 *
 * Mirrors `simulation.cpp:2181` (5000 → 2500). Pass the mode's own normal
 * speed so the ratio stays the server's.
 */
export function focusMoveSpeed(normalSpeedMilli: number, slow: boolean): number {
  return slow ? Math.trunc(normalSpeedMilli / 2) : normalSpeedMilli;
}

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
 * Client-side tick cap used when the ticket/room does not carry one.
 *
 * The battle server has **no** default cap: `MatchLifecycleConfig::max_ticks`
 * defaults to `0` = unlimited and `main.cpp` only applies `--max-ticks` when it
 * is non-zero, so the real limit always arrives from the lobby. This constant
 * is therefore only a *display/safety* fallback (the countdown row needs a
 * number), kept at the historical 7200 ticks — 112.5 s at 64 Hz — so the tick
 * semantics stay continuous with the 60 Hz era. The server still decides when a
 * match times out.
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
 * under two seconds at 64 Hz, comfortably more than any relay round trip.
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

/**
 * The 640×960 **screen box** in centered milli — the world bullets actually
 * live in (`BossRaceSimulation` integrates in screen coordinates and culls on
 * this box). The arena box above (±120000/±90000) is only where *players* are
 * clamped; bullets fly across the whole screen, so the render transform maps
 * THIS box, not the arena. Mirrors `kScreenW/kScreenH` (`boss_race.cpp:26-27`),
 * i.e. the APK's field.
 */
export const SCREEN_HALF_WIDTH_MILLI = (SCREEN_W_PX / 2) * MILLI_PER_PIXEL;
export const SCREEN_HALF_HEIGHT_MILLI = (SCREEN_H_PX / 2) * MILLI_PER_PIXEL;

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

/**
 * 弹幕机制（玩家受击判定）规则集 —— 服务端
 * `kRulesetDanmakuMechanics`（`boss_race.hpp:44`）的镜像。
 *
 * 只有这个字符串启用机制分支（命中/擦弹/无敌帧/残机/炸弹消耗）；其余 ruleset
 * （含默认 `mvp-boss-race-s0` 与真实弹幕 `tna-1.40-phase`）逐字节保持现状。
 * 同一开关在服务端还启用自机弹实体/符卡阶段/铁拳/帷幕（§2.4），那些的权威
 * 判定在服务端，客户端只镜像表现（见视图层）。
 */
export const RULESET_DANMAKU_MECHANICS = 'tna-1.40-danmaku';

/** `usesDanmakuMechanics` —— C++ `mechanics_.enabled`（`boss_race.cpp:161-162`）。 */
export function usesDanmakuMechanics(rulesetVersion: string): boolean {
  return rulesetVersion === RULESET_DANMAKU_MECHANICS;
}

// 玩家受击判定常量（§2.4 第 2 条，单位 milli；只在 RULESET_DANMAKU_MECHANICS
// 下生效）。数值与服务端 `boss_race.hpp:47-51` 逐位对齐。
export const DANMAKU_HIT_RADIUS_MILLI = 3000; // r_hit ≈3px（判定点）
export const DANMAKU_GRAZE_RADIUS_MILLI = 20000; // r_graze ≈20px（擦弹圈）
/** 命中/炸弹后的无敌帧时长（tick）。 */
export const DANMAKU_INVULNERABLE_TICKS = 120;
export const DANMAKU_DEFAULT_LIVES = 3;
export const DANMAKU_DEFAULT_BOMBS = 3;

/**
 * 快照占位值（`boss_race.hpp:192-193`）：判定系统未启用时服务端 wire 仍带
 * 这些字段，取「满状态」占位。客户端快照缺省时视图层按同值兜底。
 */
export const SNAPSHOT_DEFAULT_LIVES = 1;
export const SNAPSHOT_DEFAULT_BOMBS = 3;

// 判定事件类型（`boss_race.hpp:54-57`，进快照 events[].type）。
export const PLAYER_HIT_EVENT = 'player_hit';
export const PLAYER_GRAZE_EVENT = 'player_graze';
export const PLAYER_DEAD_EVENT = 'player_dead';
export const BOMB_USED_EVENT = 'bomb_used';

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
  /** §2.8 链式弹幕：所属链 id（服务端未给时缺省）。 */
  chainId?: string;
  /** §2.8 链式弹幕：链上代数（0 = 根波次）。 */
  generation?: number;
  /**
   * §2.8 黑色帷幕 `hold` 期：判定照算但**客户端不渲染**。
   * 渲染层必须跳过 `hidden === true` 的子弹（见 `buildBossRaceFrame`）。
   */
  hidden?: boolean;
}

export interface BossRacePlayerSnapshot {
  playerId: string;
  xMilli: number;
  yMilli: number;
  bossCurrentHp: number;
  damageDealt: number;
  connected: boolean;
  /** §2.8：本 tick 速度（milli/tick），供插值外推。 */
  vxMilli?: number;
  vyMilli?: number;
  /** §2.8：朝向，0.01°（9000 = 90°）。 */
  facingMillideg?: number;
  lives?: number;
  bombs?: number;
  /** 服务端 tick 计时；`> tick` 表示无敌帧中。 */
  invulnerableUntilTick?: number;
  graze?: number;
  /**
   * P7 计分读数 —— **纯展示透传**，客户端不重算。
   *
   * `score` 总分（TNA 口径：擦弹分 × 自机乘区 + 符卡获取 + 击破 + 结算奖励）、
   * `hitCount` 受击数、`spellGet`/`spellTotal` 符卡获取数与总数。四个字段的
   * 权威都在服务端：本地预测恒保留上一次采纳的服务端值（初始 0），
   * {@link BossRaceSimulation.adoptAuthoritativeSnapshot} 才覆盖。
   *
   * 老服务端一个都不发 → 解码结果为 0（见 `decodeBossRaceSnapshot`），与
   * 「本局确实 0 分」不可区分，但两者在 HUD 上显示同一个 `0`，没有歧义风险。
   */
  score?: number;
  hitCount?: number;
  spellGet?: number;
  spellTotal?: number;
}

/** §2.8 Boss 移动状态机（`static|move_to|move_by|sine|angle_speed`）。 */
export interface BossRaceMovementState {
  type: string;
  phaseT: number;
}

/**
 * §2.8 特殊机制（铁拳 / 黑色帷幕）的表现数据。
 *
 * 全部字段都是服务端下发的**玩法指示**数据；客户端只画指示，不做判定。
 */
export interface BossRaceEffect {
  type: string;
  state: string;
  tRemaining: number;
  /** 铁拳：telegraph 线段起点 / 方向 / 长度（milli）。 */
  x0Milli?: number;
  y0Milli?: number;
  dxMilli?: number;
  dyMilli?: number;
  lengthMilli?: number;
  /** 黑色帷幕：扫屏边缘 y（milli）。 */
  edgeYMilli?: number;
}

/** §2.8 本地玩家视角的 Boss 状态。 */
export interface BossRaceBossState {
  xMilli: number;
  yMilli: number;
  hp: number;
  maxHp: number;
  phase: number;
  movement?: BossRaceMovementState;
  effects: BossRaceEffect[];
}

/** §2.8 链状态（客户端可校验重放）。 */
export interface BossRaceChainState {
  chainId: string;
  patternIndex: number;
  nodeId: number;
  generation: number;
  rngCursor: number;
}

/** §2.8 手牌槽位。 */
export interface BossRaceHandCard {
  cardId: string;
  slot: number;
  selected: boolean;
}

/** §2.8 判定/事件回显。 */
export interface BossRaceEventView {
  tick: number;
  type: string;
  playerId: string;
  /** 事件其余字段（伤害、擦弹数、捕获 bonus……）原样透传。 */
  data: Record<string, unknown>;
}

export interface BossRaceSnapshot {
  tick: number;
  state: BossRaceState;
  winnerPlayerId: string;
  winnerTick: number;
  players: BossRacePlayerSnapshot[];
  bullets: BossRaceBullet[];
  stateHash: string;
  /** §2.8：本地玩家视角的 Boss 状态（老服务端不下发 → `undefined`）。 */
  boss?: BossRaceBossState;
  /** §2.8：活跃链状态。 */
  chains?: BossRaceChainState[];
  /** §2.8：手牌 / 牌库 / 抽卡冷却。 */
  hand?: BossRaceHandCard[];
  deckRemaining?: number;
  drawCooldownTicks?: number;
  /** §2.8：本快照携带的事件（与 `event_cursor` 配合）。 */
  events?: BossRaceEventView[];
  eventCursor?: number;
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
   * Whether the simulation runs the real-danmaku timeline in this build is the
   * reverse-engineered production one. Defaults to {@link TNA_TIMELINE_IS_PRODUCTION} — now `true`,
   * because the library here **is** the server's. Only tests that want to
   * exercise the "provisional timeline" branch override it.
   *
   * See {@link BossRaceSimulation.hashComparable}.
   */
  realDanmakuIsProduction?: boolean;
  /**
   * Whether the simulation runs the **card pipeline** for the `card_slot`
   * input (validate → charge → effect), mirroring the battle server's
   * `card_hand.hpp` rules.
   *
   * ★ Default `false`, and that default is a **server-parity** decision, not an
   * omission: the C++ boss-race simulation never looks at `card_slot`
   * (`boss_race.cpp:339-423` handles movement / shoot / bomb only — there is no
   * `card_slot` read anywhere in that file), so a client that casts cards
   * locally would predict a boss HP and a bullet set the server never
   * produced. Turn this on **together with** the server-side implementation
   * (the same five rules live in `BattleSimulation::ExecuteCastCard`,
   * `simulation.cpp:2395-2447`).
   *
   * The rules themselves are implemented and unit-tested either way — see
   * `core/sim/card_hand.ts` and `core/sim/card_effects.ts`.
   */
  cardMechanics?: boolean;
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
    // The schedule period is NOT the first pattern's period_ticks.
    //
    // It used to be `BOSS_RACE_TNA_PATTERNS[0].period_ticks`, which was
    // indistinguishable from the constant only because every pattern happened to
    // use 45. The two are different things: `patternPeriodTicks` is how often the
    // scheduler fires and picks the next pattern (server:
    // `config_.pattern_period_ticks`, defaulted to `kBossRacePatternPeriodTicks`
    // and never taken from a pattern), while a pattern's own `period_ticks`
    // decides its internal phase. Coupling them meant giving a pattern a
    // different internal period silently rescheduled every pattern and reindexed
    // the whole library. They stay decoupled, matching the server.
    patternPeriodTicks: BOSS_RACE_PATTERN_PERIOD_TICKS,
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
 *
 * ★ 票据的 ruleset 字符串**原样带进配置**（只借 base 的数值字段）：机制开关
 * （`tna-1.40-danmaku` 的受击判定，见 {@link usesDanmakuMechanics}）在客户端
 * 构造期按这个字符串判定，与服务端 `BossRaceSimulation` 构造函数同句
 * （`boss_race.cpp:161-162`）。DEM 重放器 `bossRaceConfigFromDemHeader` 同样
 * 直通 header 的 `ruleset_version`。
 */
export function bossRaceConfigForRuleset(
  matchId: string,
  matchSeed: BossRaceSeed | number,
  rulesetVersion: string,
): BossRaceConfig {
  const base = usesRealDanmaku(rulesetVersion)
    ? defaultTnaBossRaceConfig(matchId, matchSeed)
    : defaultBossRaceConfig(matchId, matchSeed);
  return { ...base, rulesetVersion };
}

interface PlayerState {
  playerId: string;
  xMilli: number;
  yMilli: number;
  /** 本 tick 位移速度（milli/tick）—— C++ `PlayerState::vx/vy_milli`（E3）。 */
  vxMilli: number;
  vyMilli: number;
  lastSeq: number;
  bossCurrentHp: number;
  damageDealt: number;
  connected: boolean;
  lastInput: BossRaceInput;
  /** The in-match hand — C++ `PlayerState::hand` (`card_hand.hpp:74-80`). */
  hand: HandState;
  /** The tick the player is immune until (`invulnerable` cards). */
  invulnerableUntilTick: number;
  /**
   * 受击判定状态（§2.4 第 2 条，只在 `RULESET_DANMAKU_MECHANICS` 下被写）——
   * C++ `PlayerState`（`boss_race.hpp:341-346`）。默认 ruleset 保持初始值。
   */
  lives: number;
  bombs: number;
  graze: number;
  /**
   * P7 计分读数（**服务端权威，本地不重算**）。
   *
   * 客户端没有任何加分逻辑：这些值只在
   * {@link BossRaceSimulation.adoptAuthoritativeSnapshot} 里被服务端快照覆盖，
   * 本地 `tick()` 一个字节都不写。理由与 `vx/vy` 同源——本地算出来的分与
   * 服务端一旦不一致，玩家看到的就是一个会回跳的数字；而计分表（自机乘区、
   * 符卡获取条件）本来就只有服务端有。
   *
   * `score` 及其派生**不进** {@link BossRaceSimulation.canonicalStateHash}。
   */
  score: number;
  hitCount: number;
  spellGet: number;
  spellTotal: number;
  /** `false` = lives 归零（停射/停判）；默认 ruleset 恒 `true`。 */
  alive: boolean;
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
  /**
   * 链式分裂代数：0 = pattern 波次直生（宿主），子子弹 = 宿主 + 1，上限
   * `CHAIN_SPLIT_MAX_GENERATION`。仅服务端/本地重推内部使用，不进快照/wire。
   */
  generation: number;
  motion: BulletMotion;
  /**
   * 擦弹去重：同一颗弹对同一玩家只计一次 —— C++ `LiveBullet::grazed`
   * （`boss_race.hpp:366-367`）。仅本地状态，不进快照/hash。
   */
  grazed: boolean;
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

/**
 * `ParseDecimalInt64Text` — the shape the signed ticket's `server_seed` must
 * have (C++ `ticket.hpp:82-84`: Go's `strconv.FormatInt` output — an optional
 * `-` followed by digits, no padding, no whitespace).
 *
 * The C++ side parses the text into an `int64` and rejects anything that does
 * not fit; the client only needs the shape, because it keeps the text as-is
 * for the deterministic stream.
 */
function isDecimalInt64Text(text: string): boolean {
  return /^-?\d+$/.test(text);
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
  /**
   * 测试/调试注入：绕过 pattern 库直接放入一颗带完整运动学的子弹。
   *
   * 默认 10 个 pattern 均不使用 `bulletFunc31`，链式分裂路径无法经产品发射
   * 自然触发，故开此口仅供测试（生产路径与 .dem 重放都不调用）。
   * 对应服务端 `BossRaceSimulation::InjectLiveBulletForTest`。
   * 受每玩家总量上限与玩家存在性约束；返回是否注入成功。
   */
  injectLiveBulletForTest(ownerPlayerId: string, motion: BulletMotion, generation = 0): boolean {
    const owner = this.players.get(ownerPlayerId);
    if (owner === undefined) {
      return false;
    }
    if (this.emittedBulletsFor(ownerPlayerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
      return false;
    }
    this.liveBullets.push({
      bulletId: `b${this.nextBulletId}`,
      ownerPlayerId,
      patternId: 'injected',
      patternIndex: 0,
      spawnIndex: 0,
      generation,
      motion,
      grazed: false,
    });
    this.nextBulletId += 1;
    return true;
  }

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
  /** Whether the card pipeline runs — see {@link BossRaceConfig.cardMechanics}. */
  private readonly cardMechanics: boolean;
  /**
   * Whether the danmaku judgment mechanics run — mirrors the C++
   * `mechanics_.enabled` flag (`boss_race.cpp:161-162`), i.e. the ruleset is
   * {@link RULESET_DANMAKU_MECHANICS}. See {@link usesDanmakuMechanics}.
   */
  private readonly danmakuMechanics: boolean;
  /**
   * The lobby seed the `bullet_purge` selection is scored with — the signed
   * ticket's `server_seed` as decimal text (C++ `card_purge_seed_`,
   * `simulation.cpp:2494-2495`: the **ticket** seed, never the derived match
   * seed).
   */
  private cardPurgeSeedDecimal = '';
  /** Whether the ticket seed was already set (C++ `card_purge_seed_set_`). */
  private cardPurgeSeedSet = false;
  /** The events produced by the current tick (§2.8 `events[]`). */
  private tickEvents: BossRaceEventView[] = [];

  constructor(config: BossRaceConfig) {
    this.bossEntry = findBossCatalogEntry(config.bossId ?? '');
    this.cardMechanics = config.cardMechanics ?? false;
    this.danmakuMechanics = usesDanmakuMechanics(config.rulesetVersion);
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

  /**
   * T10: adopt the lobby's match tick after a reconnect. Forward only — a
   * stale tick must never rewind a prediction — and a non-positive tick is
   * refused. Reviving the local player is the caller's job.
   */
  resyncTick(tick: number): boolean {
    if (!Number.isFinite(tick) || tick <= 0) {
      return false;
    }
    if (tick > this.currentTick) {
      this.currentTick = tick;
    }
    return true;
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
   * True when this simulation runs the real-danmaku path.
   *
   * Mirrors `BossRaceSimulation::SpawnBulletsForTick` exactly: the legacy
   * synthetic scheduler runs only for {@link MVP_SYNTHETIC_RULESET_VERSION}.
   */
  usesRealDanmaku(): boolean {
    return usesRealDanmaku(this.config.rulesetVersion);
  }

  /**
   * True when this simulation runs the danmaku judgment mechanics
   * (hit / graze / invulnerable frames / lives / bombs) — mirrors the C++
   * `mechanics_.enabled` gate (`boss_race.cpp:161-162`, `:1028`).
   */
  usesDanmakuMechanics(): boolean {
    return this.danmakuMechanics;
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
      vxMilli: 0,
      vyMilli: 0,
      lastSeq: 0,
      bossCurrentHp: this.config.bossMaxHp,
      damageDealt: 0,
      connected: true,
      lastInput: emptyInput(playerId),
      hand: createHandState(),
      invulnerableUntilTick: 0,
      lives: DANMAKU_DEFAULT_LIVES,
      bombs: DANMAKU_DEFAULT_BOMBS,
      graze: 0,
      // P7：计分权威在服务端，本地预测从 0 起步、只在采纳快照时被覆盖。
      score: 0,
      hitCount: 0,
      spellGet: 0,
      spellTotal: 0,
      alive: true,
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
   * `SeedPlayerHand` — mirrors C++ `BattleSimulation::SeedPlayerHand`
   * (`simulation.cpp:2245-2280`).
   *
   * The signed ticket carries the opening hand and the deck; the hand is the
   * deck's prefix, so the draw cursor continues at `handCardIds.length` and the
   * opening costs exactly that many cards.
   *
   * The lobby seed is the **ticket's** `server_seed` (signed decimal text) —
   * the same number the server scores `bullet_purge` with
   * (`simulation.cpp:2494-2495`). A second ticket with a *different* seed is a
   * lobby invariant violation and is refused, exactly like the C++ side
   * (`simulation.cpp:2263-2266`).
   *
   * @returns whether the hand was seeded
   */
  seedPlayerHand(
    playerId: string,
    handCardIds: readonly string[],
    initialEnergy: number,
    serverSeedDecimal: string,
    deckCardIds: readonly string[] = [],
  ): boolean {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return false;
    }
    const seed = serverSeedDecimal.trim();
    if (seed !== '') {
      if (!isDecimalInt64Text(seed)) {
        return false;
      }
      if (this.cardPurgeSeedSet && seed !== this.cardPurgeSeedDecimal) {
        return false;
      }
      this.cardPurgeSeedDecimal = seed;
      this.cardPurgeSeedSet = true;
    }
    player.hand.cardIds = handCardIds.slice();
    player.hand.energy = initialEnergy;
    player.hand.cooldowns.clear();
    player.hand.deck = deckCardIds.slice();
    player.hand.drawCursor = player.hand.deck.length === 0 ? 0 : handCardIds.length;
    player.invulnerableUntilTick = 0;
    return true;
  }

  /**
   * The player's current hand — the slots the client can cast from.
   *
   * Mirrors the snapshot's `hand` wire field (§2.8): one entry per slot, in
   * slot order.
   */
  handCardsFor(playerId: string): BossRaceHandCard[] {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return [];
    }
    return player.hand.cardIds.map((cardId, slot) => ({
      cardId: trimCardId(cardId),
      slot,
      selected: false,
    }));
  }

  /** The player's card energy (the hand bar's readout). */
  playerEnergy(playerId: string): number {
    return this.players.get(playerId)?.hand.energy ?? 0;
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
      // §2.8 增补字段按「服务端下发了才采纳」处理（老服务端缺省 → 保留本地值）。
      if (serverPlayer.vxMilli !== undefined) {
        player.vxMilli = serverPlayer.vxMilli;
      }
      if (serverPlayer.vyMilli !== undefined) {
        player.vyMilli = serverPlayer.vyMilli;
      }
      if (serverPlayer.lives !== undefined) {
        player.lives = serverPlayer.lives;
        // lives 归零 = 死亡（服务端 `player_dead` 后 alive=false）。
        player.alive = serverPlayer.lives > 0;
      }
      if (serverPlayer.bombs !== undefined) {
        player.bombs = serverPlayer.bombs;
      }
      if (serverPlayer.graze !== undefined) {
        player.graze = serverPlayer.graze;
      }
      if (serverPlayer.invulnerableUntilTick !== undefined) {
        player.invulnerableUntilTick = serverPlayer.invulnerableUntilTick;
      }
      // P7 计分：**只在这里**被服务端值覆盖，本地 tick 不写（客户端不重算分）。
      if (serverPlayer.score !== undefined) {
        player.score = serverPlayer.score;
      }
      if (serverPlayer.hitCount !== undefined) {
        player.hitCount = serverPlayer.hitCount;
      }
      if (serverPlayer.spellGet !== undefined) {
        player.spellGet = serverPlayer.spellGet;
      }
      if (serverPlayer.spellTotal !== undefined) {
        player.spellTotal = serverPlayer.spellTotal;
      }
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
      // "Real input" = this tick's own packet. The C++ shared simulation only
      // replays a cast for real inputs, never for the held fallback
      // (`simulation.cpp:1171-1177`), so a stale slot is never re-cast.
      const realInput = pending !== undefined;
      if (pending !== undefined) {
        input = pending;
        player.lastInput = input;
      }
      // 手牌能量逐 tick 回复（C++ `simulation.cpp:1162-1169`）：回复先于本 tick
      // 的出牌扣费（与大厅 applyInputLocked 的 accrue → 处理输入顺序一致）。
      if (this.cardMechanics) {
        accrueCardEnergy(player.hand);
      }
      // Movement: 8-direction bitmask (0=up,1=right,2=down,3=left), 3000 milli/tick.
      // vx/vy 每 tick 按输入方向**重算**（含归零）—— C++ `ApplyPlayerTick`
      // （`boss_race.cpp:356-365`），快照据此产出 `vx_milli/vy_milli`（E3）。
      let vx = 0;
      let vy = 0;
      if ((input.directionBits & DIR_UP) !== 0) {
        vy -= MOVE_MILLI_PER_TICK;
      }
      if ((input.directionBits & DIR_RIGHT) !== 0) {
        vx += MOVE_MILLI_PER_TICK;
      }
      if ((input.directionBits & DIR_DOWN) !== 0) {
        vy += MOVE_MILLI_PER_TICK;
      }
      if ((input.directionBits & DIR_LEFT) !== 0) {
        vx -= MOVE_MILLI_PER_TICK;
      }
      player.vxMilli = vx;
      player.vyMilli = vy;
      player.xMilli += vx;
      player.yMilli += vy;
      player.xMilli = clampMilli(player.xMilli, -ARENA_HALF_WIDTH_MILLI, ARENA_HALF_WIDTH_MILLI);
      player.yMilli = clampMilli(player.yMilli, -ARENA_HALF_HEIGHT_MILLI, ARENA_HALF_HEIGHT_MILLI);

      // 炸弹（只在 RULESET_DANMAKU_MECHANICS 下消耗残弹并给无敌帧；默认
      // ruleset 保持现状：只按自机表加伤害，不消耗炸弹、不加无敌帧）——
      // C++ `boss_race.cpp:371-386`。炸弹伤害由服务端权威结算（客户端不重算）。
      if (this.danmakuMechanics && input.bomb && player.bombs > 0 && player.alive) {
        player.bombs -= 1;
        player.invulnerableUntilTick = tick + DANMAKU_INVULNERABLE_TICKS;
        this.tickEvents.push({
          tick,
          type: BOMB_USED_EVENT,
          playerId: player.playerId,
          data: {},
        });
      }

      // 伤害：默认每 tick BOSS_RACE_DAMAGE_PER_SHOT_TICK（与现状一致）。
      // 配置自机 loadout 后改为真实自机表（shot 主弹伤害 / bomb 主弹伤害），
      // 与服务端 `ApplyPlayerTick` 逐位一致。
      // ★ mechanics 下服务端改为「自机弹实体 vs Boss 命中盒」真实判定
      // （`boss_race.cpp:393-418`），这里不再叠加合成伤害：权威在服务端，
      // 客户端经快照/boss_damage 事件同步（§2.4 第 1 条）。
      if (!this.danmakuMechanics && player.bossCurrentHp > 0 && player.alive) {
        const tickDamage = bossRaceTickDamage(
          input.shoot,
          input.bomb,
          this.shotDamageByPlayer.get(player.playerId),
          this.bombDamageByPlayer.get(player.playerId),
        );
        if (tickDamage > 0) {
          const damage = Math.min(tickDamage, player.bossCurrentHp);
          player.bossCurrentHp -= damage;
          player.damageDealt += damage;
        }
      }

      // 出牌（C++ `simulation.cpp:1171-1177`）：只消费**真实**客户端输入——
      // held fallback 不重放 card_slot；-1 哨兵直接跳过（无事件、无状态变更）。
      if (this.cardMechanics && realInput && input.cardSlot >= 0) {
        this.executeCastCard(player, input.cardSlot, tick);
      }
    }
    if (bucket !== undefined) {
      this.pendingInputsByTick.delete(tick);
    }
  }

  /**
   * `ExecuteCastCard` — mirrors C++ `BattleSimulation::ExecuteCastCard`
   * (`simulation.cpp:2395-2447`).
   *
   * The order is the server's:
   *
   *  1. `ApplyCast` validates **and** books the ledger (pay the energy, write
   *     the cooldown, drop the slot, draw a replacement);
   *  2. the `-1` sentinel returns immediately — no card, no event, no state
   *     change;
   *  3. a rejection produces a `card_rejected` row and nothing else;
   *  4. an accepted cast damages the boss by the card's `damage` (the generic
   *     activation path — C++ `simulation.cpp:2421-2435`; in the race every
   *     player owns a copy of the boss, so the card hits the caster's own copy)
   *     and emits a `card_accepted` row;
   *  5. the effect layer runs (`RunCardEffect`, C++ `simulation.cpp:2467-2534`).
   */
  private executeCastCard(player: PlayerState, slot: number, tick: number): void {
    const cast = applyCast(player.hand, slot, tick);
    if (cast.playsNoCard) {
      return;
    }
    if (!cast.accepted || cast.definition === null) {
      this.tickEvents.push({
        tick,
        type: 'card_rejected',
        playerId: player.playerId,
        data: { slot, reason: cast.reason },
      });
      return;
    }
    const definition = cast.definition;
    if (definition.damage > 0 && player.bossCurrentHp > 0) {
      const damage = Math.min(definition.damage, player.bossCurrentHp);
      player.bossCurrentHp -= damage;
      player.damageDealt += damage;
    }
    this.tickEvents.push({
      tick,
      type: 'card_accepted',
      playerId: player.playerId,
      data: { card_id: definition.cardId, slot, value: definition.damage },
    });
    this.runCardEffect(player, definition, tick);
  }

  /**
   * `RunCardEffect` — mirrors C++ `BattleSimulation::RunCardEffect`
   * (`simulation.cpp:2467-2534`).
   *
   * Only the four bullet-level kinds produce an effect; `self` / `pattern` /
   * `economy` change the ledger and stop there (C++ `simulation.cpp:2511-2516`
   * returns before the event row, so those cards emit no
   * `card_effect_applied`).
   */
  private runCardEffect(player: PlayerState, definition: CardDefinition, tick: number): void {
    const activation = buildCardActivation(definition, tick);
    let effect: CardEffectResult;
    switch (activation.effectKind) {
      case 'opponent_pattern': {
        const players: CardPlayerSnapshot[] = [];
        for (const playerId of this.sortedPlayerIds()) {
          const other = this.players.get(playerId);
          if (other === undefined) {
            continue;
          }
          players.push({ playerId: other.playerId, xMilli: other.xMilli, yMilli: other.yMilli });
        }
        effect = applyOpponentPattern(
          players,
          player.playerId,
          activation,
          tick,
          this.config.matchId,
          this.nextBulletId,
          this.liveBullets.length,
          BOSS_ORIGIN_X_MILLI,
          BOSS_ORIGIN_Y_MILLI,
        );
        break;
      }
      case 'bullet_purge': {
        const caster: CardPlayerSnapshot = {
          playerId: player.playerId,
          xMilli: player.xMilli,
          yMilli: player.yMilli,
        };
        effect = applyBulletPurge(
          this.cardBulletSnapshots(),
          caster,
          activation,
          this.cardPurgeSeedDecimal,
          tick,
        );
        break;
      }
      case 'invulnerable': {
        effect = applyInvulnerable(activation);
        player.invulnerableUntilTick = effect.invulnerableUntil;
        break;
      }
      case 'finisher': {
        effect = applyFinisher(this.cardBulletSnapshots(), tick);
        break;
      }
      default:
        return;
    }
    this.applyCardBulletDeltas(effect.bulletDeltas, player.playerId);
    this.tickEvents.push({
      tick,
      type: 'card_effect_applied',
      playerId: player.playerId,
      data: {
        card_id: activation.cardId,
        value: effect.eventValue,
        target_user_id: effect.targetUserId,
      },
    });
  }

  /** The live bullets as effect-layer snapshots (C++ `BuildBulletSnapshots`). */
  private cardBulletSnapshots(): CardBulletSnapshot[] {
    return this.liveBullets.map((live) => {
      const m = live.motion;
      return {
        bulletId: live.bulletId,
        patternId: live.patternId,
        kind: 'nway',
        spawnTick: 0,
        xMilli: toMilli(m.x - SCREEN_CENTER_X_PX),
        yMilli: toMilli(m.y - SCREEN_CENTER_Y_PX),
        vxMilli: toMilli(m.vx),
        vyMilli: toMilli(m.vy),
        radiusMilli: llround(m.hit_dis * MILLI_PER_PIXEL),
        damage: 0,
        color: '',
      };
    });
  }

  /**
   * `ApplyBulletDeltas` — mirrors C++ `BattleSimulation::ApplyBulletDeltas`
   * (`simulation.cpp:2536-2564`): spawns and despawns bullets in the field.
   *
   * The C++ side re-mints the spawn ids with the simulation's own `b<N>`
   * scheme and discards the effect layer's Go-style ids; this client does the
   * same, so the ids stay in one sequence with the pattern bullets.
   */
  private applyCardBulletDeltas(deltas: readonly CardBulletDelta[], ownerPlayerId: string): void {
    for (const delta of deltas) {
      if (delta.op === 'spawn') {
        if (this.emittedBulletsFor(ownerPlayerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
          continue;
        }
        const motion = createBulletMotion();
        motion.x = SCREEN_CENTER_X_PX + toPixels(delta.xMilli);
        motion.y = SCREEN_CENTER_Y_PX + toPixels(delta.yMilli);
        motion.angle = Math.atan2(delta.vyMilli, delta.vxMilli) * (180 / Math.PI);
        motion.angle_init = -1;
        motion.speed = Math.hypot(delta.vxMilli, delta.vyMilli) / MILLI_PER_PIXEL;
        motion.spd_init2 = motion.speed;
        motion.bullet_func_no = 0;
        motion.hit_dis = delta.radiusMilli / MILLI_PER_PIXEL;
        integrateVelocity(motion);
        this.liveBullets.push({
          bulletId: `b${this.nextBulletId}`,
          ownerPlayerId,
          patternId: delta.patternId,
          patternIndex: 0,
          spawnIndex: this.nextBulletId,
          generation: 0,
          motion,
          grazed: false,
        });
        this.nextBulletId += 1;
      } else if (delta.op === 'despawn') {
        const index = this.liveBullets.findIndex((live) => live.bulletId === delta.bulletId);
        if (index >= 0) {
          this.liveBullets.splice(index, 1);
        }
      }
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
          generation: 0,
          motion,
          grazed: false,
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
          generation: 0,
          motion,
          grazed: false,
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

    // 第一趟：运动学更新 + 收集 H 族（bulletFunc31）分裂请求。
    // 不能边遍历边 push 子子弹：数组增长会失效遍历语义，且子子弹必须晚于全部
    // 宿主更新后入场（与主发射一致：子子弹从下一帧才开始运动）。
    // 判据只认 func31 + p2 !== 0：bulletFunc42/55 同样写 p2，但不是分裂族。
    const requests: {
      index: number;
      ownerPlayerId: string;
      patternIndex: number;
      spawnIndex: number;
      generation: number;
    }[] = [];
    const hostBudget = new Map<string, number>();

    for (let i = 0; i < this.liveBullets.length; i += 1) {
      const live = this.liveBullets[i];
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

      if (chainSplitRequested(live.motion)) {
        // p2 是单帧事件标志（func31 仅在 t === p1 置位一次）：本帧一律消费，
        // 服务或丢弃都在本帧决定，绝不推迟——否则残留标记会撞上「每 tick 预算
        // 重置」把一次事件摊成多次。叶子代不消费：残留 p2 无行为影响。
        live.motion.p2 = 0;
        if (live.generation < CHAIN_SPLIT_MAX_GENERATION) {
          const used = hostBudget.get(live.ownerPlayerId) ?? 0;
          if (used < CHAIN_SPLIT_HOSTS_PER_PLAYER_PER_TICK) {
            hostBudget.set(live.ownerPlayerId, used + 1);
            requests.push({
              index: i,
              ownerPlayerId: live.ownerPlayerId,
              patternIndex: live.patternIndex,
              spawnIndex: live.spawnIndex,
              generation: live.generation,
            });
          }
        }
      }
    }

    // 第二趟：按请求顺序生成子子弹。请求顺序 = 第一趟遍历顺序，因此 bulletId
    // 分配顺序与快照子弹顺序两端一致。钳制链：每玩家总量 384 决定 max_children。
    for (const request of requests) {
      const host = this.liveBullets[request.index];
      const room = BOSS_RACE_MAX_BULLETS_PER_PLAYER - this.emittedBulletsFor(request.ownerPlayerId);
      const maxChildren = Math.min(room, CHAIN_SPLIT_CHILDREN_PER_HOST);
      const children = computeChainSplitChildren(
        host.motion,
        this.config.matchSeed,
        tick,
        request.patternIndex,
        request.spawnIndex,
        maxChildren,
      );
      for (const child of children) {
        if (this.emittedBulletsFor(request.ownerPlayerId) >= BOSS_RACE_MAX_BULLETS_PER_PLAYER) {
          break;
        }
        this.liveBullets.push({
          bulletId: `b${this.nextBulletId}`,
          ownerPlayerId: request.ownerPlayerId,
          patternId: host.patternId,
          patternIndex: request.patternIndex,
          spawnIndex: child.spawnIndex,
          generation: request.generation + 1,
          motion: makeChainSplitChildMotion(host.motion, child),
          grazed: false,
        });
        this.nextBulletId += 1;
      }
    }

    // 第三趟：出界剔除（与链式分裂落地前完全相同的谓词）。
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

  /**
   * 玩家受击判定（§2.4 第 2 条）—— C++ `JudgePlayerContacts`
   * （`boss_race.cpp:1027-1084`）的镜像。只在 RULESET_DANMAKU_MECHANICS 下生效：
   *   * 命中（dist² ≤ (弹半径 + r_hit)²）→ lives-1、无敌帧 120 tick、事件
   *     player_hit（lives 归零再发 player_dead 并置 alive=false）；
   *   * 擦弹（dist² ≤ (弹半径 + r_graze)² 且未命中）→ graze+1、事件
   *     player_graze，同一颗弹对同一玩家只计一次（`LiveBullet::grazed`）；
   *   * 无敌帧内两者都不计。
   * 子弹按 `ownerPlayerId` 归属到「自己那份 Boss 副本」，故只判定该玩家自己的弹。
   */
  private judgePlayerContacts(tick: number): void {
    if (!this.danmakuMechanics) {
      return;
    }
    for (const playerId of this.sortedPlayerIds()) {
      const player = this.players.get(playerId);
      if (player === undefined || !player.connected || !player.alive) {
        continue;
      }
      const invulnerable = tick <= player.invulnerableUntilTick;
      for (const live of this.liveBullets) {
        if (live.ownerPlayerId !== player.playerId) {
          continue;
        }
        const m = live.motion;
        // 弹位置折成 centered milli（与快照/hash 同一次折叠），半径 llround 一次。
        const bulletX = toMilli(m.x - SCREEN_CENTER_X_PX);
        const bulletY = toMilli(m.y - SCREEN_CENTER_Y_PX);
        const bulletRadius = llround(m.hit_dis * MILLI_PER_PIXEL);
        // 服务端 `DistanceSquaredMilli` 是 int64；这些量级下 JS number 是精确整数。
        const dx = bulletX - player.xMilli;
        const dy = bulletY - player.yMilli;
        const distanceSquared = dx * dx + dy * dy;
        if (invulnerable) {
          continue;
        }
        const hitRadius = bulletRadius + DANMAKU_HIT_RADIUS_MILLI;
        if (distanceSquared <= hitRadius * hitRadius) {
          if (player.lives > 0) {
            player.lives -= 1;
          }
          player.invulnerableUntilTick = tick + DANMAKU_INVULNERABLE_TICKS;
          this.tickEvents.push({
            tick,
            type: PLAYER_HIT_EVENT,
            playerId: player.playerId,
            data: {},
          });
          if (player.lives === 0) {
            player.alive = false;
            this.tickEvents.push({
              tick,
              type: PLAYER_DEAD_EVENT,
              playerId: player.playerId,
              data: {},
            });
          }
          break; // 本 tick 已进入无敌帧，剩余子弹不再判定
        }
        const grazeRadius = bulletRadius + DANMAKU_GRAZE_RADIUS_MILLI;
        if (!live.grazed && distanceSquared <= grazeRadius * grazeRadius) {
          live.grazed = true;
          player.graze += 1;
          this.tickEvents.push({
            tick,
            type: PLAYER_GRAZE_EVENT,
            playerId: player.playerId,
            data: {},
          });
        }
      }
    }
  }

  /** Advance exactly one fixed tick. */
  tick(): BossRaceSnapshot {
    if (this.state === BossRaceState.Finished) {
      return this.snapshot();
    }
    const tickToApply = this.currentTick + 1;
    this.startIfReady();
    // §2.8：`events[]` 是**本 tick 增量**（非累积），每 tick 清空重来。
    this.tickEvents = [];
    if (this.state === BossRaceState.Running) {
      this.applyPlayerTick(tickToApply);
      this.spawnBulletsForTick(tickToApply);
      this.advanceBullets(tickToApply);
      // 受击判定在推进之后、判胜之前（服务端 `Tick()` 同序，
      // `boss_race.cpp:1112-1120`）。
      this.judgePlayerContacts(tickToApply);
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
        // §2.8：本 tick 速度（milli/tick），供插值外推（E3）。与服务端 wire
        // 一致恒下发（缺省 0），canonical hash 不含该字段。
        vxMilli: player.vxMilli,
        vyMilli: player.vyMilli,
        bossCurrentHp: player.bossCurrentHp,
        damageDealt: player.damageDealt,
        connected: player.connected,
        ...(this.danmakuMechanics || this.cardMechanics
          ? { invulnerableUntilTick: player.invulnerableUntilTick }
          : {}),
        // 受击判定状态只在 mechanics 下下发真实值（服务端
        // `boss_race.cpp:1188-1200` 同构：默认 ruleset 走 wire 占位）。
        ...(this.danmakuMechanics
          ? { lives: player.lives, bombs: player.bombs, graze: player.graze }
          : {}),
        // P7 计分：恒下发（默认 ruleset 也有击破/结算分）。值是上一次采纳的
        // 服务端读数，本地 tick 不改——客户端只展示，计分权威在服务端。
        score: player.score,
        hitCount: player.hitCount,
        spellGet: player.spellGet,
        spellTotal: player.spellTotal,
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
      // §2.8：事件是**本 tick 增量**。没有事件时字段保持缺省（老服务端同样
      // 不下发），这样既有快照的形状不变。
      ...(this.tickEvents.length > 0 ? { events: this.tickEvents } : {}),
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
   *
   * ★ P7：`score` / `hit_count` / `spell_get` / `spell_total` **不参与**这个
   * 哈希（与 `vx/vy` 同理）。计分是服务端的派生读数，把它喂进哈希只会让一次
   * 计分表调整触发全量预测分叉。
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
