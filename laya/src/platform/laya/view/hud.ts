/**
 * Battle status panel rendering.
 *
 * Two entry points share one state shape:
 *
 *  - `drawHudBar` upgrades the old plain-text HUD into a structured status
 *    panel. It is a **vertical side panel to the right of the playfield**
 *    (narrow strip, full stage height), stacked top-to-bottom as rows of
 *    cards:
 *      title   — SCORE (large value) + the ULT cooldown meter
 *      HP      — YOU / RIVAL boss HP panels with the value readouts
 *      status  — match state, countdown, pattern and bullet count, race bar
 *      link    — connection / tick and the reconciliation metrics footer
 *    The panel is a single column, so every row is full panel width and the
 *    cards simply stack; the row pitch is derived from the available height so
 *    the stack fills the strip without overlap.
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
/** Height of the ULT cooldown meter in the panel. */
const ULT_BAR_HEIGHT = 12;
/**
 * Vertical gap bounds between stacked cards in the side panel. The gap starts
 * at the minimum and absorbs any slack the flex growth does not take.
 */
const PANEL_GAP_MIN = theme.SPACE_MD;
/**
 * Upper bound on how much a single card may grow to fill the strip. Cards grow
 * together, so this keeps a tall strip from turning one card into a hollow box.
 */
const MAX_CARD_GROWTH = 140;
/**
 * Fixed gap *inside* a composite card (between the two HP panels and between an
 * HP panel and its DMG readout). This one does not flex — it is part of the
 * card's own measured height.
 */
const CARD_INNER_GAP = theme.SPACE_SM;
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

/** Structure of the side panel: outer padding, the usable inner box, and scale. */
interface HudLayout {
  pad: number;
  /** Inner left edge (x of every card). */
  innerX: number;
  /** Inner top edge (y of the first card). */
  innerY: number;
  /** Width shared by every card. */
  innerW: number;
  /** Total vertical space the cards must fit in. */
  innerH: number;
  /**
   * Content scale for the panel. The strip is a full stage tall, so at 1x the
   * cards would be a short cluster with a large void beneath; scaling the type
   * and bars up makes the panel fill the height with legible content instead of
   * stretching hollow boxes. Clamped so a very tall or very short strip still
   * looks sane.
   */
  scale: number;
}

/**
 * Reference panel height at which the content sits at its natural size. The
 * scale is derived from the actual height over this, so the same code adapts
 * from a compact strip to a full-height one.
 */
const HUD_REFERENCE_HEIGHT = 720;
const HUD_MIN_SCALE = 1;
const HUD_MAX_SCALE = 1.8;

function measureHud(x: number, y: number, width: number, height: number): HudLayout {
  const pad = theme.SPACE_SM;
  const scale = Math.max(HUD_MIN_SCALE, Math.min(HUD_MAX_SCALE, height / HUD_REFERENCE_HEIGHT));
  return {
    pad,
    innerX: x + pad,
    innerY: y + pad,
    innerW: Math.max(0, width - pad * 2),
    innerH: Math.max(0, height - pad * 2),
    scale,
  };
}

/** Scales a base font size by the panel's content scale. */
function fs(layout: HudLayout, base: number): number {
  return Math.round(base * layout.scale);
}

