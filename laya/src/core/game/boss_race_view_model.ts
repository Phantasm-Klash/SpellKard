/**
 * Presentation model for `BossRaceView`.
 *
 * Converts authoritative/predicted milli-unit simulation state into
 * pixel-space render items plus HUD values, so the LayaAir layer only has to
 * blit sprites and draw text. Keeping this engine-agnostic means the same
 * mapping is unit-testable and reusable by any renderer.
 *
 * Coordinate systems:
 *  - Simulation: milli-units, origin at the arena centre, Boss at (0, -60000),
 *    +y points down. Players are clamped to ±120000/±90000; bullets live in the
 *    wider 640×960 screen box (±320000/±480000).
 *  - Render: pixels inside a portrait playfield, origin top-left, +y down.
 *    {@link PlayfieldTransform} maps the **screen box** uniformly into the
 *    playfield (E1: not the player-clamp arena — see the class comment).
 */

import type { BossRaceEffect, BossRaceSnapshot } from '../sim/boss_race';
import {
  BOSS_ORIGIN_X_MILLI,
  BOSS_ORIGIN_Y_MILLI,
  DANMAKU_GRAZE_RADIUS_MILLI,
  DANMAKU_HIT_RADIUS_MILLI,
  SNAPSHOT_DEFAULT_BOMBS,
  SNAPSHOT_DEFAULT_LIVES,
  SCREEN_HALF_HEIGHT_MILLI,
  SCREEN_HALF_WIDTH_MILLI,
} from '../sim/boss_race';
import { bulletMotionFamily, type BulletMotionFamily } from '../sim/danmaku/bullet_motion';
import { clamp01, lerpF64, RAD_TO_DEG } from '../math/float_lib';
import { extrapolatePos, interpolatePos, normalizeFrac } from './interpolation';

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
  /**
   * 判定点半径（像素）—— 服务端 `kDanmakuHitRadiusMilli`（3000 milli ≈ 3px）
   * 经 {@link PlayfieldTransform} 缩放：参考 640×960 布局下正好 3px。
   */
  hitboxRadiusPx: number;
  /**
   * 擦弹圈半径（像素）—— 服务端 `kDanmakuGrazeRadiusMilli`（20000 milli ≈ 20px），
   * 参考布局下正好 20px。**仅当快照下发判定字段**（`tna-1.40-danmaku`）时非 0；
   * 其余 ruleset 为 0，渲染层跳过（默认规则集无擦弹判定）。
   */
  grazeRadiusPx: number;
  /** 无敌帧中（`tick <= invulnerableUntilTick`）→ 渲染层闪烁。 */
  invulnerable: boolean;
  /** 无敌结束 tick（服务端 tick 轴）；`0` = 无判定数据或已结束。 */
  invulnerableUntilTick: number;
  /** 残机数（服务端未下发时取 wire 占位 {@link SNAPSHOT_DEFAULT_LIVES}）。 */
  lives: number;
  /** 炸弹数（服务端未下发时取 wire 占位 {@link SNAPSHOT_DEFAULT_BOMBS}）。 */
  bombs: number;
  /** 擦弹计数（服务端未下发时占位 0）。 */
  graze: number;
  /**
   * P7 计分读数（服务端权威，**原样透传**）。
   *
   * `score` 总分、`hitCount` 受击数、`spellGet`/`spellTotal` 符卡获取数与总数。
   * 视图模型不在这里做任何加分/乘区运算——计分表只有服务端有。
   */
  score: number;
  hitCount: number;
  spellGet: number;
  spellTotal: number;
  /**
   * 服务端是否下发了判定字段（`tna-1.40-danmaku`）。
   *
   * `false` 表示该 ruleset 没有 lives/bombs/graze/无敌帧——渲染层据此隐藏
   * 判定 HUD（而不是把 wire 占位值当成真实残机画出来）。
   */
  judgmentActive: boolean;
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
   * §2.9 插值：**上一份**权威快照，只用来取「最近一 tick 的位移」。
   *
   * 渲染基准永远是当前快照（`frac = 0` 必须逐像素等于权威 tick，§4.1），所以
   * 无速度实体是 `p_n + (p_n - p_{n-1}) * frac` 前向外推，而不是「上一份 → 本份」
   * 的滞后插值。
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
  /** Letterbox offsets: the screen box is scaled uniformly and centred. */
  readonly offsetX: number;
  readonly offsetY: number;

  constructor(readonly layout: PlayfieldLayout) {
    // ★ E1（2026-10-25）：渲染场 = 640×960 **屏幕盒**（子弹生活的世界，
    // `BossRaceSimulation` 就在这个盒里积分并按它±20 剔除），不是 ±120/±90 的
    // 竞技场钳制盒。修复前用竞技场盒且 scale 只按宽度推导：① 竞技场外的子弹
    // （服务端照发）被画出画面 2.67 倍错位；② scale 只按宽度算却用于两轴，
    // 2:3 画面下战场只占上半。修复后与三处同源：美术按 640 宽排版
    // （`battle_scene.ts` artScale=playfield.width/640）、客户端剔除常量是
    // 屏盒（BULLET_CULL_HALF_*）、服务端 kScreenW/H。竞技场盒保持为玩法约束
    // （玩家活动区在屏幕中央，与服务端钳制一致）。
    this.scale = Math.min(
      layout.width / (SCREEN_HALF_WIDTH_MILLI * 2),
      layout.height / (SCREEN_HALF_HEIGHT_MILLI * 2),
    );
    this.offsetX = (layout.width - SCREEN_HALF_WIDTH_MILLI * 2 * this.scale) / 2;
    this.offsetY = (layout.height - SCREEN_HALF_HEIGHT_MILLI * 2 * this.scale) / 2;
  }

  toPixels(xMilli: number, yMilli: number): RenderPoint {
    return {
      x: this.offsetX + (xMilli + SCREEN_HALF_WIDTH_MILLI) * this.scale,
      y: this.offsetY + (yMilli + SCREEN_HALF_HEIGHT_MILLI) * this.scale,
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
  const previousBoss = previous?.boss ?? null;
  const bossMilli = bossWire === null
    ? { x: BOSS_ORIGIN_X_MILLI, y: BOSS_ORIGIN_Y_MILLI }
    : extrapolatePos(
        { x: bossWire.xMilli, y: bossWire.yMilli },
        previousBoss === null
          ? { x: bossWire.xMilli, y: bossWire.yMilli }
          : { x: previousBoss.xMilli, y: previousBoss.yMilli },
        frac,
      );

  for (const player of snapshot.players) {
    const isLocal = player.playerId === options.localPlayerId;
    // §2.9 无速度实体的前向外推：只用「上一 tick 位移」`(p_n - p_{n-1})`。
    // ★不能用快照的 vx/vy 外推玩家：服务端在场地边界**钳位**位置，但快照速度
    // 记的是意图速度（输入方向），两者在边界处分歧——按意图速度外推会让玩家
    // 画出边界（单关对齐实测抓到：tick 32 起玩家贴底边仍被外推 3px）。
    // 位移外推天然钳位安全；弹幕是服务端积分+剔除（不钳位），才用 p+v*frac。
    const before = prevPlayer(player.playerId);
    const current = { x: player.xMilli, y: player.yMilli };
    const position = before === null
      ? current
      : extrapolatePos(current, { x: before.xMilli, y: before.yMilli }, frac);
    // 判定字段（lives/graze/invulnerable）只在 `tna-1.40-danmaku` 下由服务端
    // 下发（`boss_race.cpp:1188-1200`）；缺省 = 判定系统未启用，按 wire 占位值
    // 兜底，擦弹圈不画。
    const judgmentActive =
      player.lives !== undefined ||
      player.graze !== undefined ||
      player.invulnerableUntilTick !== undefined;
    players.push({
      playerId: player.playerId,
      position: transform.toPixels(position.x, position.y),
      isLocal,
      hitboxRadiusPx: transform.radiusToPixels(DANMAKU_HIT_RADIUS_MILLI),
      grazeRadiusPx: judgmentActive ? transform.radiusToPixels(DANMAKU_GRAZE_RADIUS_MILLI) : 0,
      invulnerable:
        player.invulnerableUntilTick !== undefined &&
        snapshot.tick <= player.invulnerableUntilTick,
      invulnerableUntilTick: player.invulnerableUntilTick ?? 0,
      lives: player.lives ?? SNAPSHOT_DEFAULT_LIVES,
      bombs: player.bombs ?? SNAPSHOT_DEFAULT_BOMBS,
      graze: player.graze ?? 0,
      score: player.score ?? 0,
      hitCount: player.hitCount ?? 0,
      spellGet: player.spellGet ?? 0,
      spellTotal: player.spellTotal ?? 0,
      judgmentActive,
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
 * 铁拳：`(x0,y0)` 起点 + `(dx,dy)` **单位方向 ×1000**（服务端约定，如
 * `(1000,0)` = 向右），长度取 `length_milli`。这里按 `length / |(dx,dy)|`
 * 归一化，所以无论是「单位方向×1000」还是「整段位移」都能画对。
 * 黑色帷幕：`edge_y` 一条水平扫屏线。未知 `type` 原样透传但不给几何，渲染层
 * 自己决定忽略（向前兼容新机制）。
 *
 * 服务端只在 `ruleset_version == "tna-1.40-danmaku"` 时下发 effects；其余
 * 规则集 `effects` 为空数组，这里自然什么都不画。
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
 * 无敌帧闪烁周期（tick）。4 亮 4 灭 ≈ 8Hz @60Hz，与 `boss_race_view` 里场上
 * 自机的闪烁**同源**：两边都走 {@link invulnerableBlinkOn}，否则 HUD 与场上
 * 会各闪各的（用户反馈过的「闪烁不同步」类问题）。
 */
export const INVULNERABLE_BLINK_TICKS = 8;

/**
 * 无敌期闪烁相位：`true` = 这一 tick 应该画出来。
 *
 * 纯函数（只依赖 tick），所以自机、判定点、HUD 图标可以在同一帧里用同一
 * 个布尔值决定亮/灭，永远同相。
 */
export function invulnerableBlinkOn(tick: number, invulnerable: boolean): boolean {
  if (!invulnerable) {
    return true;
  }
  return Math.floor(tick / (INVULNERABLE_BLINK_TICKS / 2)) % 2 === 0;
}

/**
 * 判定 HUD（残机 / 炸弹 / 擦弹 / 无敌 + P7 的分数/受击/符卡）的显示状态，
 * 已归一化成可画的形式。
 *
 * 由 {@link buildJudgmentHud} 从 {@link BossRaceFrame} 提取，渲染层只负责画
 * 图标与数字——文案铁律：不含任何自然语言。
 */
export interface JudgmentHudState {
  /** 残机数（≥0）。 */
  lives: number;
  /** 炸弹数（≥0）。 */
  bombs: number;
  /** 擦弹计数（≥0）。 */
  graze: number;
  /** 当前是否在无敌帧内。 */
  invulnerable: boolean;
  /** 无敌结束 tick（服务端 tick 轴）；`0` = 无判定数据或已结束。 */
  invulnerableUntilTick: number;
  /** 无敌剩余 tick；不在无敌期为 0。 */
  invulnerableTicksRemaining: number;
  /** 本 tick 的闪烁相位（与场上自机同相）。 */
  blinkOn: boolean;
  /** 残机耗尽（`lives <= 0`）——HUD 用危险色提示。 */
  exhausted: boolean;
  /** P7 总分（服务端权威，客户端只展示）。 */
  score: number;
  /** {@link score} 的千分位文本（{@link formatScoreDigits}），渲染层直接画。 */
  scoreText: string;
  /** P7 受击数（`hit_count`）。 */
  hitCount: number;
  /** P7 符卡获取数（`spell_get`）。 */
  spellGet: number;
  /** P7 符卡总数（`spell_total`）；0 = 本 ruleset 没有符卡。 */
  spellTotal: number;
}

/**
 * 分数的千分位格式化（`1234567` → `1,234,567`）。
 *
 * ★ 纯数字格式化，**不走 `toLocaleString`**：那依赖运行环境的 locale/ICU，
 * Laya 的原生运行时不一定带，同一份分数会在不同平台画出不同分隔符。也**不引入
 * 任何 i18n 文案**——只有数字和分隔符。
 *
 * 超过 `2^53` 的分数在解码时就已经退化成最接近的双精度值（与 `damage_dealt`
 * 同法，见 `battle_codec.optionalUint64At`），这里只负责把拿到的数分组。
 * 负数/非有限值按 `0` 处理（uint64 不可能为负）。
 */
export function formatScoreDigits(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0';
  }
  const digits = String(Math.trunc(value));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out += ',';
    }
    out += digits[i];
  }
  return out;
}

/**
 * 取本地玩家的判定 HUD 状态；没有本地玩家、或该 ruleset 不下发判定字段
 * （{@link PlayerRenderItem.judgmentActive} 为 `false`）时返回 `null`，
 * 渲染层据此**整块不画**，而不是画一排占位图标。
 */
export function buildJudgmentHud(frame: BossRaceFrame): JudgmentHudState | null {
  const local = frame.players.find((player) => player.isLocal);
  if (local === undefined || !local.judgmentActive) {
    return null;
  }
  const remaining = local.invulnerable
    ? Math.max(0, local.invulnerableUntilTick - frame.tick)
    : 0;
  return {
    lives: Math.max(0, local.lives),
    bombs: Math.max(0, local.bombs),
    graze: Math.max(0, local.graze),
    invulnerable: local.invulnerable,
    invulnerableUntilTick: local.invulnerableUntilTick,
    invulnerableTicksRemaining: remaining,
    blinkOn: invulnerableBlinkOn(frame.tick, local.invulnerable),
    exhausted: local.lives <= 0,
    score: Math.max(0, local.score),
    scoreText: formatScoreDigits(local.score),
    hitCount: Math.max(0, local.hitCount),
    spellGet: Math.max(0, local.spellGet),
    spellTotal: Math.max(0, local.spellTotal),
  };
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
