/**
 * Settings section: the language picker.
 *
 * The setting itself lives in the settings store (`GameSettings.language`) and
 * is applied by the app at boot and on change, so this section is a thin
 * selector over it. The choices come from the i18n module's own locale list —
 * adding a locale there makes it appear here without touching this file.
 */

import { DEFAULT_LANGUAGE, LANGUAGES, isLanguageCode, t, type LanguageCode } from '../../../../core/game/i18n';
import { BaseSettingsSection } from './section';
import { createNoteRow, createOptionRow, type RowHandle } from './widgets';

export class LanguageSection extends BaseSettingsSection {
  get title(): string {
    return t('settings.language');
  }
  get subtitle(): string {
    return t('settings.subtitle.language');
  }

  protected build(width: number): RowHandle[] {
    // The store keeps the language as a plain string (it round-trips through
    // JSON); normalize here so a stale or hand-edited value cannot put the
    // selector on a locale this build does not ship.
    const stored = this.store.get().language;
    const current: LanguageCode = isLanguageCode(stored) ? stored : DEFAULT_LANGUAGE;
    return [
      createOptionRow<LanguageCode>({
        width,
        label: t('settings.language'),
        description: t('settings.language.hint'),
        choices: LANGUAGES.map((info) => ({ id: info.code, label: info.label })),
        value: current,
        onChange: (language) => {
          this.store.update({ language });
        },
      }),
      // Every surface resolves its strings per frame, so a switch is immediate;
      // say so, because players expect a restart prompt that is not needed.
      createNoteRow(width, t('settings.language.hint')),
    ];
  }
}
