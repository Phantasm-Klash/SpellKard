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
  const visualClass: BulletVisualClass =
    patternId === '' ? motionFamilyVisualClass(family) : classifyPattern(patternId);

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
 * Falls back to the vector renderer when the kind is unknown or the frame has
 * not loaded, so a missing atlas degrades to the old look instead of a blank.
 */
export class AtlasBulletRenderer implements BulletRenderer {
  private readonly fallback: BulletRenderer;

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
      this.fallback.draw(sprite, request);
      return;
    }
    const frameName = request.animate
      ? animatedFrameFor(request.bulletKind, request.tick) || descriptor.frame
      : descriptor.frame;
    const texture = this.source.frame(descriptor.atlas, frameName);
    if (texture === null) {
      this.fallback.draw(sprite, request);
      return;
    }

    sprite.graphics.clear();
    sprite.texture = texture;
    const sourceW = texture.sourceWidth || texture.width;
    const sourceH = texture.sourceHeight || texture.height;
    sprite.pivot(sourceW / 2, sourceH / 2);
    sprite.scaleX = this.artScale;
    sprite.scaleY = this.artScale;
    // Directional species face their heading; round species stay upright.
    sprite.rotation =
      isRotatingSpecies(descriptor.species) && Number.isFinite(request.angleDeg)
        ? spriteRotationDeg(request.angleDeg)
        : 0;
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
