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
import { heardSfxSources } from '../../audio';

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

    // One slider per character and per boss, on top of the channel above.
    //
    // The ids are the server's, and only the ones the player has actually
    // heard are listed — Mahjong Soul's volume screen does the same with the
    // characters you own, and it keeps this list short instead of enumerating
    // a roster the client does not have.
    const heard = heardSfxSources();
    const perSource = (kind: 'character' | 'boss'): RowHandle[] => {
      const saved = kind === 'character' ? audio.characterVolumes : audio.bossVolumes;
      const ids = [...new Set([...heard[kind === 'character' ? 'characters' : 'bosses'], ...Object.keys(saved)])].sort();
      if (ids.length === 0) {
        return [createNoteRow(width, t('settings.audio.noneHeard'))];
      }
      return ids.map((id) =>
        createSliderRow({
          width,
          label: id,
          value: saved[id] ?? 1,
          onChange: (value) => {
            // Read the map back rather than closing over `audio`: two sliders
            // in the same group would otherwise overwrite each other.
            const current = this.store.get().audio;
            const map = kind === 'character' ? current.characterVolumes : current.bossVolumes;
            this.store.update({
              audio:
                kind === 'character'
                  ? { characterVolumes: { ...map, [id]: value } }
                  : { bossVolumes: { ...map, [id]: value } },
            });
          },
        }),
      );
    };

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
      createGroupHeading(t('settings.audio.heading.characters'), width),
      createNoteRow(width, t('settings.audio.characters.desc')),
      ...perSource('character'),
      createGroupHeading(t('settings.audio.heading.bosses'), width),
      createNoteRow(width, t('settings.audio.bosses.desc')),
      ...perSource('boss'),
      createNoteRow(width, t('settings.audio.noAssetsNote')),
    ];
  }
}
