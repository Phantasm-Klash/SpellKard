/**
 * Battle status bar rendering.
 *
 * Two entry points share one state shape:
 *
 *  - `drawHudBar` upgrades the old plain-text HUD into a structured status bar.
 *    Under the portrait layout it is a stage-wide band below the 3:2 playfield
 *    (`720x200`), laid out as **three columns**:
 *      left   — score + ultimate-cooldown meter
 *      centre — both Boss HP panels with the status badge between them
 *      right  — connection / tick and the reconciliation metrics
 *    Bars and rules are drawn with `Graphics`; only the numeric labels go
 *    through `fillText`.
 *  - `formatHudLines` is the pure-text fallback that reproduces the previous
 *    multi-line string HUD, so any caller still using the
 *    `render(frame, hudLines)` contract keeps working unchanged.
 *
 * Both are pure functions of `HudState` — no module-level state.
 *
 * Layout model: every `y` passed around this module is a **row top**. The
 * engine's `Graphics.fillText(text, x, y, ...)` treats `y` as the top edge of
 * the glyph box (measured with the `laya/dev/probe_hud.html` ruler probe), so
 * text is always emitted at `baselineOf(rowTop, fontSize)` — currently the
 * identity, but kept as the one seam a future engine would need to change. One
 * model everywhere is what keeps the label / bar / value rows from drifting
 * into each other.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`.
 */

import { formatMatchCountdown } from '../../../core/game/match_clock';
import { BOSS_RACE_TICK_RATE_HZ } from '../../../core/sim/boss_race';
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
  /**
   * Match tick limit, used for the countdown. `0` (the default) hides the
   * countdown — callers that do not know the server's `--max-ticks` leave it
   * unset rather than guessing.
   */
  tickLimit?: number;
  /** Tick rate, needed to render the countdown as a clock. Defaults to 60. */
  tickRateHz?: number;
  /**
   * Score shown in the left column. Optional: when absent the bar falls back to
   * `damageDealt`, so a caller that never sets a score still gets a number.
   */
  score?: number;
  /**
   * Ultimate cooldown fraction, 0..1 — `0` = ready, `1` = just fired. Optional:
   * when absent (or non-finite) the ULT block is skipped entirely rather than
   * drawn with a made-up level.
   */
  ultCooldownRatio?: number;
  /**
   * Explicit ready flag for the ULT meter. Optional; when absent it is derived
   * from `ultCooldownRatio <= 0`.
   */
  ultReady?: boolean;
}

/** Height of an HP bar track. */
const BAR_HEIGHT = 10;
/** Height of the ULT cooldown meter in the left column. */
const ULT_BAR_HEIGHT = 12;
/**
 * Side-column width. The status bar is stage-wide (720 px) and roomy, so the
 * left "score / ultimate" column and the right "link / sync" column each take a
 * fixed share; the centre HP block then gets the remainder — and because the
 * side columns are narrower than a third, the boss HP panels stay comfortably
 * wide. Clamped so a narrow bar still leaves the centre at least half.
 */
const SIDE_COLUMN_WIDTH = 152;
/** Horizontal gutter between the three status-bar columns. */
const COLUMN_GAP = theme.SPACE_LG;
/** Vertical row pitch inside a column (line height + one `SPACE_XS`). */
const ROW_PITCH = theme.SPACE_SM;
/**
 * Converts a row top into the `y` that `Graphics.fillText` expects.
 *
 * Measured empirically with a ruler probe (`laya/dev/probe_hud.html`): the
 * engine draws the glyph box **downward from `y`**, i.e. `y` is the text's top
 * edge — not a canvas baseline and not a centre. The probe also confirmed that
 * offsetting by a fraction of the font size (either `size / 2` or `size * 0.8`)
 * pushes the glyphs up into the bar drawn beneath them, which is what produced
 * the clipped `YOU` / `RIVAL` in the old battle HUD.
 *
 * The function is kept as a named seam so a future engine that does use
 * baselines only needs this one edit.
 */
function baselineOf(rowTop: number, _fontSize: number): number {
  return rowTop;
}

/** Structure of the status bar: side padding, panel inset and centre widths. */
interface HudLayout {
  pad: number;
  innerX: number;
  innerY: number;
  innerW: number;
  innerH: number;
  leftX: number;
  leftW: number;
  centerX: number;
  centerW: number;
  rightX: number;
  rightW: number;
}

function measureHud(x: number, y: number, width: number, height: number): HudLayout {
  const pad = theme.SPACE_SM;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  // The side columns are fixed and clamped so a narrow bar still leaves the
  // centre at least half the remaining width.
  const leftW = Math.min(SIDE_COLUMN_WIDTH, Math.max(0, (innerW - COLUMN_GAP * 2) * 0.28));
  const rightW = leftW;
  const centerW = Math.max(0, innerW - leftW * 2 - COLUMN_GAP * 2);
  return {
    pad,
    innerX,
    innerY,
    innerW,
    innerH,
    leftX: innerX,
    leftW,
    centerX: innerX + leftW + COLUMN_GAP,
    centerW,
    rightX: innerX + innerW - rightW,
    rightW,
  };
}

