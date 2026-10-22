/**
 * "Keys" settings tab — the keyboard reference.
 *
 * The list is generated from the single binding table (`DEFAULT_BINDINGS`,
 * projected through `listShortcuts`), so it can never drift from the table the
 * dispatcher actually matches against: there is no second list to keep in sync.
 * Entries are grouped by scope, with the always-live `global` bindings first.
 *
 * NOTE: `platform/laya/` only.
 */

import { listShortcuts } from '../../../../core/input/shortcuts';
import { t } from '../../../../core/game/i18n';
import { BaseSettingsSection } from './section';
import {
  createGroupHeading,
  createInfoRow,
  createNoteRow,
  type RowHandle,
} from './widgets';

/**
 * Group heading for a scope id, translated when the table knows the scope.
 *
 * The scope ids are a closed set (`global`, `login`, `lobby`, …) that the i18n
 * tables carry one key each, so a new scope added to the binding table without
 * a translation still renders something readable instead of the raw key.
 */
function scopeHeading(scope: string): string {
  const translated = t(`settings.keys.scope.${scope}`);
  if (!translated.startsWith('settings.keys.scope.')) {
    return translated;
  }
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export class KeysSection extends BaseSettingsSection {
  get title(): string {
    return t('settings.tab.keys');
  }
  get subtitle(): string {
    return t('settings.subtitle.keys');
  }

  protected build(width: number): RowHandle[] {
    const rows: RowHandle[] = [createNoteRow(width, t('settings.keys.intro'))];

    // `listShortcuts` already returns global first, then the other scopes in a
    // fixed order, so a heading is emitted each time the scope changes.
    let currentScope: string | null = null;
    for (const entry of listShortcuts()) {
      if (entry.scope !== currentScope) {
        currentScope = entry.scope;
        rows.push(createGroupHeading(scopeHeading(entry.scope), width));
      }
      rows.push(createInfoRow(width, entry.label, entry.chords));
    }

    rows.push(createNoteRow(width, t('settings.keys.textInputNote')));

    return rows;
  }
}
