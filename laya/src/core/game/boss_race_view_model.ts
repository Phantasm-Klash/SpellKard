/**
 * Presentation model for `BossRaceView`.
 *
 * Converts authoritative/predicted milli-unit simulation state into
 * pixel-space render items plus HUD values, so the LayaAir layer only has to
 * blit sprites and draw text. Keeping this engine-agnostic means the same
 * mapping is unit-testable and reusable by any renderer.
 *
 * Coordinate systems:
 *  - Simulation: milli-units, x ∈ [-120000, 120000], y ∈ [-90000, 90000],
 *    origin at the arena centre, Boss at (0, -60000), +y points down.
 *  - Render: pixels inside a portrait playfield, origin top-left, +y down.
 */

import type { BossRaceEffect, BossRaceSnapshot } from '../sim/boss_race';
import {
  ARENA_HALF_HEIGHT_MILLI,
  ARENA_HALF_WIDTH_MILLI,
  BOSS_ORIGIN_X_MILLI,
  BOSS_ORIGIN_Y_MILLI,
} from '../sim/boss_race';
import { bulletMotionFamily, type BulletMotionFamily } from '../sim/danmaku/bullet_motion';
import { clamp01, lerpF64, RAD_TO_DEG } from '../math/float_lib';
import { interpolateBetween, interpolatePos, normalizeFrac } from './interpolation';

export interface PlayfieldLayout {
  /** Playfield width in pixels. */
  width: number;
  /** Playfield height in pixels. */
  height: number;
}

export interface RenderPoint {
  x: number;
  y: number;
}

export interface BulletRenderItem {
  bulletId: string;
  patternId: string;
  position: RenderPoint;
  radius: number;
  /**
   * Travel direction in radians (0 = +x, +y is screen-down). Renderers use it
   * to orient directional art (arrowheads, laser capsules, trail dots); it is
   * `NaN`-free because bullets always carry a non-zero velocity.
   */
  angleRad: number;
  /** Bullets owned by the local player's Boss copy vs. the opponent's. */
  ownerIsLocal: boolean;
  /**
   * `kEnemyBullet` value when the bullet comes from the real-danmaku (TNA)
   * timeline, else `-1` (legacy synthetic pattern).
   */
  bulletKind: number;
  /** Real-danmaku motion family, or `'unknown'` for legacy/pattern bullets. */
  motionFamily: BulletMotionFamily;
  /** Travel heading in degrees (real-danmaku bullets only), else `NaN`. */
  angleDeg: number;
}

export interface PlayerRenderItem {
  playerId: string;
  position: RenderPoint;
  isLocal: boolean;
}

export interface BossRenderItem {
  playerId: string;
  position: RenderPoint;
  currentHp: number;
  maxHp: number;
  hpRatio: number;
  defeated: boolean;
  isLocal: boolean;
}

/**
 * 特殊机制（铁拳 / 黑色帷幕）的**玩法指示**几何，已换算到 playfield 像素。
 *
 * 按 `docs/ART_POLICY.md`，这类「判定即将落在哪里」的提示允许自绘骨架线；
 * 数据全部来自快照 `boss.effects[]`，客户端不做判定。
 */
export interface BossEffectRenderItem {
  type: string;
  state: string;
  tRemaining: number;
  /** 铁拳 telegraph 线段（像素）；非铁拳为 `null`。 */
  from: RenderPoint | null;
  to: RenderPoint | null;
  /** 黑色帷幕扫屏边缘 y（像素）；非帷幕为 `null`。 */
  edgeY: number | null;
}

export interface BossRaceFrame {
  tick: number;
  state: number;
  boss: BossRenderItem | null;
  opponentBoss: BossRenderItem | null;
  players: PlayerRenderItem[];
  bullets: BulletRenderItem[];
  /** §2.8/§2.7 特殊机制指示（像素几何）。 */
  bossEffects: BossEffectRenderItem[];
  winnerPlayerId: string;
  matchOver: boolean;
  /** Local Boss HP as a 0..1 ratio, for the primary HUD bar. */
  localHpRatio: number;
  /** Damage dealt to the local Boss copy, for the HUD counter. */
  localDamageDealt: number;
}

export interface BossRaceFrameOptions {
  layout: PlayfieldLayout;
  localPlayerId: string;
  bossMaxHp: number;
  /** Radius multiplier for the "focus"/slow mode hitbox highlight. */
  bulletRadiusScale?: number;
  /**
   * §2.9 插值：**上一份**权威快照。无速度实体（玩家 / Boss）按
   * `p_n + (p_{n+1} - p_n) * frac` 差分插值，`previous` 即 `p_n`。
   */
  previous?: BossRaceSnapshot | null;
  /**
   * §2.9 插值：`render_tick = last_snapshot_tick + frac`，`frac ∈ [0,1)`。
   * 缺省 0 = 直接画权威 tick 的位置（与旧行为一致）。
   */
  frac?: number;
}