/**
 * Draws the full status bar into `g`, laid out inside the `(x, y, width,
 * height)` box — the band under the playfield.
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

  const layout = measureHud(x, y, width, height);

  // --- left column: score + ultimate cooldown ---
  drawScorePanel(g, layout, opts);
  drawUltPanel(g, layout, opts);

  // --- centre column: YOU / RIVAL HP panels with the status badge between ---
  drawCenterColumn(g, layout, opts);

  // --- right column: connection, tick and reconciliation metrics ---
  drawInfoColumn(g, layout, opts);

  // Hairline rules between the columns so the three zones read as separate.
  const ruleTop = y + layout.pad;
  const ruleBottom = y + height - layout.pad;
  g.drawLine(layout.centerX - COLUMN_GAP / 2, ruleTop, layout.centerX - COLUMN_GAP / 2, ruleBottom, fade(theme.COLOR_DIVIDER, 0.35), 1);
  g.drawLine(layout.rightX - COLUMN_GAP / 2, ruleTop, layout.rightX - COLUMN_GAP / 2, ruleBottom, fade(theme.COLOR_DIVIDER, 0.35), 1);
}

/**
 * Left column, top half: the running score.
 *
 * `opts.score` is preferred but optional, so callers that only have
 * `damageDealt` (the whole HUD before this change) still show a number.
 */
function drawScorePanel(g: Laya.Graphics, layout: HudLayout, opts: HudState): void {
  const score = opts.score ?? opts.damageDealt;
  VectorPainter.roundedPanel(
    g,
    layout.leftX,
    layout.innerY,
    layout.leftW,
    layout.innerH / 2 - theme.SPACE_SM / 2,
    theme.RADIUS_SM,
    theme.COLOR_PANEL,
    theme.COLOR_PANEL_BORDER,
    1,
  );
  const size = theme.FONT_SIZE_CAPTION;
  g.fillText('SCORE', layout.leftX + theme.SPACE_SM, baselineOf(layout.innerY + theme.SPACE_SM, size), theme.font(size, true), theme.COLOR_TEXT_MUTED);
  g.fillText(
    String(score),
    layout.leftX + layout.leftW - theme.SPACE_SM,
    baselineOf(layout.innerY + theme.SPACE_SM + size + theme.SPACE_XS, theme.FONT_SIZE_HEADING),
    theme.font(theme.FONT_SIZE_HEADING, true),
    theme.COLOR_ACCENT,
    'right',
  );
}

/**
 * Left column, bottom half: the ultimate-cooldown meter.
 *
 * Graceful degradation: when `ultCooldownRatio` is absent or not finite the
 * whole block is skipped, so a caller with no ultimate ability yet gets a clean
 * gap rather than a stale bar.
 */
function drawUltPanel(g: Laya.Graphics, layout: HudLayout, opts: HudState): void {
  const ratio = opts.ultCooldownRatio;
  if (ratio === undefined || !Number.isFinite(ratio)) {
    return;
  }
  const clamped = Math.max(0, Math.min(1, ratio));
  const ready = opts.ultReady ?? clamped <= 0;
  const panelH = layout.innerH / 2 - theme.SPACE_SM / 2;
  const panelY = layout.innerY + layout.innerH / 2 + theme.SPACE_SM / 2;
  VectorPainter.roundedPanel(g, layout.leftX, panelY, layout.leftW, panelH, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);

  const size = theme.FONT_SIZE_CAPTION;
  const label = ready ? 'ULT READY' : 'ULT';
  g.fillText(label, layout.leftX + theme.SPACE_SM, baselineOf(panelY + theme.SPACE_SM, size), theme.font(size, true), ready ? theme.COLOR_SUCCESS : theme.COLOR_TEXT_MUTED);
  if (!ready) {
    const pct = `${Math.round((1 - clamped) * 100)}%`;
    g.fillText(pct, layout.leftX + layout.leftW - theme.SPACE_SM, baselineOf(panelY + theme.SPACE_SM, size), theme.font(size), theme.COLOR_INFO, 'right');
  }

  // The bar fills with "charge remaining": full track = just fired.
  const barY = panelY + theme.SPACE_SM + size + theme.SPACE_XS;
  const barW = layout.leftW - theme.SPACE_SM * 2;
  VectorPainter.progressBar(g, layout.leftX + theme.SPACE_SM, barY, barW, ULT_BAR_HEIGHT, 1 - clamped, ready ? theme.COLOR_ACCENT : theme.COLOR_INFO);
}

