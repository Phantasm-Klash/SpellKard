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
import { BaseSettingsSection } from './section';
import {
  createGroupHeading,
  createInfoRow,
  createNoteRow,
  type RowHandle,
} from './widgets';

/** Capitalises a scope id for its group heading (`global` → `Global`). */
function scopeHeading(scope: string): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export class KeysSection extends BaseSettingsSection {
  readonly title = 'Keys';
  readonly subtitle = '键盘快捷键 · Every binding the client ships';

  protected build(width: number): RowHandle[] {
    const rows: RowHandle[] = [
      createNoteRow(
        width,
        'This list is generated from the single binding table the dispatcher ' +
          'matches against, so it can never drift from the code. Keys that stay ' +
          'live while a text field has focus are marked in the note at the end.',
      ),
    ];

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

    rows.push(
      createNoteRow(
        width,
        'While a text field has focus only the bindings marked allowInTextInput ' +
          'fire — Tab, Shift+Tab, Enter, Escape, Alt+Enter, Ctrl+Tab.',
      ),
    );

    return rows;
  }
}
