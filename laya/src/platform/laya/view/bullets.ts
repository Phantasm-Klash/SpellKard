/**
 * Bullet rendering: real atlas frames for the ported 千夜追忆 danmaku, with a
 * vector fallback for legacy synthetic patterns and for when the atlas has not
 * loaded (headless / offline).
 *
 * Two renderers implement the `BulletRenderer` seam:
 *
 *  - `AtlasBulletRenderer` — looks up `bulletKind → {atlas, frame}` via
 *    `core/game/bullet_visual` and blits the real sprite frame from a
 *    `BulletFrameSource`. Frames are drawn with the playfield's art scale so the
 *    original 640-wide art reads correctly on our portrait playfield.
 *  - `VectorBulletRenderer` — the original pure-vector art, kept as the
 *    fallback and for the legacy 10 synthetic patterns.
 *
 * Design rules
 * ------------
 *  - **Pure.** Every draw is a deterministic function of its arguments, so the
 *    same bullet redrawn (even across pooled sprites) looks identical.
 *  - **Atlas first.** A bullet with a valid `bulletKind` whose frame is loaded
 *    is always drawn as real art; the vector path is only a fallback.
 *  - **Palette from `theme`.** Legacy local bullets use the cyan family, rivals
 *    the pink one.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic classifier/descriptor helpers.
 */

import {
  animatedFrameFor,
  classifyPattern,
  describeBulletKind,
  isRotatingSpecies,
  spriteRotationDeg,
  type BulletVisualClass,
} from '../../../core/game/bullet_visual';
import type { BulletMotionFamily } from '../../../core/sim/danmaku/bullet_motion';
import type { BulletFrameSource } from './bullet_atlas';
import * as theme from './theme';
import { VectorPainter, fade, type BulletDrawRequest, type BulletRenderer } from './sprites';
import { bulletArtScaleForKind } from '../../../core/game/bullet_size';

/** Rival bullets whose owner is local vs. remote pick different palettes. */
interface BulletPalette {
  /** Outer body fill. */
  body: string;
  /** Bright core / specular / nose highlight. */
  core: string;
}

function paletteFor(ownerIsLocal: boolean): BulletPalette {
  return ownerIsLocal
    ? { body: theme.COLOR_LOCAL_BULLET, core: theme.COLOR_LOCAL_BULLET_CORE }
    : { body: theme.COLOR_OPPONENT_BULLET, core: theme.COLOR_OPPONENT_BULLET_CORE };
}

/** Real-danmaku motion family → the nearest vector silhouette family. */
function motionFamilyVisualClass(family: string): BulletVisualClass {
  switch (family as BulletMotionFamily) {
    case 'sine':
    case 'bounce':
    case 'parametric':
      return 'curve';
    case 'homing':
    case 'proximity':
      return 'homing';
    case 'split':
      return 'spread';
    default:
      return 'linear';
  }
}

/**
 * Draws a single bullet at the graphics origin using vector art.
 *
 * @param g            cleared graphics of the bullet sprite
 * @param patternId    legacy pattern id, or `''` for real danmaku
 * @param family       motion family hint used when `patternId` is `''`
 * @param radius       pixel radius (already scaled by the playfield transform)
 * @param ownerIsLocal local bullets use the cyan family, rivals the pink one
 * @param angleRad     travel direction in radians
 * @param tick         animation clock (cheap wobble/pulse, keeps draws pure)
 */
