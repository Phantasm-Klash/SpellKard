/**
 * Lobby language-repaint contract.
 *
 * The lobby scene paints every one of its labels from `t()` **once** — at
 * construction, or in the snapshot / refresh paths — and repaints them in place
 * when the stored language moves (see `LobbyScene.applyLanguage`). A CDP probe
 * against the native client (2026-10-25) caught the state before that fix: the
 * settings modal switched language, the lobby's own buttons did not. The same
 * probe found the lobby's play page painting the raw keys
 * `lobby.joinRoomCode` / `lobby.roomCodeHint`, which no table shipped.
 *
 * The scene half of that fix is engine-bound (it needs `Laya`), so it is
 * verified live. What is testable offline is the half that would silently
 * undermine it: if any `ui.*` / `lobby.*` string were missing from a table, or
 * resolved to the same text in two languages, or left a `{placeholder}` the
 * lobby never fills, a repaint would be a no-op on screen even though the code
 * ran. This suite locks that — reading the tables directly
 * ({@link stringTable}) so it never mutates the module's active language, which
 * the suite's later cases depend on.
 */

import {
  LANGUAGES,
  stringTable,
} from '../src/core/game/i18n';
import { expect, suite, test } from './harness';

/** Keys the lobby surface paints; the prefix is the scene's own namespace. */
function lobbyKeys(): string[] {
  return Object.keys(stringTable('zh-Hans'))
    .filter((key) => key.startsWith('ui.') || key.startsWith('lobby.'))
    .sort();
}

suite('lobby: language repaint contract');

test('the lobby surface has a real key set to repaint', () => {
  const keys = lobbyKeys();
  expect(keys.length >= 15, `expected the lobby's key set, got ${keys.length}`);
  // The static labels `applyLanguage` re-texts must all be present. The two
  // play-page keys were once missing entirely and painted as raw key text.
  for (const key of [
    'ui.play',
    'ui.shop',
    'ui.records',
    'ui.signIn',
    'ui.back',
    'ui.roomCode',
    'lobby.checkin',
    'lobby.inventory',
    'lobby.signOut',
    'lobby.page.menu',
    'lobby.page.play',
    'lobby.joinRoomCode',
    'lobby.roomCodeHint',
    'lobby.changeRoomCode',
    'lobby.createRoom',
    'lobby.joinRoom',
    'lobby.joinQueue',
    'lobby.refreshQueue',
    'lobby.cancelQueue',
  ]) {
    for (const info of LANGUAGES) {
      const value = stringTable(info.code)[key];
      expect(value !== undefined && value !== '', `${key} is missing or empty in ${info.code}`);
    }
  }
});

test('every lobby key changes text between zh-Hans and en/ja', () => {
  const zh = stringTable('zh-Hans');
  // English is the strict untranslated-table detector: nothing in this build's
  // English column may equal its Chinese source.
  const en = stringTable('en');
  for (const key of lobbyKeys()) {
    expect(en[key] !== '', `${key} is empty in en`);
    expect(en[key] !== zh[key], `${key} did not change in en (both "${zh[key]}")`);
  }
  // Japanese legitimately shares one word with Chinese (商店, "shop"); every
  // other key must move. A new collision means someone pasted the Chinese
  // column into the Japanese one.
  const JA_SHARED_WITH_ZH = new Set(['ui.shop']);
  const ja = stringTable('ja');
  for (const key of lobbyKeys()) {
    expect(ja[key] !== '', `${key} is empty in ja`);
    if (JA_SHARED_WITH_ZH.has(key)) {
      continue;
    }
    expect(ja[key] !== zh[key], `${key} did not change in ja (both "${zh[key]}")`);
  }
});

test('no lobby key leaves a placeholder the lobby never fills', () => {
  // The two parametrised keys on this surface are filled by their callers —
  // `lobby.profile.ruleset` by the lobby's profile line (`{version}` from the
  // session), `ui.matchLabel` by the records surface. Everything else must
  // arrive whole, or the screen would show a literal `{...}` after a repaint.
  const PARAMETRISED = new Set(['lobby.profile.ruleset', 'ui.matchLabel']);
  for (const info of LANGUAGES) {
    const table = stringTable(info.code);
    for (const key of lobbyKeys()) {
      if (PARAMETRISED.has(key)) {
        continue;
      }
      const value = table[key] ?? '';
      expect(!/\{[a-zA-Z_][a-zA-Z0-9_]*\}/.test(value), `${key} carries a placeholder in ${info.code}: "${value}"`);
    }
  }
});
