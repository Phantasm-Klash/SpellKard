/**
 * Vector rendering of the ten Boss-race bullet patterns.
 *
 * The simulation exposes only a `patternId`; this module turns that string into
 * a silhouette whose **motion is readable at a glance** — a straight pellet
 * looks like it will not turn, a curving shot trails an arc, an orbiting one
 * carries a spinning companion, a homing one wears a lock ring, and a spread
 * shot reads as an opening fan. The trajectory family comes from
 * `core/game/bullet_visual.classifyPattern` (`linear` / `curve` / `orbit` /
 * `homing` / `spread`), keeping the pattern→family decision unit-testable and
 * engine-free.
 *
 * Design rules
 * ------------
 *  - **Pure.** Every draw is a deterministic function of its arguments, so the
 *    same bullet redrawn (even across pooled sprites) looks identical. Animation
 *    is derived from `tick` only — no module-level counters or caches.
 *  - **Palette from `theme`.** Local bullets use the cyan family, rivals the
 *    pink one; danger/homing accents use `COLOR_DANGER`.
 *  - **`VectorPainter` first.** Shapes are composed from the shared painters
 *    (`orb`, `arrowHeadShaded`, `capsule`, `star`, `polygon`) instead of
 *    ad-hoc geometry.
 *  - **One look per trajectory.** All four `linear` patterns share the clean
 *    pellet-and-head art so the *trajectory* (not the pattern name) drives the
 *    visual language.
 *
 * The graphics passed in is the bullet sprite's own, already cleared, and the
 * bullet sits at its local origin `(0, 0)`.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic classifier.
 */

import { classifyPattern, type BulletVisualClass } from '../../../core/game/bullet_visual';
import * as theme from './theme';
import { VectorPainter, fade, type BulletRenderer } from './sprites';

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

/**
 * Draws a single bullet at the graphics origin.
 *
 * @param g            cleared graphics of the bullet sprite
 * @param patternId    one of `BOSS_RACE_PATTERN_IDS`
 * @param radius       pixel radius (already scaled by the playfield transform)
 * @param ownerIsLocal local bullets use the cyan family, rivals the pink one
 * @param angleRad     travel direction in radians; ignored by `spread`'s beams
 * @param tick         animation clock (cheap wobble/pulse, keeps draws pure)
 */
export function drawBullet(
  g: Laya.Graphics,
  patternId: string,
  radius: number,
  ownerIsLocal: boolean,
  angleRad: number,
  tick: number,
): void {
  if (!(radius > 0)) {
    return;
  }
  // Guard against `NaN` when a velocity is momentarily zero.
  const angle = Number.isFinite(angleRad) ? angleRad : 0;
  const palette = paletteFor(ownerIsLocal);
  const family: BulletVisualClass = classifyPattern(patternId);

  switch (family) {
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
//
// Each family is keyed on *how the shot moves*, so all patterns in a family
// share one motion language:
//
//   linear  clean pellet, no trail — "heads straight, never turns"
//   curve   pellet + arc of trail points bent off the tangent heading
//   orbit   pellet + a companion bead and ring circling the body
//   homing  pellet inside a danger-coloured lock ring
//   spread  a long, opening beam, so it reads as a fan not a ray

/** Straight shots: a clean, self-contained pellet with no motion trail. */
function drawLinear(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
): void {
  // A slim nose tick gives direction without implying a turn.
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

/**
 * Curving shots: a pellet with a trail of beads along a bowing path. The trail
 * offsets are rotated off the *tangent* heading by a growing angle, so the
 * beads sit on an arc rather than a straight line — the visual cue that the
 * heading is changing. The bow direction flips per tick, matching the
 * oscillating `sine_stream`.
 */
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
    // Three trail points of decreasing size/opacity walking backward.
    const bend = sign * i * 0.28;
    const at = back + bend;
    const d = radius * (1.0 + i * 0.85);
    const alpha = 0.35 + i * 0.12;
    const size = Math.max(0.7, radius * (0.5 - i * 0.09));
    g.drawCircle(Math.cos(at) * d, Math.sin(at) * d, size, fade(palette.body, alpha));
  }
  // Head, a touch smaller than the collision radius so the arc carries it.
  VectorPainter.orb(g, 0, 0, radius * 0.85, palette.body, palette.core, 0.3);
}

/**
 * Orbiting shots: the body stays put but a companion bead and a ring circle it,
 * so the silhouette itself rotates. This reads as the emitter sweeping around
 * (the helix / rose of `spiral` and `blossom`) rather than a shot that turns.
 */
function drawOrbit(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  tick: number,
): void {
  const spin = (tick % 48) / 48 * Math.PI * 2;
  // Rotating ring around the body — a soft orbit trace.
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
  // Companion bead circling the body, opposite a ring gap.
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
  // Dashed danger ring, spun by tick so it reads as "locked on".
  const ringRadius = radius * 1.7;
  const dashCount = 12;
  const spin = (tick % 24) / 24 * Math.PI * 2;
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
  // The chase itself: a shaded arrowhead re-aiming along the (bending) heading.
  VectorPainter.arrowHeadShaded(g, 0, 0, radius * 1.5, angle, palette.body, palette.core);
}

/**
 * Spread shots: a long, widening beam fanned outward from the boss. Drawn as a
 * stretched capsule plus two flare wings at the far tip, so the shot reads as
 * an opening curtain rather than a parallel ray.
 */
function drawSpread(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  const width = radius * 1.8;
  const length = radius * 4.2;
  // Soft glow underlay, bright beam body, then a hot centre line.
  VectorPainter.capsule(g, 0, 0, length * 1.1, angle, width * 1.6, fade(palette.body, 0.55));
  VectorPainter.capsule(g, 0, 0, length, angle, width, palette.body);
  VectorPainter.capsule(g, 0, 0, length * 0.5, angle, width * 0.35, palette.core);
  // Two flare wings at the leading tip, opening at ~40° — the "fan".
  const tipX = Math.cos(angle) * (length / 2);
  const tipY = Math.sin(angle) * (length / 2);
  const spread = 0.7 + ((tick % 6) / 6) * 0.25;
  const wing = Math.max(1, radius * 0.3);
  g.drawLine(tipX, tipY, tipX + Math.cos(angle + spread) * radius * 1.7, tipY + Math.sin(angle + spread) * radius * 1.7, fade(palette.body, 0.5), wing);
  g.drawLine(tipX, tipY, tipX + Math.cos(angle - spread) * radius * 1.7, tipY + Math.sin(angle - spread) * radius * 1.7, fade(palette.body, 0.5), wing);
}

// --- renderer seam --------------------------------------------------------

/**
 * `BulletRenderer` implementation backed by `drawBullet`. Kept as a class so a
 * future sprite-atlas renderer can be swapped in at the same call site.
 */
export class VectorBulletRenderer implements BulletRenderer {
  draw(
    g: Laya.Graphics,
    patternId: string,
    radius: number,
    ownerIsLocal: boolean,
    angleRad: number,
    tick: number,
  ): void {
    drawBullet(g, patternId, radius, ownerIsLocal, angleRad, tick);
  }
}

/** Shared stateless instance; the renderer holds no per-frame state. */
export const vectorBulletRenderer = new VectorBulletRenderer();

/** Re-export so the view layer and tests can reach the classifier via one path. */
export { classifyPattern };
export type { BulletVisualClass };