export function drawBullet(
  g: Laya.Graphics,
  patternId: string,
  family: string,
  radius: number,
  ownerIsLocal: boolean,
  angleRad: number,
  tick: number,
): void {
  if (!(radius > 0)) {
    return;
  }
  const angle = Number.isFinite(angleRad) ? angleRad : 0;
  const palette = paletteFor(ownerIsLocal);
  // `chain:*` 是 ChainNode 表路径的 pattern id，不在 legacy 10 模式映射表里。
  // 旧实现只要 patternId 非空就走 classifyPattern，未知 id 一律回落 'linear'，
  // 把 bullet_func_no 的真实运动族覆盖掉 —— 节点链弹幕看起来全成直线弹，
  // 与原版符卡的曲线/旋转/追踪形态完全不同。这类 id 和空 id 一样按
  // motionFamily 分类，legacy 10 模式仍走各自的 trajectory class。
  const legacyPattern = patternId !== '' && !patternId.startsWith('chain:');
  const visualClass: BulletVisualClass =
    legacyPattern ? classifyPattern(patternId) : motionFamilyVisualClass(family);

  switch (visualClass) {
    case 'curve':
      drawCurve(g, radius, palette, angle, tick);
      return;
    case 'orbit':
      drawOrbit(g, radius, palette, tick);
      return;
    case 'homing':
      drawHoming(g, radius, palette, angle, tick);
      return;
    case 'spread':
      drawSpread(g, radius, palette, angle, tick);
      return;
    case 'linear':
    default:
      drawLinear(g, radius, palette, angle);
      return;
  }
}

// --- families -------------------------------------------------------------

/** Straight shots: a clean, self-contained pellet with no motion trail. */
function drawLinear(g: Laya.Graphics, radius: number, palette: BulletPalette, angle: number): void {
  const tip = radius * 1.55;
  g.drawLine(
    Math.cos(angle) * radius * 0.35,
    Math.sin(angle) * radius * 0.35,
    Math.cos(angle) * tip,
    Math.sin(angle) * tip,
    fade(palette.body, 0.4),
    Math.max(1, radius * 0.28),
  );
  VectorPainter.orb(g, 0, 0, radius, palette.body, palette.core, 0.32);
}

/** Curving shots: a pellet with a trail of beads along a bowing path. */
function drawCurve(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  const sign = tick % 16 < 8 ? 1 : -1;
  const back = angle + Math.PI;
  const steps = 3;
  for (let i = 1; i <= steps; i += 1) {
    const bend = sign * i * 0.28;
    const at = back + bend;
    const d = radius * (1.0 + i * 0.85);
    const alpha = 0.35 + i * 0.12;
    const size = Math.max(0.7, radius * (0.5 - i * 0.09));
    g.drawCircle(Math.cos(at) * d, Math.sin(at) * d, size, fade(palette.body, alpha));
  }
  VectorPainter.orb(g, 0, 0, radius * 0.85, palette.body, palette.core, 0.3);
}

/** Orbiting shots: the body stays put but a companion bead and ring circle it. */
function drawOrbit(g: Laya.Graphics, radius: number, palette: BulletPalette, tick: number): void {
  const spin = ((tick % 48) / 48) * Math.PI * 2;
  const ringRadius = radius * 1.5;
  const segs = 10;
  for (let i = 0; i < segs; i += 1) {
    if (i % 2 === 0) {
      continue;
    }
    const a0 = spin + (Math.PI * 2 * i) / segs;
    const a1 = a0 + Math.PI / segs;
    g.drawLine(
      Math.cos(a0) * ringRadius,
      Math.sin(a0) * ringRadius,
      Math.cos(a1) * ringRadius,
      Math.sin(a1) * ringRadius,
      fade(palette.body, 0.45),
      Math.max(1, radius * 0.18),
    );
  }
  const beadA = spin + Math.PI;
  g.drawCircle(
    Math.cos(beadA) * ringRadius,
    Math.sin(beadA) * ringRadius,
    Math.max(0.8, radius * 0.38),
    palette.core,
  );
  VectorPainter.orb(g, 0, 0, radius * 0.8, palette.body, palette.core, 0.3);
}

