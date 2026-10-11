/**
 * Atlas frames used for the non-bullet actors of the boss-race view.
 *
 * Boss copies come from the `enemylist0N` atlases (`stage_boss_NN_MM.png`), and
 * player ships from the `ply_shot_NN` atlases (`player_NN.png`). The frames are
 * already part of the imported TNA tree, so no extra atlas is needed — only the
 * `bullet_atlas` loader is reused to reach them.
 *
 * All names are pinned to `layaide/assets/resources/tna/index.json` by the
 * regression test, so a re-import that renames a frame fails the build instead
 * of silently regressing to vector art.
 *
 * NOTE: `core/` only — plain data, no Laya types.
 */

/** One `atlas#frame` pair inside the imported TNA tree. */
export interface TnaActorFrame {
  /** Atlas name, e.g. `enemylist01`. */
  atlas: string;
  /** Frame name inside the atlas, e.g. `stage_boss_01_11.png`. */
  frame: string;
}

/** Local Boss idle / defeat frames (Flandre, `enemylist01`). */
export const BOSS_FRAME_LOCAL: TnaActorFrame = { atlas: 'enemylist01', frame: 'stage_boss_01_11.png' };
export const BOSS_FRAME_LOCAL_DEFEATED: TnaActorFrame = { atlas: 'enemylist01', frame: 'stage_boss_damage_01_11.png' };

/** Rival Boss idle / defeat frames (a different boss, `enemylist02`). */
export const BOSS_FRAME_RIVAL: TnaActorFrame = { atlas: 'enemylist02', frame: 'stage_boss_04_11.png' };
export const BOSS_FRAME_RIVAL_DEFEATED: TnaActorFrame = { atlas: 'enemylist02', frame: 'stage_boss_damage_04_11.png' };

/** Player ship frames (32x48 sprites); local and rival use different ships. */
export const PLAYER_FRAME_LOCAL: TnaActorFrame = { atlas: 'ply_shot_01', frame: 'player_01.png' };
export const PLAYER_FRAME_RIVAL: TnaActorFrame = { atlas: 'ply_shot_02', frame: 'player_02.png' };

/** Standalone backdrop image (not an atlas frame), relative to the TNA root. */
export const TNA_BACKGROUND_IMAGE = 'bg_01_01.png';

/** Boss frame for a copy, switching to the damage art once defeated. */
export function bossFrame(isLocal: boolean, defeated: boolean): TnaActorFrame {
  if (isLocal) {
    return defeated ? BOSS_FRAME_LOCAL_DEFEATED : BOSS_FRAME_LOCAL;
  }
  return defeated ? BOSS_FRAME_RIVAL_DEFEATED : BOSS_FRAME_RIVAL;
}

/** Player ship frame for the local vs. rival ship. */
export function playerFrame(isLocal: boolean): TnaActorFrame {
  return isLocal ? PLAYER_FRAME_LOCAL : PLAYER_FRAME_RIVAL;
}

/** Every actor frame this module can request, for integrity tests. */
export function allActorFrames(): readonly TnaActorFrame[] {
  return [
    BOSS_FRAME_LOCAL,
    BOSS_FRAME_LOCAL_DEFEATED,
    BOSS_FRAME_RIVAL,
    BOSS_FRAME_RIVAL_DEFEATED,
    PLAYER_FRAME_LOCAL,
    PLAYER_FRAME_RIVAL,
  ];
}
