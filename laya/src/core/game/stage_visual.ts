/**
 * Pure, engine-agnostic derivations shared by the performance overlays: the
 * scrolling/scaling stage background, the watermark portraits and the
 * stage-entrance cutscene.
 *
 * Everything here is a function of the tuning numbers in `tna_stage_tuning.ts`
 * and of elapsed time — no Laya, no DOM, no RNG — so the tiling geometry, the
 * breathe curves and the cutscene step→visual table can be unit tested without
 * a runtime. The Laya layers own only the sprite plumbing and call into these.
 *
 * All trigonometry goes through `core/math/float_lib` (`sinDeg`), so the
 * performance layer keeps a single source of arithmetic and adds no second
 * implementation.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import { fmod, sinDeg } from '../math/float_lib';
import type { CutsceneStep } from './cutscene_sequence';
import { DEFAULT_CUTSCENE_TUNING, type CutsceneTuning } from './tna_stage_tuning';

/**
 * Wraps `offset` into `[0, tileSize)`.
 *
 * Uses `fmod` (the float-lib helper, C `std::fmod` semantics) rather than
 * `Math.floor`-mod so a negative offset — which a caller could hand in — still
 * lands in `[0, tileSize)`. A non-finite or non-positive `tileSize` has no
 * meaningful wrap, so it yields `0`.
 */
export function wrapOffset(offset: number, tileSize: number): number {
  if (!Number.isFinite(tileSize) || tileSize <= 0 || !Number.isFinite(offset)) {
    return 0;
  }
  const wrapped = fmod(offset, tileSize);
  return wrapped < 0 ? wrapped + tileSize : wrapped;
}

/**
 * Advances a scroll offset by `pxPerSecond` over `dtMs` milliseconds:
 * `offset + pxPerSecond * dtMs / 1000`. The offset is left unbounded; callers
 * wrap it with {@link wrapOffset} at positioning time. Non-finite inputs leave
 * the offset unchanged (a paused frame or a garbage delta must not poison it).
 */
export function advanceOffset(offset: number, pxPerSecond: number, dtMs: number): number {
  const base = Number.isFinite(offset) ? offset : 0;
  if (!Number.isFinite(pxPerSecond) || !Number.isFinite(dtMs)) {
    return base;
  }
  return base + (pxPerSecond * dtMs) / 1000;
}

/**
 * Tiles needed to cover `span` at `tileSize`, **plus one** so that a partial
 * wrap (the grid is shifted by up to one tile) still reaches the far edge.
 *
 * `coverage` widens the covered area by a factor, used when the layer is scaled
 * below 1 (a `0.9` breathe must still cover the whole stage); it defaults to 1.
 */
export function tileCount(span: number, tileSize: number, coverage = 1): number {
  if (!Number.isFinite(tileSize) || tileSize <= 0 || !Number.isFinite(span) || span <= 0) {
    return 1;
  }
  const factor = Number.isFinite(coverage) && coverage > 0 ? coverage : 1;
  return Math.max(1, Math.ceil((span * factor) / tileSize) + 1);
}

/** Top-left origin and tile counts of a scrolling, wrapping tile grid. */
export interface TileGrid {
  /** X of the first tile column, in `(-tileW, 0]`. */
  baseX: number;
  /** Y of the first tile row, in `(-tileH, 0]`. */
  baseY: number;
  cols: number;
  rows: number;
}

/**
 * The tile grid that covers a `width`×`height` area as `offsetX`/`offsetY`
 * advance. The origin is `-wrapOffset(offset, tileSize)`, so the grid slides by
 * up to one tile and then repeats; tiles sit at `base + n * tileSize` for
 * `n in [0, cols)` (resp. rows), which always spans the whole area because
 * {@link tileCount} adds one wrapping tile.
 */
export function tileGrid(
  width: number,
  height: number,
  tileW: number,
  tileH: number,
  offsetX: number,
  offsetY: number,
  coverage = 1,
): TileGrid {
  return {
    baseX: -wrapOffset(offsetX, tileW),
    baseY: -wrapOffset(offsetY, tileH),
    cols: tileCount(width, tileW, coverage),
    rows: tileCount(height, tileH, coverage),
  };
}

/**
 * Slow "breathe" between `scaleMin` and `scaleMax`: one full sine cycle over
 * `periodMs`, passing through the midpoint at `t = 0` and touching both bounds
 * a quarter-cycle either side.
 *
 * A non-positive / non-finite period pins the layer at `scaleMax` — the bound
 * that never reveals an edge — and a non-finite bound falls back to 1.
 */
export function breatheScale(nowMs: number, periodMs: number, scaleMin: number, scaleMax: number): number {
  if (!Number.isFinite(scaleMin) || !Number.isFinite(scaleMax)) {
    return 1;
  }
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    return scaleMax;
  }
  const phase = sinDeg(360 * (nowMs / periodMs));
  return scaleMin + (scaleMax - scaleMin) * (0.5 + 0.5 * phase);
}

/**
 * Idle scale for a portrait: `1 ± amplitude`, one sine cycle over `periodMs`.
 * A non-positive / non-finite period or amplitude pins it at 1.
 */
export function idleScale(nowMs: number, periodMs: number, amplitude: number): number {
  if (!Number.isFinite(periodMs) || periodMs <= 0 || !Number.isFinite(amplitude)) {
    return 1;
  }
  return 1 + amplitude * sinDeg(360 * (nowMs / periodMs));
}

/** The on-screen treatment of one cutscene beat. */
export type CutsceneVisual = 'banner' | 'boss_slide' | 'player_slide' | 'none';

/**
 * Total map from a {@link CutsceneStep} kind to its visual treatment:
 * `stage_title` centres a banner, the two intros slide a portrait in from its
 * side, and `bgm_cue` / `wait` draw nothing (the BGM cue is audio-only and the
 * wait is a deliberate pause). The `default` arm keeps the function total if a
 * future kind is added without updating this table.
 */
export function cutsceneVisualFor(kind: CutsceneStep['kind']): CutsceneVisual {
  switch (kind) {
    case 'stage_title':
      return 'banner';
    case 'boss_intro':
      return 'boss_slide';
    case 'player_intro':
      return 'player_slide';
    case 'bgm_cue':
    case 'wait':
      return 'none';
    default:
      return 'none';
  }
}

/**
 * The default entrance sequence: stage title → boss intro → player intro, with
 * each window taken from the cutscene tuning. `title` is the banner text for the
 * first beat (e.g. the stage name); the two intros carry fixed labels.
 */
export function defaultCutsceneSteps(
  title: string,
  tuning: CutsceneTuning = DEFAULT_CUTSCENE_TUNING,
): CutsceneStep[] {
  return [
    { kind: 'stage_title', durationMs: tuning.stageTitleMs, text: title },
    { kind: 'boss_intro', durationMs: tuning.bossIntroMs, text: 'BOSS' },
    { kind: 'player_intro', durationMs: tuning.playerIntroMs, text: 'PLAYER' },
  ];
}
