/**
 * Vector shape helpers and the replaceable sprite-renderer seam.
 *
 * Two jobs live here:
 *
 * 1. `VectorPainter` — static helpers that compose the small `Graphics`
 *    primitive set into the shapes the client needs (rings, capsules,
 *    triangles, arrowheads, rounded panels). Centralising them avoids four
 *    copies of the same trigonometry across scenes and the battle view.
 *
 * 2. `ActorRenderer` / `BulletRenderer` — interfaces describing *what* an actor
 *    or a bullet looks like, decoupled from *how* it is drawn. The default
 *    implementations are pure vector. When real sprite atlases arrive, a second
 *    implementation can be dropped in and swapped at the call site without
 *    touching layout, HUD or the frame model.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`.
 */

import * as theme from './theme';

/**
 * Facing direction in radians. The vector helpers below treat `0` as `+x` and
 * grow clockwise (`+y` is screen-down). Player headings use the portrait
 * convention instead — see `drawPlayer` in `arena.ts`: there `0` is straight up.
 */
export interface Facing {
  angleRad: number;
}

export class VectorPainter {
  /** Filled circle with an optional outer ring. */
  static dot(g: Laya.Graphics, x: number, y: number, radius: number, fill: string, ring?: string, ringWidth = 1): void {
    g.drawCircle(x, y, radius, fill, ring ?? null, ring ? ringWidth : undefined);
  }

  /** Glowing orb: a soft halo, a solid core and a bright specular highlight. */
  static orb(
    g: Laya.Graphics,
    x: number,
    y: number,
    radius: number,
    fill: string,
    core: string,
    haloAlpha = 0.35,
  ): void {
    // Halo: a larger, very transparent disc. `Graphics` has no per-command
    // alpha, so we approximate it with a darkened halo colour blended by hand.
    const halo = mix(fill, theme.COLOR_VOID, haloAlpha);
    g.drawCircle(x, y, radius * 1.6, halo);
    g.drawCircle(x, y, radius, fill);
    // Specular highlight offset up-left so orbs read as 3D at small sizes.
    g.drawCircle(x - radius * 0.28, y - radius * 0.28, Math.max(0.8, radius * 0.34), core);
  }

  /** Capsule: a line with round caps, i.e. a laser segment of length `length`. */
  static capsule(
    g: Laya.Graphics,
    x: number,
    y: number,
    length: number,
    angleRad: number,
    width: number,
    fill: string,
  ): void {
    // Draw as a rotated thick line from the centre outwards, both directions so
    // the visual centre stays on the bullet position.
    const half = length / 2;
    const dx = Math.cos(angleRad) * half;
    const dy = Math.sin(angleRad) * half;
    g.drawLine(x - dx, y - dy, x + dx, y + dy, fill, width);
    // Round the ends so it reads as a beam rather than a rectangle.
    const r = width / 2;
    g.drawCircle(x - dx, y - dy, r, fill);
    g.drawCircle(x + dx, y + dy, r, fill);
  }

  /** Downward/outward-facing triangle, used for aimed/homing bullets. */
  static arrowHead(g: Laya.Graphics, x: number, y: number, size: number, angleRad: number, fill: string): void {
    const points = trianglePoints(x, y, size, angleRad);
    g.drawPoly(0, 0, points, fill);
  }

  /** Triangle with a brighter nose, to hint at direction without a texture. */
  static arrowHeadShaded(g: Laya.Graphics, x: number, y: number, size: number, angleRad: number, fill: string, nose: string): void {
    const points = trianglePoints(x, y, size, angleRad);
    g.drawPoly(0, 0, points, fill);
    const nosePoints = trianglePoints(
      x + Math.cos(angleRad) * size * 0.28,
      y + Math.sin(angleRad) * size * 0.28,
      size * 0.5,
      angleRad,
    );
    g.drawPoly(0, 0, nosePoints, nose);
  }

