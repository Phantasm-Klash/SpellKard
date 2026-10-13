/**
 * Battle audio: the stage BGM and the match-event sound effects.
 *
 * The one place the battle scene asks for sound. It owns the TNA-root-relative
 * URL table (joined onto the deployment root with `tnaAssetUrl`) and the
 * per-category throttle, and delegates the actual playback to
 * `platform/laya/audio.ts` — the only module that touches `Laya.SoundManager`.
 *
 * Throttle: the event stream can carry a `hit`/`graze` row at up to 60 Hz and
 * `match.events` pages cap at 64 rows, so a drained backlog would fire a burst
 * of identical SEs. Each category is limited to one play per 100 ms (see
 * `core/game/sfx_throttle`); the clock is injected so the limit is testable.
 *
 * There is no crossfade API in Laya's `SoundManager`, so starting a stage track
 * does `stopAllAudio()` then `playBgm` — a hard cut, documented here rather than
 * faked with a fade the engine cannot do.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic path / tuning helpers.
 */

import { isNativeAssetRuntime, tnaAssetUrl } from '../../core/game/tna_assets';
import { stageBgmUrl } from '../../core/game/stage_art';
import { SfxThrottle } from '../../core/game/sfx_throttle';
import { playBgm, playSfx, stopAllAudio, type SfxCategory } from './audio';

/** TNA-root-relative SE files (they ship under `tna/audio/`). */
const SFX_URLS: Readonly<Record<SfxCategory, string>> = {
  graze: 'audio/se_graze.mp3',
  playerShot: 'audio/se_p_shot.mp3',
  skill: 'audio/se_e_spell_start.mp3',
};

export class BattleAudioManager {
  private readonly throttle = new SfxThrottle();

  /**
   * @param now monotonic millisecond clock for the SE throttle. Defaults to
   *        `Date.now`; tests inject a fake clock.
   * @param native overrides the deployment probe (`isNativeAssetRuntime`) so a
   *        caller can pin the root.
   */
  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly native: () => boolean = () => isNativeAssetRuntime(),
  ) {}

  /**
   * Starts the stage track. `stageId` resolves to a TNA-root-relative URL; an
   * unknown id (`''`) stops any current audio and plays nothing (silent
   * degradation). No crossfade: the engine cannot do one.
   */
  playStageBgm(stageId: string): void {
    stopAllAudio();
    const relative = stageBgmUrl(stageId);
    if (relative === '') {
      return;
    }
    playBgm(tnaAssetUrl(relative, this.native()), 0);
  }

  /** Plays one throttled sound effect for the channel. */
  playSfx(category: SfxCategory): void {
    if (!this.throttle.allow(category, this.now())) {
      return;
    }
    playSfx(category, tnaAssetUrl(SFX_URLS[category], this.native()), 1);
  }

  /** Stops all audio (used when leaving the match). */
  stopAll(): void {
    stopAllAudio();
  }
}
