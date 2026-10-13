/**
 * Reference tuning for the battle performance layer: the stage background, the
 * character/boss watermarks and the stage-entrance cutscene.
 *
 * ★ Single home for every reference number. The Laya layers
 * (`platform/laya/view/stage_background.ts`, `watermark.ts`, `cutscene.ts`)
 * and the pure derivations in `stage_visual.ts` read their constants from
 * here, so a value corrected against the reference build changes in exactly one
 * place instead of drifting between four files.
 *
 * ★ Numbers come from the reverse-engineering spec
 * `/root/gotouhou/.rev/specs/visual_audio_spec.md`, read off the native build
 * `libMyGame_arm64.so` (`GameLayer::resetBackGround` @0x55b9ec,
 * `GameLayer::updateImage` @0x56330c, `GameLayer::update` @0x561e88,
 * `GameLayer::setStageTitle` @0x55ea9c). Each value below cites the spec section
 * it came from. Where the reference has no counterpart (the decorative
 * watermark, the client-only intro beats) the comment says so instead of
 * inventing a citation.
 *
 * The reference stage is a **320×480** design space (§global: `WinSize`, centre
 * 160,240) and all "px per frame" figures are quoted at the engine's **60 fps**
 * default. `platform/laya/view/stage_background.ts` scales the whole model by
 * `coveredHeight / referenceStageHeight` so the same proportions hold on the
 * client's variable-size playfield.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

/** Scroll, static scale and counter-rotation of the four stage-background sprites. */
export interface StageBackgroundTuning {
  /** Static scale of the two layer-1 tiles (`bg_XX_01`). Spec §1.2: `setScale(2.0)`. */
  layer1Scale: number;
  /** Static scale of the two layer-2 tiles (`bg_XX_02`). Spec §1.2: `setScale(2.4)`. */
  layer2Scale: number;
  /** Reference design stage height in px (the 320×480 stage). Spec §1.2 / global. */
  referenceStageHeight: number;
  /**
   * Vertical distance between the two layer-1 tiles, in reference px.
   * Spec §1.2: `512.0` = exactly one displayed 256 px tile at scale 2.0, so the
   * pair tiles seamlessly.
   */
  layer1SpacingPx: number;
  /**
   * Layer-1 downward scroll speed, reference px per frame.
   * Spec §1.3: `1 px/帧` (= 60 px/s at 60 fps), counter `[GameLayer+0x39c]` +1/frame.
   */
  layer1ScrollPxPerFrame: number;
  /**
   * Layer-2 rotation speed, degrees per frame; the two tiles turn in opposite
   * directions. Spec §1.4: `±0.25°/帧` (= ±15°/s).
   */
  layer2RotationDegPerFrame: number;
  /** Reference frame rate; every "per frame" value above is quoted at this rate. Spec global. */
  framesPerSecond: number;
}

/** Idle motion + opacity of a character/boss watermark portrait. */
export interface WatermarkTuning {
  /** Idle scale swing, e.g. `0.02` = ±2 %. */
  idleScaleAmplitude: number;
  /** Length of one full idle cycle (ms). */
  idlePeriodMs: number;
  /** Resting opacity of a portrait (0..1). */
  opacity: number;
  /** Duration of the brighten-then-decay flash (ms). */
  flashMs: number;
}

/** Durations of the stage-entrance cutscene beats (ms). */
export interface CutsceneTuning {
  /** Stage-title banner window. Spec §3.1: FadeIn 1.0 + Delay 4.0 + FadeOut 1.0 = 6.0 s. */
  stageTitleMs: number;
  /** Boss-intro beat. Client-only: the reference has no separate boss intro. */
  bossIntroMs: number;
  /** Player-intro beat. Client-only: the reference has no separate player intro. */
  playerIntroMs: number;
}

/**
 * The reference background: **four** sprites, not two scrolling layers.
 * Layer 1 is two `bg_XX_01` tiles at scale 2.0, 512 px apart vertically,
 * scrolling **down** at 60 px/s (spec §1.3). Layer 2 is two `bg_XX_02` tiles at
 * scale 2.4, exactly overlapping, counter-rotating at ±15°/s to form a symmetric
 * vortex (spec §1.4). There is **no animated scale** — spec §1.6 finds no
 * `setScale` call anywhere in `updateImage()`.
 */
export const DEFAULT_STAGE_BACKGROUND_TUNING: StageBackgroundTuning = {
  layer1Scale: 2.0, // §1.2 — fmov #2.0
  layer2Scale: 2.4, // §1.2 — .rodata 0xb0ce68 (0x4019999a)
  referenceStageHeight: 480, // §global — WinSize height
  layer1SpacingPx: 512, // §1.2 — .rodata 0xb0ce64 (0x44000000)
  layer1ScrollPxPerFrame: 1, // §1.3 — 60 px/s at 60 fps
  layer2RotationDegPerFrame: 0.25, // §1.4 — fmov d8,#0.25
  framesPerSecond: 60, // §global — cocos2d-x default
};

/**
 * A faint portrait that slowly breathes ±2 % over 2.6 s and brightens for a
 * quarter of a second when its owner acts.
 *
 * ★ No reference numbers: spec §4 notes the native build has no layer called
 * "watermark" — its portraits are character select art (`showSelectChara`
 * @0x32da68, static) and a Boss spell portrait that flies in (`showBossSpellEffect`
 * @0x539100). These values are the client's own decorative treatment of that
 * portrait layer, not reverse-engineered figures.
 */
export const DEFAULT_WATERMARK_TUNING: WatermarkTuning = {
  idleScaleAmplitude: 0.02, // client-side — ±2 %
  idlePeriodMs: 2600, // client-side
  opacity: 0.35, // client-side
  flashMs: 260, // client-side
};

/**
 * Stage title → boss intro → player intro, in the order the field announces
 * them. The title window is the spec's 6.0 s (§3.1); the two intros are
 * client-only beats (the reference has neither) and keep their own durations.
 */
export const DEFAULT_CUTSCENE_TUNING: CutsceneTuning = {
  stageTitleMs: 6000, // §3.1 — 1.0 + 4.0 + 1.0 s
  bossIntroMs: 1600, // client-side
  playerIntroMs: 1400, // client-side
};
