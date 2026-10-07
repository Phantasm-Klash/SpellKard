/**
 * Arena rendering primitives for the boss-race battle view.
 *
 * Three pure draw functions compose the static playfield and the two actor
 * families (Boss copies, player ships) out of `Laya.Graphics` primitives:
 *
 *  - `drawPlayfield` paints the deep-space backdrop, a faint grid, centre
 *    reticle and an inner-glow edge frame.
 *  - `drawBoss` paints one Boss copy: orb body, tick-rotating rune ring, HP bar
 *    and a greyed-out defeat treatment.
 *  - `drawPlayer` paints one ship: an aimed arrowhead plus a hitbox pip, which
 *    turns into a focal ring while the player holds the focus key.
 *
 * Statelessness: every function is a pure function of its arguments, so calling
 * them twice with the same inputs yields identical command lists. All animation
 * comes from an explicit `tick`; no module-level state is kept.
 *
 * Rendering order note: the caller draws the *opponent* Boss first and the
 * local Boss second so the local copy sits on top. These functions do not
 * reorder anything themselves — they draw into the `Graphics` they are given.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`.
 */

import * as theme from './theme';
import { VectorPainter, fade, mix } from './sprites';

/** Grid cell size in pixels for the playfield background mesh. */
const GRID_STEP = 48;
/** Radius of the centre reticle circle, as a fraction of the playfield width. */
const RETICLE_RADIUS_RATIO = 0.18;

/**
 * Paints the playfield backdrop: gradient sky, faint grid, centre reticle and
 * an inner-glow edge frame.
 *
 * `drawLine`/`drawRect` have no per-command alpha, so low-contrast lines are
 * produced by blending the stroke colour toward `COLOR_VOID` via `fade`.
 */
export function drawPlayfield(g: Laya.Graphics, width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    return;
  }

  // 1. Backdrop. LayaAir's `Graphics` has no gradient primitive, so the sky is
  //    approximated with discrete vertical bands that read as a gradient.
  const bands = 8;
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    const bandY = (height / bands) * i;
    const bandH = height / bands + 1;
    g.drawRect(0, bandY, width, bandH, mix(theme.COLOR_PLAYFIELD, theme.COLOR_VOID, t * 0.75));
  }

  // 2. Faint square grid. Two passes (coarse + finer) give a sense of depth.
  const gridColor = fade(theme.COLOR_PLAYFIELD_EDGE, 0.35);
  const gridColorDeep = fade(theme.COLOR_PLAYFIELD_EDGE, 0.6);
  for (let x = GRID_STEP; x < width; x += GRID_STEP) {
    const strong = x % (GRID_STEP * 4) === 0;
    g.drawLine(x, 0, x, height, strong ? gridColorDeep : gridColor, 1);
  }
  for (let y = GRID_STEP; y < height; y += GRID_STEP) {
    const strong = y % (GRID_STEP * 4) === 0;
    g.drawLine(0, y, width, y, strong ? gridColorDeep : gridColor, 1);
  }

  // 3. Centre reticle: a big faint circle, an inner ring and cross ticks, so
  //    the boss anchor area reads as "the place to be".
  const cx = width / 2;
  const cy = height / 2;
  const reticle = Math.min(width, height) * RETICLE_RADIUS_RATIO;
  g.drawCircle(cx, cy, reticle, null, fade(theme.COLOR_ACCENT, 0.55), 1);
  g.drawCircle(cx, cy, reticle * 0.62, null, fade(theme.COLOR_ACCENT, 0.7), 1);
  const tickLen = Math.min(width, height) * 0.03;
  g.drawLine(cx - reticle - tickLen, cy, cx - reticle, cy, fade(theme.COLOR_ACCENT, 0.6), 1);
  g.drawLine(cx + reticle, cy, cx + reticle + tickLen, cy, fade(theme.COLOR_ACCENT, 0.6), 1);
  g.drawLine(cx, cy - reticle - tickLen, cx, cy - reticle, fade(theme.COLOR_ACCENT, 0.6), 1);
  g.drawLine(cx, cy + reticle, cx, cy + reticle + tickLen, fade(theme.COLOR_ACCENT, 0.6), 1);

  // 4. Inner-glow edge frame: several nested strokes, brightest at the very
  //    edge and fading inward, which fakes a soft interior vignette.
  const layers = 5;
  for (let i = 0; i < layers; i += 1) {
    const inset = i * 3;
    const strength = 1 - i / layers;
    const color = mix(theme.COLOR_PLAYFIELD_EDGE, theme.COLOR_BORDER, strength * 0.5);
    g.drawRect(inset, inset, width - inset * 2, height - inset * 2, null, color, 2);
  }
  // Final crisp outer border on top.
  g.drawRect(0, 0, width, height, null, theme.COLOR_BORDER, 2);
}

