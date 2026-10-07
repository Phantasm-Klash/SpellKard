/**
 * Battle HUD rendering.
 *
 * Two entry points share one state shape:
 *
 *  - `drawHudBar` upgrades the old plain-text HUD into a structured layout:
 *    a local panel on the left, a centred status badge, the rival panel on the
 *    right, and a thin metrics footer. Bars and rules are drawn with
 *    `Graphics`; only the numeric labels go through `fillText`.
 *  - `formatHudLines` is the pure-text fallback that reproduces the previous
 *    multi-line string HUD, so any caller still using the
 *    `render(frame, hudLines)` contract keeps working unchanged.
 *
 * Both are pure functions of `HudState` — no module-level state.
 *
 * Layout model: every `y` passed around this module is a **row top**. The
 * engine's `Graphics.fillText(text, x, y, ...)` treats `y` as the text's
 * vertical **centre** (the engine's own code draws at `margin + fontSize / 2`),
 * so text is always emitted at `rowTop + fontSize * ASCENT_RATIO` via `baselineOf()`. One
 * model everywhere is what keeps the label / bar / value rows from drifting
 * into each other.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`.
 */

import * as theme from './theme';
import { VectorPainter, fade } from './sprites';

/** Everything the HUD needs for one redraw, in display-ready form. */
export interface HudState {
  /** 0..1 HP fraction of the local Boss copy. */
  localHpRatio: number;
  /** 0..1 HP fraction of the rival Boss copy. */
  rivalHpRatio: number;
  /** Maximum HP of a Boss copy, for the `current/max` labels. */
  bossMaxHp: number;
  /** Local Boss current HP. */
  localHp: number;
  /** Rival Boss current HP. */
  rivalHp: number;
  /** Damage the local player has dealt this match. */
  damageDealt: number;
  /** Current simulation tick. */
  tick: number;
  /** Human-readable match state, e.g. `Running`. */
  stateName: string;
  /** Active bullet pattern id, e.g. `spiral`. */
  patternId: string;
  /** Bullets currently in flight. */
  bullets: number;
  /** Short connection label, e.g. `server` / `predicted`. */
  connectionLabel: string;
  /** Pre-formatted metrics footer line. */
  metricsLine: string;
}

/** Height of an HP bar track. */
const BAR_HEIGHT = 10;
/** Local / rival panels take at most this fraction of the inner width. */
const PANEL_WIDTH_RATIO = 0.34;
/** Highest sensible panel width, so wide windows do not stretch the meters. */
const PANEL_WIDTH_MAX = 200;
/**
 * Converts a row top into the `y` that `Graphics.fillText` expects.
 *
 * Measured empirically with a ruler probe (`laya/dev/probe_hud.html`): the
 * engine draws the glyph box **downward from `y`**, i.e. `y` is the text's top
 * edge — not a canvas baseline and not a centre. The probe also confirmed that
 * offsetting by a fraction of the font size (either `size / 2` or `size * 0.8`)
 * pushes the glyphs up into the bar drawn beneath them, which is what produced
 * the clipped `YOU` / `RIVAL` in the battle HUD.
 *
 * The function is kept as a named seam so a future engine that does use
 * baselines only needs this one edit.
 */
function baselineOf(rowTop: number, _fontSize: number): number {
  return rowTop;
}

/**
 * Draws the full HUD into `g`, laid out inside the `(x, y, width, height)` box.
 * The box is the HUD strip below the playfield.
 */
export function drawHudBar(
  g: Laya.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: HudState,
): void {
  if (width <= 0 || height <= 0) {
    return;
  }

  // Backing panel.
  VectorPainter.roundedPanel(g, x, y, width, height, theme.RADIUS_SM, theme.COLOR_PANEL_DEEP, theme.COLOR_PANEL_BORDER, 1);

  const pad = theme.SPACE_SM;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = width - pad * 2;
  const panelW = Math.min((innerW - theme.SPACE_MD) * PANEL_WIDTH_RATIO, PANEL_WIDTH_MAX);

  // The centre badge borrows the vertical band the panels leave free, so the
  // footer strip below it stays clear for the connection / metrics line.
  const caption = theme.FONT_SIZE_CAPTION;
  const footerHeight = caption;
  const footerTop = y + height - pad - footerHeight;
  const badgeTop = innerY;
  const badgeHeight = Math.max(48, footerTop - theme.SPACE_SM - badgeTop);

  // --- local side (left) ---
  drawHpPanel(g, innerX, innerY, panelW, theme.COLOR_SUCCESS, 'YOU', opts.localHp, opts.bossMaxHp, opts.localHpRatio);

  // --- rival side (right) ---
  const rivalX = innerX + innerW - panelW;
  drawHpPanel(g, rivalX, innerY, panelW, theme.COLOR_DANGER, 'RIVAL', opts.rivalHp, opts.bossMaxHp, opts.rivalHpRatio);

  // --- damage readout: the row below the HP panels' value row ---
  // HP value row top = innerY + label + gap + bar + gap; its bottom adds one
  // caption line. DMG sits one `SPACE_XS` below that, under the panels where
  // it cannot collide with the centre badge.
  const valueRowTop = innerY + theme.FONT_SIZE_LABEL + theme.SPACE_XS + BAR_HEIGHT + theme.SPACE_XS;
  const dmgRowTop = valueRowTop + caption + theme.SPACE_XS;
  g.fillText(`DMG ${opts.damageDealt}`, innerX, baselineOf(dmgRowTop, caption), theme.font(caption), theme.COLOR_ACCENT);

  // --- centre status badge ---
  const badgeW = Math.max(60, innerW - panelW * 2 - theme.SPACE_MD * 2);
  const badgeX = innerX + panelW + theme.SPACE_MD;
  drawStatusBadge(g, badgeX, badgeTop, badgeW, badgeHeight, opts);

  // --- footer: connection (left) + metrics (right) ---
  const footerBaseline = baselineOf(footerTop, caption);
  g.fillText(`${opts.connectionLabel} · tick ${opts.tick}`, innerX, footerBaseline, theme.font(caption), theme.COLOR_HUD_DIM);
  if (opts.metricsLine !== '') {
    g.fillText(opts.metricsLine, x + width - pad, footerBaseline, theme.font(caption), theme.COLOR_HUD_DIM, 'right');
  }
}

