/**
 * "Audio" settings tab.
 *
 * A flat list of channel volumes: a global mute plus a master slider, then the
 * per-category mix (music, then the effect channels). Every control writes
 * straight through to the shared `SettingsStore`, which is the only mutable
 * copy — the section never caches a value of its own.
 *
 * Mute is modelled as a *disable*, not a hide: the five sliders keep their
 * positions so the player can see the mix is preserved and restore it exactly
 * by un-muting. That is why the sliders are created before the toggle and held
 * in locals — the toggle's callback reaches back into them.
 *
 * NOTE: `platform/laya/` only.
 */

import { BaseSettingsSection } from './section';
import {
  createGroupHeading,
  createNoteRow,
  createSliderRow,
  createToggleRow,
  type RowHandle,
} from './widgets';

export class AudioSection extends BaseSettingsSection {
  readonly title = 'Audio';
  readonly subtitle = '声音 · Music, graze, shot and skill volumes';

  protected build(width: number): RowHandle[] {
    const audio = this.store.get().audio;

    // Built before the mute toggle so its callback can flip them; the order of
    // the returned array (not creation) is what sets the on-screen order.
    const master = createSliderRow({
      width,
      label: 'Master volume',
      value: audio.masterVolume,
      onChange: (value) => this.store.update({ audio: { masterVolume: value } }),
    });
    const bgm = createSliderRow({
      width,
      label: 'BGM volume',
      value: audio.bgmVolume,
      onChange: (value) => this.store.update({ audio: { bgmVolume: value } }),
    });
    const graze = createSliderRow({
      width,
      label: 'Graze',
      description: '擦弹 — the near-miss cue when a bullet passes close to your hitbox.',
      value: audio.grazeVolume,
      onChange: (value) => this.store.update({ audio: { grazeVolume: value } }),
    });
    const playerShot = createSliderRow({
      width,
      label: 'Player shot',
      description: '自机音效 — your own ship\u2019s shot cues.',
      value: audio.playerShotVolume,
      onChange: (value) => this.store.update({ audio: { playerShotVolume: value } }),
    });
    const skill = createSliderRow({
      width,
      label: 'Skill',
      description: '技能音效 — bombs and spell cards.',
      value: audio.skillVolume,
      onChange: (value) => this.store.update({ audio: { skillVolume: value } }),
    });

    const sliders = [master, bgm, graze, playerShot, skill];

    const mute = createToggleRow({
      width,
      label: 'Mute all',
      description:
        'Silences every channel without losing the mix below, so un-muting restores it exactly.',
      value: audio.muted,
      onChange: (value) => {
        this.store.update({ audio: { muted: value } });
        // Disable (never hide) the mix sliders so the preserved levels stay
        // readable; update the existing handles instead of rebuilding, which
        // would yank the row out from under the finger that just tapped it.
        for (const slider of sliders) {
          slider.setEnabled(!value);
        }
      },
    });

    for (const slider of sliders) {
      slider.setEnabled(!audio.muted);
    }

    return [
      createGroupHeading('Audio', width),
      mute,
      master,
      createGroupHeading('Music', width),
      bgm,
      createGroupHeading('Sound effects', width),
      graze,
      playerShot,
      skill,
      createNoteRow(
        width,
        'No audio files ship with this build. The levels below are stored and pushed to the engine\u2019s mixer, but nothing will be audible until sound assets are added.',
      ),
    ];
  }
}