/** Homing shots: a pellet boxed in by a danger-coloured lock ring. */
function drawHoming(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  const ringRadius = radius * 1.7;
  const dashCount = 12;
  const spin = ((tick % 24) / 24) * Math.PI * 2;
  for (let i = 0; i < dashCount; i += 1) {
    if (i % 2 === 1) {
      continue;
    }
    const a0 = spin + (Math.PI * 2 * i) / dashCount;
    const a1 = a0 + Math.PI / dashCount;
    g.drawLine(
      Math.cos(a0) * ringRadius,
      Math.sin(a0) * ringRadius,
      Math.cos(a1) * ringRadius,
      Math.sin(a1) * ringRadius,
      theme.COLOR_DANGER,
      Math.max(1, radius * 0.22),
    );
  }
  g.drawCircle(0, 0, radius * 1.35, null, fade(theme.COLOR_DANGER, 0.45), Math.max(1, radius * 0.15));
  VectorPainter.arrowHeadShaded(g, 0, 0, radius * 1.5, angle, palette.body, palette.core);
}

/** Spread shots: a long, widening beam fanned outward from the boss. */
function drawSpread(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  const width = radius * 1.8;
  const length = radius * 4.2;
  VectorPainter.capsule(g, 0, 0, length * 1.1, angle, width * 1.6, fade(palette.body, 0.55));
  VectorPainter.capsule(g, 0, 0, length, angle, width, palette.body);
  VectorPainter.capsule(g, 0, 0, length * 0.5, angle, width * 0.35, palette.core);
  const tipX = Math.cos(angle) * (length / 2);
  const tipY = Math.sin(angle) * (length / 2);
  const spread = 0.7 + ((tick % 6) / 6) * 0.25;
  const wing = Math.max(1, radius * 0.3);
  g.drawLine(tipX, tipY, tipX + Math.cos(angle + spread) * radius * 1.7, tipY + Math.sin(angle + spread) * radius * 1.7, fade(palette.body, 0.5), wing);
  g.drawLine(tipX, tipY, tipX + Math.cos(angle - spread) * radius * 1.7, tipY + Math.sin(angle - spread) * radius * 1.7, fade(palette.body, 0.5), wing);
}

// --- renderers ------------------------------------------------------------

/** Pure-vector renderer (legacy patterns + atlas fallback). */
export class VectorBulletRenderer implements BulletRenderer {
  draw(sprite: Laya.Sprite, request: BulletDrawRequest): void {
    sprite.texture = null;
    sprite.rotation = 0;
    sprite.scaleX = 1;
    sprite.scaleY = 1;
    const g = sprite.graphics;
    g.clear();
    drawBullet(
      g,
      request.patternId,
      request.motionFamily,
      request.radius,
      request.ownerIsLocal,
      request.angleRad,
      request.tick,
    );
  }
}

/** Shared stateless instance; the vector renderer holds no per-frame state. */
export const vectorBulletRenderer = new VectorBulletRenderer();

/**
 * Real-art renderer: blits the atlas frame for a bullet's `kEnemyBullet` value.
 *
 * Falls back to the vector renderer in exactly two cases, both explainable:
 *
 *  1. `bulletKind <= 0` — legacy synthetic patterns (`mvp-boss-race-s0`) carry no
 *     `kEnemyBullet` value at all, so there is no art to look up;
 *  2. the frame source has not loaded yet (headless / offline / first frames).
 *
 * **Every** kind 9..224 maps to a frame that exists in the imported atlases
 * (216/216, verified by `tests/bullet_kind_atlas_map.test.ts` against both
 * `index.json` and the reverse-engineered dispatch table), so a missing frame is
 * a real regression rather than a "the art does not exist" case — do not paper
 * over it with a per-kind vector substitute.
 */
export class AtlasBulletRenderer implements BulletRenderer {
  private readonly fallback: BulletRenderer;
  /** 每个 sprite 上一次写入的美术状态。748 颗弹 × 60FPS 时无条件重设贴图/
   *  pivot/scale/rotation 是几十万次冗余属性写，实机掉到 19 FPS。 */
  private readonly cache = new WeakMap<Laya.Sprite, {
    frame: string;
    scale: number;
    rotation: number;
  }>();
  /** 同一显示帧内所有弹共享动画 step；按 bulletKind 缓存算出的帧名，
   *  否则 748 颗弹各跑一次 `animatedFrameFor`（含 species 帧表查表）。 */
  private frameNameCache = new Map<number, string>();
  private lastAnimateStep = -1;