  /** Star / blossom petal shape via an N-gon with alternating radii. */
  static star(g: Laya.Graphics, x: number, y: number, points: number, outer: number, inner: number, angleRad: number, fill: string): void {
    const coords: number[] = [];
    for (let i = 0; i < points * 2; i += 1) {
      const r = i % 2 === 0 ? outer : inner;
      const a = angleRad + (Math.PI * i) / points;
      coords.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.drawPoly(0, 0, coords, fill);
  }

  /** Regular N-gon (used for hexagonal/octagonal telegraphs). */
  static polygon(g: Laya.Graphics, x: number, y: number, sides: number, radius: number, angleRad: number, fill: string, ring?: string, ringWidth = 1): void {
    const coords: number[] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = angleRad + (Math.PI * 2 * i) / sides;
      coords.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius);
    }
    g.drawPoly(0, 0, coords, fill, ring ?? null, ring ? ringWidth : undefined);
  }

  /** Rounded rectangle using the engine's native `drawRoundRect`. */
  static roundedPanel(g: Laya.Graphics, x: number, y: number, width: number, height: number, radius: number, fill: string, border?: string, borderWidth = 2): void {
    const r = Math.min(radius, width / 2, height / 2);
    g.drawRoundRect(x, y, width, height, r, r, r, r, fill, border ?? null, border ? borderWidth : 1);
  }

  /** Outline-only rounded rectangle (transparent fill, stroked border). */
  static roundedOutline(g: Laya.Graphics, x: number, y: number, width: number, height: number, radius: number, color: string, lineWidth = 2): void {
    const r = Math.min(radius, width / 2, height / 2);
    g.drawRoundRect(x, y, width, height, r, r, r, r, null, color, lineWidth);
  }

  /** Horizontal progress bar with a deep track and a filled portion. */
  static progressBar(g: Laya.Graphics, x: number, y: number, width: number, height: number, ratio: number, fill: string, track = theme.COLOR_HP_BACK): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    g.drawRect(x, y, width, height, track);
    if (clamped > 0) {
      g.drawRect(x, y, width * clamped, height, fill);
      // A brighter cap line so the leading edge reads clearly.
      g.drawRect(x + width * clamped - Math.min(2, width * clamped), y, Math.min(2, width * clamped), height, theme.COLOR_HUD);
    }
  }

  /** Vertical or horizontal divider rule. */
  static divider(g: Laya.Graphics, x: number, y: number, length: number, horizontal: boolean, color = theme.COLOR_DIVIDER): void {
    if (horizontal) {
      g.drawLine(x, y, x + length, y, color, 1);
    } else {
      g.drawLine(x, y, x, y + length, color, 1);
    }
  }
}

/** Triangle vertices for a nose-forward marker of the given size. */
function trianglePoints(x: number, y: number, size: number, angleRad: number): number[] {
  const tip = angleRad;
  const backLeft = angleRad + Math.PI - 0.5;
  const backRight = angleRad + Math.PI + 0.5;
  return [
    x + Math.cos(tip) * size,
    y + Math.sin(tip) * size,
    x + Math.cos(backLeft) * size * 0.85,
    y + Math.sin(backLeft) * size * 0.85,
    x + Math.cos(backRight) * size * 0.85,
    y + Math.sin(backRight) * size * 0.85,
  ];
}

/** Linear blend of two `#rrggbb` colours; `t` = 0 returns `a`, `t` = 1 returns `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k);
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`;
}

/** Blend a colour toward the void background by `amount` (0..1), i.e. fade it out. */
export function fade(color: string, amount: number): string {
  return mix(color, theme.COLOR_VOID, amount);
}

function parseHex(color: string): [number, number, number] {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0');
}

// --- replaceable renderer seam -------------------------------------------------

/**
 * Draws a single bullet into a sprite's graphics. Implementations receive the
 * already-cleared graphics and the pixel-space position (sprite origin).
 */
export interface BulletRenderer {
  /**
   * @param g            cleared graphics of the bullet sprite
   * @param patternId    one of `BOSS_RACE_PATTERN_IDS`
   * @param radius       pixel radius
   * @param ownerIsLocal local bullets use the cyan family, rivals the pink one
   * @param angleRad     travel direction (may be NaN when unavailable)
   * @param tick         current tick, for cheap animation without extra state
   */
  draw(
    g: Laya.Graphics,
    patternId: string,
    radius: number,
    ownerIsLocal: boolean,
    angleRad: number,
    tick: number,
  ): void;
}

/** Draws an actor (Boss copy or player ship) in pixel space. */
export interface ActorRenderer {
  drawBoss(
    g: Laya.Graphics,
    radius: number,
    hpRatio: number,
    defeated: boolean,
    isLocal: boolean,
    tick: number,
  ): void;
  drawPlayer(g: Laya.Graphics, radius: number, isLocal: boolean, isFocused: boolean, angleRad: number): void;
}
