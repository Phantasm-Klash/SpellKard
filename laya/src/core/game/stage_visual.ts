/**
 * Pure, engine-agnostic derivations shared by the performance overlays: the
 * four-sprite stage background, the watermark portraits and the stage-entrance
 * cutscene.
 *
 * Everything here is a function of the tuning numbers in `tna_stage_tuning.ts`
 * and of elapsed time — no Laya, no DOM, no RNG — so the background geometry,
 * the portrait breathe and the cutscene step→visual table can be unit tested
 * without a runtime. The Laya layers own only the sprite plumbing and call into
 * these.
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
 * Scale factor mapping the reference design stage onto an area of
 * `coveredHeight` px. The reference stage is 320×480 (spec global), so the
 * factor is `coveredHeight / referenceStageHeight`; every reference length
 * (scales, the 512 px tile spacing, the scroll speed) is multiplied by it.
 *
 * A non-finite / non-positive input yields `1` (draw at reference size) rather
 * than `0`, which would collapse the layer.
 */
export function backgroundScale(coveredHeight: number, referenceStageHeight: number): number {
  if (
    !Number.isFinite(coveredHeight) ||
    coveredHeight <= 0 ||
    !Number.isFinite(referenceStageHeight) ||
    referenceStageHeight <= 0
  ) {
    return 1;
  }
  return coveredHeight / referenceStageHeight;
}

/**
 * Reference frame counter after `elapsedMs` at `framesPerSecond`. The reference
 * bumps its counter by exactly 1 per rendered frame (`GameLayer::update`
 * @0x5623e8), so at a fixed 60 fps tick this returns the same integer sequence;
 * it is left continuous so a client running at another tick rate still animates
 * smoothly. Non-finite / non-positive input yields `0`.
 */
export function frameCounter(elapsedMs: number, framesPerSecond: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || !Number.isFinite(framesPerSecond) || framesPerSecond <= 0) {
    return 0;
  }
  return (elapsedMs * framesPerSecond) / 1000;
}

/**
 * Layer-1 downward scroll distance in px after `elapsedMs`:
 * `pxPerFrame * frames`. Unbounded — {@link layerTileOffsets} wraps it.
 */
export function layer1ScrollOffset(elapsedMs: number, pxPerFrame: number, framesPerSecond: number): number {
  return pxPerFrame * frameCounter(elapsedMs, framesPerSecond);
}

/**
 * The two layer-1 tile centre offsets, relative to the layer centre, after
 * `elapsedMs`. The tiles are one `spacing` apart and scroll **down**: the pair
 * moves toward `+Y` as time advances, and the whole pattern repeats every
 * `spacing` px (spec §1.3: 1024 px arithmetic period, 512 px visual period).
 *
 * The two values are always `spacing` apart and live in `[-spacing, spacing)`,
 * so two tiles centred on them cover a band of height `2 * spacing` around the
 * layer centre — seamless as long as `spacing >= coveredHeight`.
 */
export function layerTileOffsets(
  elapsedMs: number,
  spacing: number,
  pxPerFrame: number,
  framesPerSecond: number,
): [number, number] {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    return [0, 0];
  }
  const base = wrapOffset(layer1ScrollOffset(elapsedMs, pxPerFrame, framesPerSecond), spacing);
  return [base - spacing, base];
}

/**
 * Rotation in degrees of one layer-2 tile after `elapsedMs`:
 * `direction * degPerFrame * frames`. `direction` is `+1` for the first tile
 * and `-1` for the second, so the two counter-rotate (spec §1.4: ±15°/s).
 */
export function layer2RotationDeg(
  elapsedMs: number,
  degPerFrame: number,
  framesPerSecond: number,
  direction: number,
): number {
  const sign = direction < 0 ? -1 : 1;
  return sign * degPerFrame * frameCounter(elapsedMs, framesPerSecond);
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