  /**
   * @param source   atlas frame lookup (Laya-backed in the app, stubbed in tests)
   * @param artScale scale applied to native art; use `playfieldWidth / 640` so
   *                 the original 640-wide art matches our playfield
   * @param fallback renderer used when a frame is unavailable
   */
  constructor(
    private readonly source: BulletFrameSource,
    private artScale = 1,
    fallback: BulletRenderer = vectorBulletRenderer,
  ) {
    this.fallback = fallback;
  }

  /**
   * Updates the art scale after the playfield is resized. The caller passes
   * `playfieldWidth / 640` again; the next `draw` picks up the new value.
   */
  setArtScale(scale: number): void {
    this.artScale = scale;
  }

  draw(sprite: Laya.Sprite, request: BulletDrawRequest): void {
    const descriptor = request.bulletKind > 0 ? describeBulletKind(request.bulletKind) : null;
    if (descriptor === null) {
      // 矢量 fallback 会往 graphics 里画东西；下次切回图集必须重新 clear。
      this.cache.delete(sprite);
      this.fallback.draw(sprite, request);
      return;
    }
    let frameName = descriptor.frame;
    if (request.animate) {
      // animatedFrameFor 的 fps 默认 8；step 每 7.5 tick 才变一次，
      // 同一显示帧里 748 颗弹只需按 bulletKind 各算一次。
      const step = Math.max(0, Math.floor((request.tick * 8) / 60));
      if (step !== this.lastAnimateStep) {
        this.frameNameCache.clear();
        this.lastAnimateStep = step;
      }
      let animated = this.frameNameCache.get(request.bulletKind);
      if (animated === undefined) {
        animated = animatedFrameFor(request.bulletKind, request.tick) || descriptor.frame;
        this.frameNameCache.set(request.bulletKind, animated);
      }
      frameName = animated;
    }
    const texture = this.source.frame(descriptor.atlas, frameName);
    if (texture === null || texture === undefined) {
      this.cache.delete(sprite);
      this.fallback.draw(sprite, request);
      return;
    }

    let cached = this.cache.get(sprite);
    if (cached === undefined) {
      // 首次接管（或从 fallback 切回）才清 graphics；图集路径本身不画矢量，
      // 没必要每帧 clear。
      sprite.graphics.clear();
      cached = { frame: '', scale: Number.NaN, rotation: Number.NaN };
      this.cache.set(sprite, cached);
    }
    if (cached.frame !== frameName) {
      sprite.texture = texture;
      const sourceW = texture.sourceWidth || texture.width;
      const sourceH = texture.sourceHeight || texture.height;
      sprite.pivot(sourceW / 2, sourceH / 2);
      cached.frame = frameName;
    }
    // ★ 2026-11-13：原版 `setBulletType` 按弹种写对象 +0x5f0 的美术缩放。
    // 旧实现所有弹共用 artScale，32x32 的 heart 与 16x16 的 ring 被画成同一大小。
    const scale = this.artScale * bulletArtScaleForKind(request.bulletKind);
    if (cached.scale !== scale) {
      sprite.scaleX = scale;
      sprite.scaleY = scale;
      cached.scale = scale;
    }
    // Directional species face their heading; round species stay upright.
    const rotation =
      isRotatingSpecies(descriptor.species) && Number.isFinite(request.angleDeg)
        ? spriteRotationDeg(request.angleDeg)
        : 0;
    if (cached.rotation !== rotation) {
      sprite.rotation = rotation;
      cached.rotation = rotation;
    }
  }
}

/**
 * Picks a renderer for the frame: atlas-backed when a frame source is given,
 * otherwise the pure-vector fallback.
 */
export function createBulletRenderer(source?: BulletFrameSource, artScale = 1): BulletRenderer {
  return source === undefined ? vectorBulletRenderer : new AtlasBulletRenderer(source, artScale);
}

/** Re-export so the view layer and tests can reach the classifier via one path. */
export { classifyPattern };
export type { BulletVisualClass };