/**
 * One HP panel: label row, bar row, `current/max` value row.
 *
 * `y` is the top of the label row; every subsequent row is stacked with
 * `SPACE_XS` between line boxes so nothing overlaps at small caption sizes.
 */
function drawHpPanel(
  g: Laya.Graphics,
  x: number,
  y: number,
  width: number,
  accent: string,
  label: string,
  current: number,
  max: number,
  ratio: number,
): void {
  const clamped = Math.max(0, Math.min(1, ratio));
  const labelSize = theme.FONT_SIZE_LABEL;
  const captionSize = theme.FONT_SIZE_CAPTION;

  // Row 1: label.
  g.fillText(label, x, baselineOf(y, labelSize), theme.font(labelSize, true), accent);

  // Row 2: bar track.
  const barY = y + labelSize + theme.SPACE_XS;
  const fill = clamped <= 0.3 ? theme.COLOR_HP_BAR_LOW : theme.COLOR_HP_BAR;
  VectorPainter.progressBar(g, x, barY, width, BAR_HEIGHT, clamped, fill);
  for (let i = 1; i < 4; i += 1) {
    const tx = x + (width * i) / 4;
    g.drawLine(tx, barY, tx, barY + BAR_HEIGHT, fade(theme.COLOR_VOID, 0.3), 1);
  }

  // Row 3: value.
  const valueTop = barY + BAR_HEIGHT + theme.SPACE_XS;
  g.fillText(`${current}/${max}`, x, baselineOf(valueTop, captionSize), theme.font(captionSize), theme.COLOR_HUD);
}

/**
 * Centre badge: match state, pattern id and bullet count.
 *
 * `y` / `height` describe the badge box; its three text rows are pinned to the
 * top, the middle and the bottom so the badge reads well at any height.
 */
function drawStatusBadge(g: Laya.Graphics, x: number, y: number, width: number, height: number, opts: HudState): void {
  if (width <= 0 || height <= 0) {
    return;
  }
  VectorPainter.roundedPanel(g, x, y, width, height, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);
  const cx = x + width / 2;

  // Top row: state.
  const stateSize = theme.FONT_SIZE_BODY;
  g.fillText(`◆ ${opts.stateName}`, cx, baselineOf(y + theme.SPACE_SM, stateSize), theme.font(stateSize, true), theme.COLOR_TITLE, 'center');

  // Middle row: pattern id, centred on the badge box.
  const captionSize = theme.FONT_SIZE_CAPTION;
  g.fillText(opts.patternId, cx, baselineOf(y + height / 2 - captionSize / 2, captionSize), theme.font(captionSize), theme.COLOR_INFO, 'center');

  // Bottom row: bullet count.
  const bulletsTop = y + height - theme.SPACE_SM - captionSize;
  g.fillText(`BULLETS ${opts.bullets}`, cx, baselineOf(bulletsTop, captionSize), theme.font(captionSize), theme.COLOR_HUD_DIM, 'center');
}

/**
 * Pure-text degradation of the HUD. Mirrors the previous four-line layout so
 * `BossRaceView.render(frame, hudLines)` can keep accepting string arrays.
 */
export function formatHudLines(state: HudState): string[] {
  return [
    `${state.connectionLabel} · tick ${state.tick} · ${state.stateName} · pattern ${state.patternId}`,
    `Boss HP ${state.localHp}/${state.bossMaxHp} · damage ${state.damageDealt} · rival HP ${state.rivalHp}`,
    `bullets ${state.bullets}`,
    state.metricsLine,
  ];
}
