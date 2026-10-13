/**
 * Battle performance resource table: stage art, character/boss portraits and
 * stage BGM file names.
 *
 * Pure data and pure functions — no LayaAir import, no DOM — so the platform
 * layer can turn these names into loaded assets while the tests pin the
 * mapping without a runtime. Every lookup degrades silently (a known-but-unused
 * or genuinely unknown input maps onto stage 1 / `player_01` / phase 1), which
 * is cheaper than throwing: a mismatched watermark must never blank the field.
 *
 * ★ Stage-id mapping — the lobby's four stage ids (`allowedStageIDs`,
 * `Gensoulkyo/runtime/core/service.go:453`) correspond to the 千夜追忆
 * reference stages 1..4 in declaration order:
 *
 * | lobby `stage_id`   | reference stage |
 * | ------------------ | --------------- |
 * | `starlit_lanes`    | 1               |
 * | `misty_crossfire`  | 2               |
 * | `clockwork_bloom`  | 3               |
 * | `lunar_maze`       | 4               |
 *
 * ★ Character mapping (`allowedCharacterIDs`, `service.go:458`):
 *
 * | lobby `character_id` | portrait        |
 * | -------------------- | --------------- |
 * | `balanced`           | `player_01.png` |
 * | `precision`          | `player_02.png` |
 * | `wide`               | `player_03.png` |
 * | `spell_power`        | `player_04.png` |
 *
 * ★ Every function below returns a path **relative to the TNA resource root**
 * (see `tna_assets.ts`), e.g. `bg_01_01.png`, `player/player_01.png`,
 * `boss/boss_01_11.png`, `audio/bgm_stage_01_11.mp3`. The caller joins the name
 * onto the deployment root with `tnaAssetUrl(name, isNativeAssetRuntime())` —
 * the name helpers must never carry the `tna/` segment themselves, or the join
 * would double it. Asset layout:
 * `bg_XX_01.png` / `bg_XX_02.png` for the two background layers,
 * `player/player_XX.png` for the character watermark, `boss/boss_XX_YY.png`
 * for the boss watermark (`XX` = stage, `YY` = phase) and
 * `audio/bgm_stage_0X_11.mp3` for the stage track.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

/** The four lobby stage ids, in reference-stage order (`service.go:453`). */
export const STAGE_IDS = ['starlit_lanes', 'misty_crossfire', 'clockwork_bloom', 'lunar_maze'] as const;

export type StageId = (typeof STAGE_IDS)[number];

/** Number of reference stages the art tree ships backgrounds for. */
export const REFERENCE_STAGE_COUNT = 4;

/** Reference-stage portrait index per lobby character id (`service.go:458`). */
const CHARACTER_PORTRAIT_INDEX: Readonly<Record<string, number>> = {
  balanced: 1,
  precision: 2,
  wide: 3,
  spell_power: 4,
};

/** Two-digit, 1-based zero padding shared by every art file name. */
function artNumber(value: number): string {
  return String(Math.max(1, Math.trunc(value))).padStart(2, '0');
}

/**
 * Reference stage (1..4) for a lobby stage id, or `0` when the id is unknown.
 *
 * The 0 sentinel is deliberate: callers that want "fall back quietly" ask
 * {@link backgroundNames} directly, while callers that need to distinguish
 * "no stage" (e.g. a snapshot that never carried one) can check for it.
 */
export function stageIndex(stageId: string): number {
  const index = (STAGE_IDS as readonly string[]).indexOf(stageId);
  return index < 0 ? 0 : index + 1;
}

/**
 * The two stacked background layers of a stage: `bg_XX_01.png` (far) and
 * `bg_XX_02.png` (near). Unknown stages fall back to stage 1.
 */
export function backgroundNames(stage: number): [string, string] {
  const reference = Number.isFinite(stage) && stage >= 1 && stage <= REFERENCE_STAGE_COUNT ? Math.trunc(stage) : 1;
  const prefix = `bg_${artNumber(reference)}`;
  return [`${prefix}_01.png`, `${prefix}_02.png`];
}

/**
 * Character watermark path (`player/player_XX.png`) for a lobby character id.
 * Unknown ids fall back to `player/player_01.png` (the `balanced` art).
 */
export function characterPortrait(characterId: string): string {
  const index = CHARACTER_PORTRAIT_INDEX[characterId] ?? 1;
  return `player/player_${artNumber(index)}.png`;
}

/**
 * Boss watermark path (`boss/boss_XX_YY.png`) for a stage and phase.
 * Unknown stages fall back to stage 1; an out-of-range phase clamps to 1,
 * because a nonexistent phase art is a worse fallback than phase 1's.
 */
export function bossPortrait(stage: number, phase: number): string {
  const reference = Number.isFinite(stage) && stage >= 1 && stage <= REFERENCE_STAGE_COUNT ? Math.trunc(stage) : 1;
  return `boss/boss_${artNumber(reference)}_${artNumber(phase)}.png`;
}

/**
 * Joins an audio file name onto the TNA root's `audio/` directory, returning a
 * **TNA-root-relative** path (e.g. `audio/bgm_stage_01_11.mp3`), consistent with
 * {@link backgroundNames} / {@link characterPortrait} / {@link bossPortrait}.
 * The caller adds the deployment root with `tnaAssetUrl(path, native)`.
 */
export function tnaAudioUrl(fileName: string): string {
  return `audio/${fileName}`;
}

/**
 * Stage BGM path **relative to the TNA root** (e.g. `audio/bgm_stage_01_11.mp3`),
 * or `''` for an unknown stage id (silent degradation: `playBgm` treats `''` as
 * "nothing to play"). Join it with `tnaAssetUrl(stageBgmUrl(id), isNativeAssetRuntime())`
 * before handing it to the audio layer. The `_11` suffix is the track slot
 * inside the stage's audio set.
 */
export function stageBgmUrl(stageId: string): string {
  const stage = stageIndex(stageId);
  if (stage === 0) {
    return '';
  }
  return tnaAudioUrl(`bgm_stage_${artNumber(stage)}_11.mp3`);
}