/**
 * Maps simulation milli-units onto playfield pixels. The arena keeps its aspect
 * ratio, so both axes use the same scale.
 */
export class PlayfieldTransform {
  readonly scale: number;

  constructor(readonly layout: PlayfieldLayout) {
    this.scale = layout.width / (ARENA_HALF_WIDTH_MILLI * 2);
  }

  toPixels(xMilli: number, yMilli: number): RenderPoint {
    return {
      x: (xMilli + ARENA_HALF_WIDTH_MILLI) * this.scale,
      y: (yMilli + ARENA_HALF_HEIGHT_MILLI) * this.scale,
    };
  }

  /** Milli-unit radius → pixel radius. */
  radiusToPixels(radiusMilli: number): number {
    return radiusMilli * this.scale;
  }
}

export function bossOriginPixels(transform: PlayfieldTransform): RenderPoint {
  return transform.toPixels(BOSS_ORIGIN_X_MILLI, BOSS_ORIGIN_Y_MILLI);
}

/**
 * Builds one render frame from a snapshot. `localPlayerId` decides which Boss
 * copy and player are drawn as "mine" so the view can highlight them.
 */
export function buildBossRaceFrame(
  snapshot: BossRaceSnapshot,
  options: BossRaceFrameOptions,
): BossRaceFrame {
  const transform = new PlayfieldTransform(options.layout);
  const bulletRadiusScale = options.bulletRadiusScale ?? 1;
  const maxHp = options.bossMaxHp > 0 ? options.bossMaxHp : 1;
  const frac = normalizeFrac(options.frac ?? 0);
  const previous = options.previous ?? null;
  const prevPlayer = (playerId: string) =>
    previous?.players.find((candidate) => candidate.playerId === playerId) ?? null;

  const players: PlayerRenderItem[] = [];
  let boss: BossRenderItem | null = null;
  let opponentBoss: BossRenderItem | null = null;
  let localHpRatio = 0;
  let localDamageDealt = 0;

  // §2.8：`boss` 是本地玩家视角的 Boss 状态。老服务端不下发时退回固定原点。
  const bossWire = snapshot.boss ?? null;
  const bossMilli = bossWire === null
    ? { x: BOSS_ORIGIN_X_MILLI, y: BOSS_ORIGIN_Y_MILLI }
    : interpolateBetween(
        { x: (previous?.boss ?? bossWire).xMilli, y: (previous?.boss ?? bossWire).yMilli },
        { x: bossWire.xMilli, y: bossWire.yMilli },
        frac,
      );

  for (const player of snapshot.players) {
    const isLocal = player.playerId === options.localPlayerId;
    // §2.9 无速度实体差分插值（`p_n` = 上一份快照，`p_{n+1}` = 本份）。
    const before = prevPlayer(player.playerId);
    const position = before === null
      ? { x: player.xMilli, y: player.yMilli }
      : interpolateBetween(
          { x: before.xMilli, y: before.yMilli },
          { x: player.xMilli, y: player.yMilli },
          frac,
        );
    players.push({
      playerId: player.playerId,
      position: transform.toPixels(position.x, position.y),
      isLocal,
    });
    const bossItem: BossRenderItem = {
      playerId: player.playerId,
      // 本地 Boss 跟快照位置；对手 Boss 仍是各自副本的原点（服务端只下发本地视角）。
      position: isLocal ? transform.toPixels(bossMilli.x, bossMilli.y) : bossOriginPixels(transform),
      currentHp: player.bossCurrentHp,
      maxHp,
      hpRatio: Math.max(0, Math.min(1, player.bossCurrentHp / maxHp)),
      defeated: player.bossCurrentHp <= 0,
      isLocal,
    };
    if (isLocal) {
      boss = bossItem;
      localHpRatio = bossItem.hpRatio;
      localDamageDealt = player.damageDealt;
    } else if (opponentBoss === null) {
      opponentBoss = bossItem;
    }
  }

  // §2.7/§2.8：`hidden` 子弹（黑色帷幕 hold 期）判定照算但**不渲染**。
  const visibleBullets = snapshot.bullets.filter((bullet) => bullet.hidden !== true);
  const bullets: BulletRenderItem[] = visibleBullets.map((bullet) => {
    // §2.9 有速度实体：`p_n + v_n * frac`（与服务端逐 tick 积分同式）。
    const position = interpolatePos(
      { x: bullet.xMilli, y: bullet.yMilli },
      { x: bullet.vxMilli, y: bullet.vyMilli },
      frac,
    );
    return {
      bulletId: bullet.bulletId,
      patternId: bullet.patternId,
      position: transform.toPixels(position.x, position.y),
      radius: Math.max(1, transform.radiusToPixels(bullet.radiusMilli) * bulletRadiusScale),
      // Velocity is integer milli-units; atan2 stays finite as long as the bullet
      // is actually moving, which the simulation guarantees.
      angleRad: Math.atan2(bullet.vyMilli, bullet.vxMilli),
      ownerIsLocal: bullet.ownerPlayerId === options.localPlayerId,
      bulletKind: bullet.bulletKind ?? -1,
      motionFamily: bullet.motionFunc !== undefined ? bulletMotionFamily(bullet.motionFunc) : 'unknown',
      // Same conversion as the simulation layer, from the one float library.
      angleDeg: bullet.angleDeg ?? Math.atan2(bullet.vyMilli, bullet.vxMilli) * RAD_TO_DEG,
    };
  });

  return {
    tick: snapshot.tick,
    state: snapshot.state as number,
    boss,
    opponentBoss,
    players,
    bullets,
    bossEffects: buildBossEffects(bossWire?.effects ?? [], transform),
    winnerPlayerId: snapshot.winnerPlayerId,
    matchOver: snapshot.winnerPlayerId !== '',
    localHpRatio,
    localDamageDealt,
  };
}

