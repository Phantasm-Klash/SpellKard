/**
 * Reference tuning for the battle performance layer: the scrolling/scaling
 * stage background, the character/boss watermarks and the stage-entrance
 * cutscene.
 *
 * ★ Single home for every reference number. The Laya layers
 * (`platform/laya/view/stage_background.ts`, `watermark.ts`, `cutscene.ts`)
 * and the pure derivations in `stage_visual.ts` read their constants from
 * here, so a value corrected against the reference build changes in exactly one
 * place instead of drifting between four files.
 *
 * ★ PROVISIONAL — every value below is marked `// PENDING-RE`. The reverse
 * engineering spec (`/root/gotouhou/.rev/specs/visual_audio_spec.md`) did not
 * exist when this landed, so these are documented starting points for the
 * reference binary `libMyGame_arm64.so`:
 *   - the two background scale bounds were read as the float bit patterns
 *     `0x3f666666` (0.9) and `0x3f888888` (≈1.0666667) inside
 *     `GameLayer::update` @ 0x561e88;
 *   - the two background layers and their order come from
 *     `GameLayer::resetBackGround` @ 0x55b9ec;
 *   - the scroll speeds, breathe period, watermark and cutscene numbers are
 *     chosen to match the observed feel and MUST be re-checked against the
 *     spec once it exists. Replace each `// PENDING-RE` with a spec citation
 *     when confirming it.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

/** Scroll + breathe of the two stacked stage-background layers. */
export interface StageBackgroundTuning {
  /** Far layer scroll speed (px/s). */
  farScrollPxPerSecond: number;
  /** Near layer scroll speed (px/s). */
  nearScrollPxPerSecond: number;
  /** Scale at the bottom of the breathe. */
  scaleMin: number;
  /** Scale at the top of the breathe. */
  scaleMax: number;
  /** Length of one full breathe cycle (ms). */
  breathePeriodMs: number;
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
  stageTitleMs: number;
  bossIntroMs: number;
  playerIntroMs: number;
}

/**
 * Two parallax layers: the far one drifts slowly, the near one ~3.3× faster, so
 * the field reads as depth. The breathe spans `0x3f666666`..`0x3f888888`
 * (0.9..1.0667) over a 4 s cycle.
 */
export const DEFAULT_STAGE_BACKGROUND_TUNING: StageBackgroundTuning = {
  farScrollPxPerSecond: 12, // PENDING-RE — parallax ratio far:near ≈ 1:3.3
  nearScrollPxPerSecond: 40, // PENDING-RE
  scaleMin: 0.9, // PENDING-RE — float bits 0x3f666666 in GameLayer::update
  scaleMax: 1.0667, // PENDING-RE — float bits 0x3f888888 (≈1.0666667)
  breathePeriodMs: 4000, // PENDING-RE
};

/**
 * A faint portrait that slowly breathes ±2 % over 2.6 s and brightens for a
 * quarter of a second when its owner acts.
 */
export const DEFAULT_WATERMARK_TUNING: WatermarkTuning = {
  idleScaleAmplitude: 0.02, // PENDING-RE — ±2 %
  idlePeriodMs: 2600, // PENDING-RE
  opacity: 0.35, // PENDING-RE
  flashMs: 260, // PENDING-RE
};

/** Stage title → boss intro → player intro, in the order the field announces them. */
export const DEFAULT_CUTSCENE_TUNING: CutsceneTuning = {
  stageTitleMs: 2200, // PENDING-RE
  bossIntroMs: 1600, // PENDING-RE
  playerIntroMs: 1400, // PENDING-RE
};
