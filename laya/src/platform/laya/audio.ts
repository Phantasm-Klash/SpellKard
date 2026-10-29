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

/**
 * Whose sound is playing: a character (the player's own ship) or a boss.
 *
 * Lets a single sound get its own slider on top of its category's — the way
 * Mahjong Soul lets one voice be louder than another.
 */
export interface SfxSource {
  readonly kind: 'character' | 'boss';
  /** The server's id for the character or boss. */
  readonly id: string;
}

/** Effective gains for the last applied settings; used by the play helpers. */
let volumes: ResolvedVolumes = resolveVolumes({
  muted: false,
  masterVolume: 1,
  bgmVolume: 1,
  grazeVolume: 1,
  playerShotVolume: 1,
  skillVolume: 1,
  characterVolumes: {},
  bossVolumes: {},
});

/** The last applied group, kept so a per-id slider can be read at play time. */
let audioSettings: AudioSettings | null = null;

/**
 * Ids the player has actually heard: characters and bosses.
 *
 * The settings screen lists these so it can offer a slider per one, which is
 * how Mahjong Soul does it — you tune the voices you have. A boss never
 * encountered is not listed (there is nothing to judge yet), and a slider the
 * player already set survives here because its id is also in the saved map.
 */
const heardCharacters = new Set<string>();
const heardBosses = new Set<string>();

/** The ids heard so far, each list alphabetically ordered. */
export function heardSfxSources(): { readonly characters: string[]; readonly bosses: string[] } {
  return {
    characters: [...heardCharacters].sort(),
    bosses: [...heardBosses].sort(),
  };
}

/** Records that a source was played, so the settings screen can list it. */
function noteSfxSource(source: SfxSource | undefined): void {
  if (source === undefined || source.id === '') {
    return;
  }
  if (source.kind === 'character') {
    heardCharacters.add(source.id);
  } else {
    heardBosses.add(source.id);
  }
}

/** Applies the whole Audio group. Safe to call before `Laya.init`. */
export function applyAudioSettings(audio: AudioSettings): void {
  audioSettings = audio;
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
 * One character's or boss's own volume, 0..1.
 *
 * An id with no entry means "follow the category" — so a boss the player has
 * never touched a slider for still sounds right, and nothing has to be seeded
 * when the server adds one.
 */
export function sourceVolume(source: SfxSource | undefined): number {
  if (source === undefined || audioSettings === null || source.id === '') {
    return 1;
  }
  const map = source.kind === 'character'
    ? audioSettings.characterVolumes
    : audioSettings.bossVolumes;
  const value = map[source.id];
  return typeof value === 'number' ? value : 1;
}

/**
 * The effective gain for one sound, category × the source's own slider.
 *
 * `sfxGain` stays the plain category gain for callers that have no source.
 */
export function sfxGainFor(category: SfxCategory, source?: SfxSource): number {
  return sfxGain(category) * sourceVolume(source);
}

/**
 * Plays a one-shot sound effect at its channel's gain.
 *
 * Returns `null` when there is nothing to play (empty URL, or the mix is
 * silent), so callers can treat "no asset yet" and "muted" the same way and
 * skip whatever visual work would accompany the sound.
 */
export function playSfx(
  category: SfxCategory,
  url: string,
  loops = 1,
  source?: SfxSource,
): Laya.SoundChannel | null {
  const gain = sfxGainFor(category, source);
  if (url === '' || gain <= 0) {
    return null;
  }
  // Noted on the way out, not on the way in: a source whose slider is at zero
  // has still been met, and muting one channel must not hide another's setting.
  noteSfxSource(source);
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