/**
 * 把快照 `boss.effects[]` 的 milli 几何换成 playfield 像素。
 *
 * 铁拳：`(x0,y0)` 起点 + `(dx,dy)` 方向（任意尺度，按 `length` 归一化长度）。
 * 黑色帷幕：`edge_y` 一条水平扫屏线。未知 `type` 原样透传但不给几何，渲染层
 * 自己决定忽略（向前兼容新机制）。
 */
export function buildBossEffects(
  effects: readonly BossRaceEffect[],
  transform: PlayfieldTransform,
): BossEffectRenderItem[] {
  return effects.map((effect): BossEffectRenderItem => {
    if (effect.type === 'iron_fist') {
      const x0 = effect.x0Milli ?? 0;
      const y0 = effect.y0Milli ?? 0;
      const dx = effect.dxMilli ?? 0;
      const dy = effect.dyMilli ?? 0;
      const length = effect.lengthMilli ?? 0;
      const magnitude = Math.hypot(dx, dy);
      const scale = magnitude > 0 ? length / magnitude : 0;
      return {
        type: effect.type,
        state: effect.state,
        tRemaining: effect.tRemaining,
        from: transform.toPixels(x0, y0),
        to: transform.toPixels(x0 + dx * scale, y0 + dy * scale),
        edgeY: null,
      };
    }
    if (effect.type === 'black_curtain') {
      return {
        type: effect.type,
        state: effect.state,
        tRemaining: effect.tRemaining,
        from: null,
        to: null,
        edgeY: transform.toPixels(0, effect.edgeYMilli ?? 0).y,
      };
    }
    return {
      type: effect.type,
      state: effect.state,
      tRemaining: effect.tRemaining,
      from: null,
      to: null,
      edgeY: null,
    };
  });
}

/**
 * Applies snapshot interpolation for smooth rendering between server ticks.
 * `alpha` is the 0..1 fraction between `previous` and `current`.
 *
 * ★ 插值走 `core/math/float_lib`：补帧算术必须与模拟层同一套浮点语义，否则
 * 「补出来的中间帧」会相对服务端权威位置系统性偏移（就是「客户端插帧和渲染和
 * 服务端面板不匹配」）。这里只做端点之间的线性插值，不做任何取整。
 */
export function interpolateFrames(
  previous: BossRaceFrame,
  current: BossRaceFrame,
  alpha: number,
): BossRaceFrame {
  const t = clamp01(alpha);
  if (t >= 1 || previous.players.length !== current.players.length) {
    return current;
  }
  const lerpPoint = (a: RenderPoint, b: RenderPoint): RenderPoint => ({
    x: lerpF64(a.x, b.x, t),
    y: lerpF64(a.y, b.y, t),
  });
  const players: PlayerRenderItem[] = current.players.map((player, index) => {
    const before = previous.players[index];
    if (before === undefined || before.playerId !== player.playerId) {
      return player;
    }
    return { ...player, position: lerpPoint(before.position, player.position) };
  });
  return {
    ...current,
    players,
    bullets: current.bullets.map((bullet) => {
      const before = previous.bullets.find((candidate) => candidate.bulletId === bullet.bulletId);
      if (before === undefined) {
        return bullet;
      }
      return { ...bullet, position: lerpPoint(before.position, bullet.position) };
    }),
  };
}
