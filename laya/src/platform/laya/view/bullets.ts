/**
 * Vector rendering of the ten Boss-race bullet patterns.
 *
 * The simulation exposes only a `patternId`; this module turns that string into
 * a *visually distinguishable* silhouette so the curtain is readable at a
 * glance (you can tell an aimed dart from a ring pellet from a laser). The
 * shape family comes from `core/game/bullet_visual.classifyPattern`, keeping
 * the pattern→family decision unit-testable and engine-free.
 *
 * Design rules
 * ------------
 *  - **Pure.** Every draw is a deterministic function of its arguments, so the
 *    same bullet redrawn (even across pooled sprites) looks identical. Animation
 *    is derived from `tick` only — no module-level counters or caches.
 *  - **Palette from `theme`.** Local bullets use the cyan family, rivals the
 *    pink one; danger/homing accents use `COLOR_DANGER`.
 *  - **`VectorPainter` first.** Shapes are composed from the shared painters
 *    (`orb`, `arrowHeadShaded`, `capsule`, `star`) instead of ad-hoc geometry.
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
 * @param angleRad     travel direction in radians; ignored by `orb`
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
  const variant: BulletVisualClass = classifyPattern(patternId);

  switch (variant) {
    case 'arrow':
      drawArrow(g, patternId, radius, palette, angle, tick);
      return;
    case 'capsule':
      drawCapsule(g, radius, palette, angle, tick);
      return;
    case 'stream':
      drawStream(g, radius, palette, angle, tick);
      return;
    case 'orb':
    default:
      drawOrb(g, patternId, radius, palette, tick);
      return;
  }
}

// --- families -------------------------------------------------------------

/** Round bullets: `orb`, with a per-pattern silhouette twist. */
function drawOrb(
  g: Laya.Graphics,
  patternId: string,
  radius: number,
  palette: BulletPalette,
  tick: number,
): void {
  // Cheap 8-step phase drives a subtle breathing ring, so even identical rings
  // feel alive without introducing any state.
  const phase = (tick % 8) / 8;

  if (patternId === 'blossom') {
    // Blossom: a six-petal star around a small orb core, slowly rotating.
    const spin = (tick % 64) / 64 * Math.PI * 2;
    VectorPainter.star(g, 0, 0, 6, radius * 1.35, radius * 0.6, spin, palette.body);
    VectorPainter.orb(g, 0, 0, radius * 0.6, palette.body, palette.core, 0.25);
    return;
  }

  if (patternId === 'gap_ring') {
    // Gap ring: an orb with an open ring around it, so the "gap" reads clearly.
    VectorPainter.orb(g, 0, 0, radius * 0.72, palette.body, palette.core, 0.3);
    const ringRadius = radius * (1.05 + phase * 0.15);
    g.drawCircle(0, 0, ringRadius, null, fade(palette.body, 0.25), Math.max(1, radius * 0.22));
    return;
  }

  if (patternId === 'n_way') {
    // N-way: a slightly faceted round pellet — an octagon reads "spread shot".
    VectorPainter.polygon(g, 0, 0, 8, radius * 1.05, Math.PI / 8, palette.body, palette.core, 1);
    g.drawCircle(0, 0, radius * 0.5, palette.core);
    return;
  }

  // ring (and any unknown fallback): a plain glowing orb with a pulsing outer
  // ring so the classic ring curtain is unmistakable.
  VectorPainter.orb(g, 0, 0, radius, palette.body, palette.core, 0.32);
  const pulse = radius * (1.35 + phase * 0.35);
  g.drawCircle(0, 0, pulse, null, fade(palette.body, 0.3), Math.max(1, radius * 0.18));
}

/** Directional darts: arrowheads that point down their travel axis. */
function drawArrow(
  g: Laya.Graphics,
  patternId: string,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  // Homing bullets get a danger-coloured tracking ring, so a live tracker is
  // visually distinct from a straight aimed shot.
  if (patternId === 'homing') {
    const ringRadius = radius * 1.7;
    const dashCount = 12;
    // Rotate the dashed ring with tick so it reads as "locked on".
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
  }
  // The dart itself: shaded arrowhead with a bright nose, sized a bit larger
  // than the collision radius so the pointing silhouette is obvious.
  VectorPainter.arrowHeadShaded(g, 0, 0, radius * 1.5, angle, palette.body, palette.core);
}

/** Laser segments: capsules stretched along the travel axis. */
function drawCapsule(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  const width = radius * 2;
  const length = radius * 4;
  // A soft glow underlay, then the bright beam core, then a small hot centre.
  VectorPainter.capsule(g, 0, 0, length * 1.12, angle, width * 1.5, fade(palette.body, 0.55));
  VectorPainter.capsule(g, 0, 0, length, angle, width, palette.body);
  VectorPainter.capsule(g, 0, 0, length * 0.55, angle, width * 0.4, palette.core);
  // A tiny tick-driven muzzle flicker at the leading tip.
  const flick = 0.85 + ((tick % 4) / 4) * 0.3;
  g.drawCircle(
    Math.cos(angle) * (length / 2) * flick,
    Math.sin(angle) * (length / 2) * flick,
    Math.max(0.8, radius * 0.3),
    palette.core,
  );
}

/** Streaking bullets: an orb plus a fading trail behind it. */
function drawStream(
  g: Laya.Graphics,
  radius: number,
  palette: BulletPalette,
  angle: number,
  tick: number,
): void {
  // Trail runs opposite the travel direction; two dots of decreasing size and
  // opacity fake motion blur cheaply.
  const back = angle + Math.PI;
  const offset = radius * (1.6 + ((tick % 6) / 6) * 0.4);
  const trailColor = fade(palette.body, 0.45);
  const fadeColor = fade(palette.body, 0.72);
  g.drawCircle(Math.cos(back) * offset, Math.sin(back) * offset, Math.max(0.8, radius * 0.55), trailColor);
  g.drawCircle(Math.cos(back) * offset * 1.9, Math.sin(back) * offset * 1.9, Math.max(0.6, radius * 0.32), fadeColor);
  // Head: a compact orb, a touch smaller than the collision radius so the
  // streak rather than the dot carries the direction.
  VectorPainter.orb(g, 0, 0, radius * 0.85, palette.body, palette.core, 0.3);
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
