/**
 * Applies the *Audio* settings group to the LayaAir runtime, and is the one
 * place game code should ask for a sound.
 *
 * Division of labour:
 *  - `core/settings`'s `resolveVolumes` is the single tested source of truth for
 *    "how loud is this channel right now" — it already folds in the master
 *    volume and the mute switch.
 *  - This module pushes those numbers onto the engine's mixer.
 *
 * The engine has two buses (`musicVolume` and `soundVolume`) plus per-channel
 * `SoundChannel.volume`, which multiplies into its bus. We keep both buses at
 * unity and put the *effective* gain on the channel instead, because that is
 * exactly the number `resolveVolumes` computes: splitting it across a bus and a
 * channel would mean re-deriving the same maths in two places and getting a
 * chance to disagree with the unit tests.
 *
 * IMPORTANT — this build ships **no audio assets at all** (there is not one
 * `.mp3` / `.ogg` / `.wav` in the repository). The levels are therefore real and
 * applied, but nothing is audible until sound files are added and the
 * `playSfx` / `playBgm` helpers are called with their URLs. Do not claim
 * otherwise in the UI.
 *
 * NOTE: `platform/laya/` only. Never imported from `core/`.
 */

import { resolveVolumes, type AudioSettings, type ResolvedVolumes } from '../../core/settings';

/** The independent sound-effect channels the player can mix. */
export type SfxCategory = 'graze' | 'playerShot' | 'skill';

/** Effective gains for the last applied settings; used by the play helpers. */
let volumes: ResolvedVolumes = resolveVolumes({
  muted: false,
  masterVolume: 1,
  bgmVolume: 1,
  grazeVolume: 1,
  playerShotVolume: 1,
  skillVolume: 1,
});

/** Applies the whole Audio group. Safe to call before `Laya.init`. */
export function applyAudioSettings(audio: AudioSettings): void {
  volumes = resolveVolumes(audio);

  // Buses stay at unity — see the file header for why.
  Laya.SoundManager.musicVolume = 1;
  Laya.SoundManager.soundVolume = 1;

  // Set the mute flags as well as zeroing the gains: the engine may use them to
  // stop decoding, and it means a channel played by code that bypasses this
  // module is still silent while muted.
  Laya.SoundManager.musicMuted = audio.muted;
  Laya.SoundManager.soundMuted = audio.muted;
}

/** The effective 0..1 gain for a sound-effect channel. */
export function sfxGain(category: SfxCategory): number {
  return volumes[category];
}

/**
 * Plays a one-shot sound effect at its channel's gain.
 *
 * Returns `null` when there is nothing to play (empty URL, or the mix is
 * silent), so callers can treat "no asset yet" and "muted" the same way and
 * skip whatever visual work would accompany the sound.
 */
export function playSfx(category: SfxCategory, url: string, loops = 1): Laya.SoundChannel | null {
  const gain = sfxGain(category);
  if (url === '' || gain <= 0) {
    return null;
  }
  const channel = Laya.SoundManager.playSound(url, loops);
  if (channel !== null && channel !== undefined) {
    channel.volume = gain;
  }
  return channel ?? null;
}

/** Plays background music at the BGM channel's gain; `null` when nothing plays. */
export function playBgm(url: string, loops = 0): Laya.SoundChannel | null {
  if (url === '' || volumes.bgm <= 0) {
    return null;
  }
  const channel = Laya.SoundManager.playMusic(url, loops);
  if (channel !== null && channel !== undefined) {
    channel.volume = volumes.bgm;
  }
  return channel ?? null;
}

/** Stops all audio. Used when leaving a match so nothing bleeds across screens. */
export function stopAllAudio(): void {
  Laya.SoundManager.stopAll();
}