/** Centre column: the two HP panels plus the badge wedged between them. */
function drawCenterColumn(g: Laya.Graphics, layout: HudLayout, opts: HudState): void {
  const panelW = Math.min(layout.centerW * 0.28, 200);
  const badgeW = Math.max(0, layout.centerW - panelW * 2 - theme.SPACE_MD * 2);

  drawHpPanel(g, layout.centerX, layout.innerY, panelW, theme.COLOR_SUCCESS, 'YOU', opts.localHp, opts.bossMaxHp, opts.localHpRatio);
  drawHpPanel(g, layout.centerX + layout.centerW - panelW, layout.innerY, panelW, theme.COLOR_DANGER, 'RIVAL', opts.rivalHp, opts.bossMaxHp, opts.rivalHpRatio);

  if (badgeW > 0) {
    drawStatusBadge(g, layout.centerX + panelW + theme.SPACE_MD, layout.innerY + theme.SPACE_SM, badgeW, layout.innerH - theme.SPACE_SM * 2, opts);
  }

  // Damage readout under the local panel, where it cannot collide with the badge.
  const caption = theme.FONT_SIZE_CAPTION;
  const valueRowTop = layout.innerY + theme.FONT_SIZE_LABEL + theme.SPACE_XS + BAR_HEIGHT + theme.SPACE_XS;
  g.fillText(`DMG ${opts.damageDealt}`, layout.centerX, baselineOf(valueRowTop + caption + theme.SPACE_XS, caption), theme.font(caption), theme.COLOR_ACCENT);
}