/**
 * Draws the full status panel into `g`, filling the `(x, y, width, height)`
 * box — the vertical strip to the right of the playfield.
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

  // The strip is tall (a full stage height) while the cards' natural content is
  // short, so the stack would leave a dead zone beneath. Instead of leaving it
  // empty, hand the slack back to the cards: each grows by an equal share and
  // centres its content, so the panel fills top-to-bottom. The per-card growth
  // is capped so a very tall strip does not stretch a card into a hollow box.
  //
  // The footer height is measured from its actual rows (the metrics line wraps
  // to a variable number of rows), not a fixed guess — otherwise a long metrics
  // line pushes the footer up into the last card.
  const footerH = infoFooterHeight(layout, opts);
  const present = (['score', 'ult', 'hp', 'status'] as const).filter(
    (kind) => cardHeight(kind, layout, opts) > 0,
  );
  const natural = present.reduce((sum, kind) => sum + cardHeight(kind, layout, opts), 0);
  const gaps = Math.max(1, present.length - 1);
  const slack = Math.max(0, layout.innerH - natural - footerH - PANEL_GAP_MIN * (gaps + 1));
  const growth = Math.min(MAX_CARD_GROWTH, slack / present.length);
  const gap = PANEL_GAP_MIN + Math.max(0, (slack - growth * present.length) / gaps);

  const h = (kind: 'score' | 'ult' | 'hp' | 'status'): number =>
    cardHeight(kind, layout, opts) > 0 ? cardHeight(kind, layout, opts) + growth : 0;

  let cursor = layout.innerY;
  cursor += drawScoreCard(g, layout, cursor, h('score'), opts) + gap;
  cursor += drawUltCard(g, layout, cursor, h('ult'), opts) + gap;
  cursor += drawHpStack(g, layout, cursor, h('hp'), opts) + gap;
  drawStatusCard(g, layout, cursor, h('status'), opts);
  drawInfoFooter(g, layout, opts);
}

/** A card's natural (un-grown) height at the panel's current scale. */
function cardHeight(kind: 'score' | 'ult' | 'hp' | 'status', layout: HudLayout, opts: HudState): number {
  const s = layout.scale;
  switch (kind) {
    case 'score':
      return (theme.SPACE_SM + theme.FONT_SIZE_CAPTION + theme.SPACE_XS + theme.FONT_SIZE_HEADING + theme.SPACE_SM) * s;
    case 'ult':
      if (!hasUlt(opts)) {
        return 0;
      }
      return (theme.SPACE_SM + theme.FONT_SIZE_CAPTION + theme.SPACE_XS + ULT_BAR_HEIGHT + theme.SPACE_SM) * s;
    case 'hp':
      // Two HP panels (local + rival), the inner gap, and the DMG readout row.
      return hpPanelHeight(layout) * 2 + CARD_INNER_GAP + theme.SPACE_XS + fs(layout, theme.FONT_SIZE_CAPTION) + theme.SPACE_SM * 2;
    case 'status':
      return statusCardHeight(layout);
  }
}

function hasUlt(opts: HudState): boolean {
  return opts.ultCooldownRatio !== undefined && Number.isFinite(opts.ultCooldownRatio);
}

function hpPanelHeight(layout: HudLayout): number {
  return fs(layout, theme.FONT_SIZE_LABEL) + theme.SPACE_XS + Math.round(BAR_HEIGHT * layout.scale) + theme.SPACE_XS + fs(layout, theme.FONT_SIZE_CAPTION);
}

/**
 * Score card (top of the panel): the running score as a large value.
 *
 * `opts.score` is preferred but optional, so callers that only have
 * `damageDealt` (the whole HUD before this change) still show a number.
 */
function drawScoreCard(g: Laya.Graphics, layout: HudLayout, y: number, h: number, opts: HudState): number {
  if (h <= 0) {
    return 0;
  }
  const score = opts.score ?? opts.damageDealt;
  VectorPainter.roundedPanel(g, layout.innerX, y, layout.innerW, h, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);

  const captionSize = fs(layout, theme.FONT_SIZE_CAPTION);
  const valueSize = fs(layout, theme.FONT_SIZE_HEADING);
  // Centre the label + value pair in the (possibly grown) card.
  const contentH = captionSize + theme.SPACE_XS + valueSize;
  const top = y + Math.max(theme.SPACE_SM, (h - contentH) / 2);
  g.fillText('SCORE', layout.innerX + theme.SPACE_SM, baselineOf(top, captionSize), theme.font(captionSize, true), theme.COLOR_TEXT_MUTED);
  g.fillText(
    String(score),
    layout.innerX + layout.innerW - theme.SPACE_SM,
    baselineOf(top + captionSize + theme.SPACE_XS, valueSize),
    theme.font(valueSize, true),
    theme.COLOR_ACCENT,
    'right',
  );
  return h;
}

/**
 * Ultimate-cooldown card.
 *
 * Graceful degradation: when `ultCooldownRatio` is absent or not finite the
 * whole card is skipped, so a caller with no ultimate ability yet gets no gap.
 */
function drawUltCard(g: Laya.Graphics, layout: HudLayout, y: number, h: number, opts: HudState): number {
  if (h <= 0 || !hasUlt(opts)) {
    return 0;
  }
  const clamped = Math.max(0, Math.min(1, opts.ultCooldownRatio as number));
  const ready = opts.ultReady ?? clamped <= 0;
  VectorPainter.roundedPanel(g, layout.innerX, y, layout.innerW, h, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);

  const size = fs(layout, theme.FONT_SIZE_CAPTION);
  const barH = Math.round(ULT_BAR_HEIGHT * layout.scale);
  const contentH = size + theme.SPACE_XS + barH;
  const top = y + Math.max(theme.SPACE_SM, (h - contentH) / 2);
  const label = ready ? 'ULT READY' : 'ULT';
  g.fillText(label, layout.innerX + theme.SPACE_SM, baselineOf(top, size), theme.font(size, true), ready ? theme.COLOR_SUCCESS : theme.COLOR_TEXT_MUTED);
  if (!ready) {
    const pct = `${Math.round((1 - clamped) * 100)}%`;
    g.fillText(pct, layout.innerX + layout.innerW - theme.SPACE_SM, baselineOf(top, size), theme.font(size), theme.COLOR_INFO, 'right');
  }

  // The bar fills with "charge remaining": full track = just fired.
  const barY = top + size + theme.SPACE_XS;
  const barW = layout.innerW - theme.SPACE_SM * 2;
  VectorPainter.progressBar(g, layout.innerX + theme.SPACE_SM, barY, barW, barH, 1 - clamped, ready ? theme.COLOR_ACCENT : theme.COLOR_INFO);
  return h;
}