/**
 * Paints one Boss copy at the origin of the given `Graphics`.
 *
 * @param radius   body radius in pixels (local Boss is larger than the rival's)
 * @param hpRatio  0..1 HP fraction; drives the HP bar fill and colour
 * @param defeated when true the Boss is desaturated to `COLOR_BOSS_DEFEATED`
 * @param isLocal  local Boss gets the full treatment; rival is dimmer
 * @param tick     animation clock; rotates the rune ring and pulses the halo
 */
export function drawBoss(
  g: Laya.Graphics,
  radius: number,
  hpRatio: number,
  defeated: boolean,
  isLocal: boolean,
  tick: number,
): void {
  if (radius <= 0) {
    return;
  }
  const clampedHp = Math.max(0, Math.min(1, hpRatio));
  const bodyColor = defeated ? theme.COLOR_BOSS_DEFEATED : theme.COLOR_BOSS;
  const ringColor = defeated ? fade(theme.COLOR_BOSS_RING, 0.5) : theme.COLOR_BOSS_RING;
  const coreColor = defeated ? mix(theme.COLOR_BOSS_DEFEATED, theme.COLOR_TEXT, 0.15) : theme.COLOR_ACCENT;
  const spin = tick * 0.02;

  // 1. Rotating rune ring: an outer dashed polygon that turns with the tick.
  const runeSides = 6;
  const runeRadius = radius * 1.55;
  const dashSegments = runeSides * 2;
  for (let i = 0; i < dashSegments; i += 1) {
    const a0 = spin + (Math.PI * 2 * i) / dashSegments;
    const a1 = a0 + Math.PI / dashSegments;
    const rOuter = runeRadius;
    const rInner = runeRadius * 0.82;
    g.drawLine(
      Math.cos(a0) * rInner,
      Math.sin(a0) * rInner,
      Math.cos(a1) * rInner,
      Math.sin(a1) * rInner,
      ringColor,
      2,
    );
    // Spokes out to the outer radius every other segment.
    if (i % 2 === 0) {
      g.drawLine(
        Math.cos(a0) * rInner,
        Math.sin(a0) * rInner,
        Math.cos(a0) * rOuter,
        Math.sin(a0) * rOuter,
        fade(ringColor, 0.35),
        1,
      );
    }
  }

  // 2. Slowly counter-rotating inner halo ring for parallax.
  const haloRadius = radius * 1.22;
  const haloSpin = -spin * 0.6;
  const haloDots = 12;
  for (let i = 0; i < haloDots; i += 1) {
    const a = haloSpin + (Math.PI * 2 * i) / haloDots;
    g.drawCircle(Math.cos(a) * haloRadius, Math.sin(a) * haloRadius, Math.max(1, radius * 0.06), fade(ringColor, 0.3));
  }

  // 3. Body: glowing orb (halo + core + specular), then a ringed outline.
  VectorPainter.orb(g, 0, 0, radius, bodyColor, coreColor, defeated ? 0.5 : 0.35);
  g.drawCircle(0, 0, radius, null, ringColor, 2);

  // 4. Inner sigil: a static star that reads as the Boss "core".
  const sigil = defeated ? fade(theme.COLOR_BOSS_DEFEATED, 0.2) : mix(theme.COLOR_ACCENT, bodyColor, 0.35);
  VectorPainter.star(g, 0, 0, 4, radius * 0.55, radius * 0.22, spin * 0.5, sigil);

  // 5. HP bar just below the body. The local Boss gets the readable one;
  //    the rival's is shorter and dimmer so it does not compete for attention.
  const barWidth = isLocal ? radius * 2.4 : radius * 1.8;
  const barHeight = isLocal ? 5 : 3;
  const barY = radius * 1.45;
  const barColor = clampedHp <= 0.3 ? theme.COLOR_HP_BAR_LOW : theme.COLOR_HP_BAR;
  VectorPainter.progressBar(
    g,
    -barWidth / 2,
    barY,
    barWidth,
    barHeight,
    clampedHp,
    defeated ? theme.COLOR_BOSS_DEFEATED : barColor,
  );

  // 6. Defeat treatment: a flat X across the body, no glow.
  if (defeated) {
    const d = radius * 0.7;
    g.drawLine(-d, -d, d, d, fade(theme.COLOR_DANGER, 0.4), 3);
    g.drawLine(-d, d, d, -d, fade(theme.COLOR_DANGER, 0.4), 3);
  }
}