/** Right column: connection / tick caption plus the metrics footer. */
function drawInfoColumn(g: Laya.Graphics, layout: HudLayout, opts: HudState): void {
  if (layout.rightW <= 0) {
    return;
  }
  const caption = theme.FONT_SIZE_CAPTION;
  let rowTop = layout.innerY + theme.SPACE_XS;
  g.fillText('LINK', layout.rightX, baselineOf(rowTop, caption), theme.font(caption, true), theme.COLOR_TEXT_MUTED);
  rowTop += caption + ROW_PITCH;
  g.fillText(opts.connectionLabel, layout.rightX, baselineOf(rowTop, caption), theme.font(theme.FONT_SIZE_LABEL, true), opts.connectionLabel === 'server' ? theme.COLOR_SUCCESS : theme.COLOR_WARNING);
  rowTop += theme.FONT_SIZE_LABEL + ROW_PITCH;
  g.fillText(`tick ${opts.tick}`, layout.rightX, baselineOf(rowTop, caption), theme.font(caption), theme.COLOR_HUD_DIM);
  rowTop += caption + theme.SPACE_MD;

  g.fillText('SYNC', layout.rightX, baselineOf(rowTop, caption), theme.font(caption, true), theme.COLOR_TEXT_MUTED);
  rowTop += caption + theme.SPACE_XS;
  if (opts.metricsLine !== '') {
    // The metrics line is long on purpose (it is the network-health summary);
    // wrap it to the column width by splitting on the `·` separators.
    for (const segment of wrapSegments(opts.metricsLine, layout.rightW)) {
      g.fillText(segment, layout.rightX, baselineOf(rowTop, caption), theme.font(caption), theme.COLOR_HUD_DIM);
      rowTop += caption + theme.SPACE_XS;
    }
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
  if (width <= 0) {
    return;
  }
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
 * Centre badge: match state, countdown, pattern id and bullet count, with a
 * race bar pinned to the bottom edge.
 *
 * `y` / `height` describe the badge box. Rows are stacked top-down, then the
 * whole block is centred in the badge; the race bar sits on the bottom inner
 * edge above the footer. A short badge drops the race bar rather than
 * overflowing.
 */
function drawStatusBadge(g: Laya.Graphics, x: number, y: number, width: number, height: number, opts: HudState): void {
  if (width <= 0 || height <= 0) {
    return;
  }
  VectorPainter.roundedPanel(g, x, y, width, height, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);
  const cx = x + width / 2;
  const captionSize = theme.FONT_SIZE_CAPTION;
  const stateSize = theme.FONT_SIZE_BODY;
  const raceBarHeight = theme.SPACE_XS;

  const rows = [stateSize, captionSize, captionSize];
  const blockHeight = rows.reduce((sum, size) => sum + size, 0) + theme.SPACE_XS * 2 + theme.SPACE_SM + raceBarHeight;
  let cursor = y + Math.max(theme.SPACE_SM, (height - blockHeight) / 2);

  // Row 1: state, with the countdown right-aligned beside it when known.
  const countdown = formatCountdown(opts);
  if (countdown === '') {
    g.fillText(`◆ ${opts.stateName}`, cx, baselineOf(cursor, stateSize), theme.font(stateSize, true), theme.COLOR_TITLE, 'center');
  } else {
    g.fillText(`◆ ${opts.stateName}`, cx - theme.SPACE_MD, baselineOf(cursor, stateSize), theme.font(stateSize, true), theme.COLOR_TITLE, 'center');
    g.fillText(countdown, x + width - theme.SPACE_SM, baselineOf(cursor + (stateSize - captionSize), captionSize), theme.font(captionSize, true), theme.COLOR_INFO, 'right');
  }
  cursor += stateSize + theme.SPACE_XS;

  // Row 2: active pattern id.
  g.fillText(opts.patternId, cx, baselineOf(cursor, captionSize), theme.font(captionSize), theme.COLOR_INFO, 'center');
  cursor += captionSize + theme.SPACE_XS;

  // Row 3: bullets in flight.
  g.fillText(`BULLETS ${opts.bullets}`, cx, baselineOf(cursor, captionSize), theme.font(captionSize), theme.COLOR_HUD_DIM, 'center');
  cursor += captionSize + theme.SPACE_SM;

  // Row 4: two-sided race bar.
  const raceBarWidth = width - theme.SPACE_MD * 2;
  if (raceBarWidth > 0 && cursor + raceBarHeight <= y + height) {
    drawRaceBar(g, x + theme.SPACE_MD, cursor, raceBarWidth, raceBarHeight, opts);
  }
}

/**
 * Two-sided HP bar: local Boss HP fills from the left, rival HP from the right,
 * meeting where their remaining totals are equal. The longer side is simply the
 * player closer to winning, which reads faster than two separate bars.
 */
function drawRaceBar(
  g: Laya.Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  opts: HudState,
): void {
  const local = Math.max(0, Math.min(1, opts.localHpRatio));
  const rival = Math.max(0, Math.min(1, opts.rivalHpRatio));
  const total = local + rival;
  // With both Bosses at full HP the split is even; as the rival drops, the
  // local share grows.
  const localShare = total <= 0 ? 0.5 : local / total;

  g.drawRect(x, y, width, height, theme.COLOR_HP_BACK, null);
  const split = Math.round(width * localShare);
  g.drawRect(x, y, split, height, theme.COLOR_SUCCESS, null);
  g.drawRect(x + split, y, width - split, height, theme.COLOR_DANGER, null);
  // Centre marker so the even split is visible at a glance.
  const mid = x + Math.round(width / 2);
  g.drawLine(mid, y - 2, mid, y + height + 2, fade(theme.COLOR_VOID, 0.5), 1);
}

/**
 * Greedy word-wrap for the metrics line, split on the `·` separators the line
 * already uses. The right column is narrow, so an unwrapped line would run off
 * the bar.
 */
function wrapSegments(line: string, maxWidth: number): string[] {
  const parts = line.split(' · ');
  const rows: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current === '' ? part : `${current} · ${part}`;
    if (current !== '' && candidate.length * theme.FONT_SIZE_CAPTION * 0.55 > maxWidth) {
      rows.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current !== '') {
    rows.push(current);
  }
  return rows;
}

/**
 * Renders the remaining match time, or `''` when the caller did not supply a
 * tick limit (`0` means "unknown"). The formatting itself lives in `core/` so
 * it is unit-tested without a rendering engine; see `game/match_clock`.
 */
function formatCountdown(opts: HudState): string {
  return formatMatchCountdown(opts.tick, opts.tickLimit ?? 0, opts.tickRateHz ?? BOSS_RACE_TICK_RATE_HZ);
}

/**
 * Pure-text degradation of the HUD. Mirrors the previous four-line layout so
 * `BossRaceView.render(frame, hudLines)` can keep accepting string arrays.
 */
export function formatHudLines(state: HudState): string[] {
  const countdown = formatCountdown(state);
  const rows = [
    `${state.connectionLabel} · tick ${state.tick}${countdown === '' ? '' : ` · ${countdown}`} · ${state.stateName} · pattern ${state.patternId}`,
    `Boss HP ${state.localHp}/${state.bossMaxHp} · damage ${state.damageDealt} · rival HP ${state.rivalHp}`,
    `bullets ${state.bullets}`,
    state.metricsLine,
  ];
  // Optional rows, prepended in reverse so the score line stays on top: the
  // text fallback must degrade the same way `drawHudBar` does — skip the row
  // entirely when the value is absent rather than printing a made-up one.
  const ult = state.ultCooldownRatio;
  if (ult !== undefined && Number.isFinite(ult)) {
    const clamped = Math.max(0, Math.min(1, ult));
    const ready = state.ultReady ?? clamped <= 0;
    rows.unshift(`ult ${ready ? 'READY' : `${Math.round((1 - clamped) * 100)}%`}`);
  }
  if (state.score !== undefined) {
    rows.unshift(`score ${state.score}`);
  }
  return rows;
}