/** Both Boss HP panels, stacked (local above rival), then the DMG readout. */
function drawHpStack(g: Laya.Graphics, layout: HudLayout, y: number, h: number, opts: HudState): number {
  if (h <= 0) {
    return 0;
  }
  VectorPainter.roundedPanel(g, layout.innerX, y, layout.innerW, h, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);

  const insetX = layout.innerX + theme.SPACE_SM;
  const insetW = layout.innerW - theme.SPACE_SM * 2;
  // Two HP panels plus the DMG readout, centred in the (possibly grown) card.
  const panelH = hpPanelHeight(layout);
  const caption = fs(layout, theme.FONT_SIZE_CAPTION);
  const contentH = panelH * 2 + CARD_INNER_GAP + theme.SPACE_XS + caption;
  const top = y + Math.max(theme.SPACE_SM, (h - contentH) / 2);

  drawHpPanel(g, layout, insetX, top, insetW, theme.COLOR_SUCCESS, 'YOU', opts.localHp, opts.bossMaxHp, opts.localHpRatio);
  drawHpPanel(g, layout, insetX, top + panelH + CARD_INNER_GAP, insetW, theme.COLOR_DANGER, 'RIVAL', opts.rivalHp, opts.bossMaxHp, opts.rivalHpRatio);

  // Damage readout under the rival panel, right-aligned so it reads as a score.
  const dmgRowTop = top + panelH * 2 + CARD_INNER_GAP + theme.SPACE_XS;
  g.fillText(`DMG ${opts.damageDealt}`, layout.innerX + layout.innerW - theme.SPACE_SM, baselineOf(dmgRowTop, caption), theme.font(caption), theme.COLOR_ACCENT, 'right');
  return h;
}

/** Height of the status card: state row, pattern, bullets, race bar. */
function statusCardHeight(layout: HudLayout): number {
  const stateSize = fs(layout, theme.FONT_SIZE_BODY);
  const captionSize = fs(layout, theme.FONT_SIZE_CAPTION);
  const raceBarHeight = Math.round(theme.SPACE_XS * layout.scale);
  // state + (countdown shares the row) + pattern + bullets + race bar
  return theme.SPACE_SM + stateSize + theme.SPACE_XS + captionSize + theme.SPACE_XS + captionSize + theme.SPACE_SM + raceBarHeight + theme.SPACE_SM;
}

/**
 * Status card: match state, countdown, pattern id and bullet count, with a
 * two-sided race bar pinned to the bottom inner edge.
 */