/**
 * Paints one player ship at the origin of the given `Graphics`, nose pointing
 * along `angleRad` (0 = +x, +y is screen-down).
 *
 * Local ship: gold arrowhead + white outline + hitbox pip, plus a slow focal
 * ring when `isFocused`. Rival ships are drawn smaller and in the neutral
 * player colour so they stay readable but subordinate.
 */
export function drawPlayer(
  g: Laya.Graphics,
  radius: number,
  isLocal: boolean,
  isFocused: boolean,
  angleRad: number,
): void {
  if (radius <= 0) {
    return;
  }
  const angle = Number.isFinite(angleRad) ? angleRad : 0;

  if (!isLocal) {
    // Rival: a muted arrowhead, no glow.
    VectorPainter.arrowHead(g, 0, 0, radius * 1.6, angle, fade(theme.COLOR_PLAYER, 0.35));
    g.drawCircle(0, 0, Math.max(1, radius * 0.4), theme.COLOR_TEXT_DISABLED);
    return;
  }

  const size = radius * 1.9;

  // Focal ring: only while the focus key is held. Two counter-rotating dashes
  // give a "slow mode" cue without extra state (driven by the angle itself).
  if (isFocused) {
    const hitbox = radius * 1.6;
    g.drawCircle(0, 0, hitbox, null, fade(theme.COLOR_HITBOX, 0.35), 1);
    const dashCount = 16;
    for (let i = 0; i < dashCount; i += 1) {
      if (i % 2 === 1) {
        continue;
      }
      const a0 = (Math.PI * 2 * i) / dashCount;
      const a1 = a0 + Math.PI / dashCount;
      const r = radius * 2.6;
      g.drawLine(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * r, Math.sin(a1) * r, fade(theme.COLOR_HITBOX, 0.5), 2);
    }
  }

  // Ship body: gold arrowhead with a shaded nose, plus a white outline ring.
  VectorPainter.arrowHeadShaded(g, 0, 0, size, angle, theme.COLOR_LOCAL_PLAYER, theme.COLOR_PLAYER);
  // Outline traced as a thin triangle slightly larger than the body.
  g.drawPoly(
    0,
    0,
    [
      Math.cos(angle) * size * 1.12,
      Math.sin(angle) * size * 1.12,
      Math.cos(angle + Math.PI - 0.5) * size * 0.95,
      Math.sin(angle + Math.PI - 0.5) * size * 0.95,
      Math.cos(angle + Math.PI + 0.5) * size * 0.95,
      Math.sin(angle + Math.PI + 0.5) * size * 0.95,
    ],
    null,
    theme.COLOR_PLAYER,
    1,
  );

  // Hitbox pip: the true collision point at the centre.
  g.drawCircle(0, 0, Math.max(1.2, radius * 0.42), isFocused ? theme.COLOR_HITBOX : theme.COLOR_LOCAL_PLAYER);
}
