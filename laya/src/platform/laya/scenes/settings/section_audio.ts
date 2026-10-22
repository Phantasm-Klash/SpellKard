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
import { t } from '../../../../core/game/i18n';

export class AudioSection extends BaseSettingsSection {
  get title(): string {
    return t('settings.tab.audio');
  }
  get subtitle(): string {
    return t('settings.subtitle.audio');
  }

  protected build(width: number): RowHandle[] {
    const audio = this.store.get().audio;

    // Built before the mute toggle so its callback can flip them; the order of
    // the returned array (not creation) is what sets the on-screen order.
    const master = createSliderRow({
      width,
      label: t('settings.audio.master'),
      value: audio.masterVolume,
      onChange: (value) => this.store.update({ audio: { masterVolume: value } }),
    });
    const bgm = createSliderRow({
      width,
      label: t('settings.audio.bgm'),
      value: audio.bgmVolume,
      onChange: (value) => this.store.update({ audio: { bgmVolume: value } }),
    });
    const graze = createSliderRow({
      width,
      label: t('settings.audio.graze'),
      description: t('settings.audio.graze.desc'),
      value: audio.grazeVolume,
      onChange: (value) => this.store.update({ audio: { grazeVolume: value } }),
    });
    const playerShot = createSliderRow({
      width,
      label: t('settings.audio.playerShot'),
      description: t('settings.audio.playerShot.desc'),
      value: audio.playerShotVolume,
      onChange: (value) => this.store.update({ audio: { playerShotVolume: value } }),
    });
    const skill = createSliderRow({
      width,
      label: t('settings.audio.skill'),
      description: t('settings.audio.skill.desc'),
      value: audio.skillVolume,
      onChange: (value) => this.store.update({ audio: { skillVolume: value } }),
    });

    const sliders = [master, bgm, graze, playerShot, skill];

    const mute = createToggleRow({
      width,
      label: t('settings.audio.muteAll'),
      description: t('settings.audio.muteAll.desc'),
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
      createGroupHeading(t('settings.audio.heading.audio'), width),
      mute,
      master,
      createGroupHeading(t('settings.audio.heading.music'), width),
      bgm,
      createGroupHeading(t('settings.audio.heading.sfx'), width),
      graze,
      playerShot,
      skill,
      createNoteRow(width, t('settings.audio.noAssetsNote')),
    ];
  }
}