function drawStatusCard(g: Laya.Graphics, layout: HudLayout, y: number, h: number, opts: HudState): number {
  if (h <= 0) {
    return 0;
  }
  VectorPainter.roundedPanel(g, layout.innerX, y, layout.innerW, h, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);

  const captionSize = fs(layout, theme.FONT_SIZE_CAPTION);
  const stateSize = fs(layout, theme.FONT_SIZE_BODY);
  const raceBarHeight = Math.round(theme.SPACE_XS * layout.scale);
  const cx = layout.innerX + layout.innerW / 2;
  // Centre the text block; the race bar is pinned to the bottom inner edge.
  const textH = stateSize + theme.SPACE_XS + captionSize + theme.SPACE_XS + captionSize;
  let cursor = y + Math.max(theme.SPACE_SM, (h - textH - theme.SPACE_SM - raceBarHeight) / 2);

  // Row 1: state (with the countdown pinned to the right when known).
  const countdown = formatCountdown(opts);
  if (countdown === '') {
    g.fillText(`◆ ${opts.stateName}`, cx, baselineOf(cursor, stateSize), theme.font(stateSize, true), theme.COLOR_TITLE, 'center');
  } else {
    g.fillText(`◆ ${opts.stateName}`, layout.innerX + theme.SPACE_SM, baselineOf(cursor, stateSize), theme.font(stateSize, true), theme.COLOR_TITLE);
    g.fillText(countdown, layout.innerX + layout.innerW - theme.SPACE_SM, baselineOf(cursor + (stateSize - captionSize), captionSize), theme.font(captionSize, true), theme.COLOR_INFO, 'right');
  }
  cursor += stateSize + theme.SPACE_XS;

  // Row 2: active pattern id.
  g.fillText(opts.patternId, cx, baselineOf(cursor, captionSize), theme.font(captionSize), theme.COLOR_INFO, 'center');
  cursor += captionSize + theme.SPACE_XS;

  // Row 3: bullets in flight.
  g.fillText(`BULLETS ${opts.bullets}`, cx, baselineOf(cursor, captionSize), theme.font(captionSize), theme.COLOR_HUD_DIM, 'center');

  // Row 4: two-sided race bar, pinned near the bottom inner edge.
  const raceBarWidth = layout.innerW - theme.SPACE_MD * 2;
  const raceBarY = y + h - theme.SPACE_SM - raceBarHeight;
  if (raceBarWidth > 0 && raceBarY > cursor + captionSize) {
    drawRaceBar(g, layout.innerX + theme.SPACE_MD, raceBarY, raceBarWidth, raceBarHeight, opts);
  }
  return h;
}

/** The footer's rows, shared by its height measurement and its drawing. */
function infoFooterRows(layout: HudLayout, opts: HudState): string[] {
  const caption = fs(layout, theme.FONT_SIZE_CAPTION);
  const rows: string[] = [`LINK ${opts.connectionLabel} · tick ${opts.tick}`];
  if (opts.metricsLine !== '') {
    rows.push(...wrapSegments(`SYNC ${opts.metricsLine}`, layout.innerW - theme.SPACE_SM * 2, caption));
  }
  return rows;
}

/** Exact height the footer will occupy, so the cards can reserve it. */
function infoFooterHeight(layout: HudLayout, opts: HudState): number {
  const rowH = fs(layout, theme.FONT_SIZE_CAPTION) + theme.SPACE_XS;
  return infoFooterRows(layout, opts).length * rowH;
}

/** Connection / tick caption plus the metrics footer, pinned to the bottom. */
function drawInfoFooter(g: Laya.Graphics, layout: HudLayout, opts: HudState): void {
  const caption = fs(layout, theme.FONT_SIZE_CAPTION);
  const rows = infoFooterRows(layout, opts);
  // Measure bottom-up so the block hugs the bottom edge of the strip.
  let cursor = layout.innerY + layout.innerH - rows.length * (caption + theme.SPACE_XS);
  for (const row of rows) {
    g.fillText(row, layout.innerX, baselineOf(cursor, caption), theme.font(caption), theme.COLOR_HUD_DIM);
    cursor += caption + theme.SPACE_XS;
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
  layout: HudLayout,
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
  const labelSize = fs(layout, theme.FONT_SIZE_LABEL);
  const captionSize = fs(layout, theme.FONT_SIZE_CAPTION);
  const barH = Math.round(BAR_HEIGHT * layout.scale);

  // Row 1: label.
  g.fillText(label, x, baselineOf(y, labelSize), theme.font(labelSize, true), accent);

  // Row 2: bar track.
  const barY = y + labelSize + theme.SPACE_XS;
  const fill = clamped <= 0.3 ? theme.COLOR_HP_BAR_LOW : theme.COLOR_HP_BAR;
  VectorPainter.progressBar(g, x, barY, width, barH, clamped, fill);
  for (let i = 1; i < 4; i += 1) {
    const tx = x + (width * i) / 4;
    g.drawLine(tx, barY, tx, barY + barH, fade(theme.COLOR_VOID, 0.3), 1);
  }

  // Row 3: value.
  const valueTop = barY + BAR_HEIGHT + theme.SPACE_XS;
  g.fillText(`${current}/${max}`, x, baselineOf(valueTop, captionSize), theme.font(captionSize), theme.COLOR_HUD);
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
 * already uses. The panel is narrow, so an unwrapped line would run off the
 * strip. `fontSize` is the size the row will actually be drawn at, so the
 * character-width estimate stays honest as the panel scales.
 */
function wrapSegments(line: string, maxWidth: number, fontSize: number): string[] {
  const parts = line.split(' · ');
  const rows: string[] = [];
  let current = '';
  for (const part of parts) {
    const candidate = current === '' ? part : `${current} · ${part}`;
    if (current !== '' && candidate.length * fontSize * 0.55 > maxWidth) {
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
