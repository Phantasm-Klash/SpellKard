/**
 * i18n contract tests. The project rule: every user-visible string goes through
 * the tables, and EVERY language is updated together. These tests are what make
 * the second half non-optional — a translation that lands in one language only
 * fails here instead of shipping a blank label.
 */

import { expect, expectEqual, suite, test } from './harness';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  i18nKeys,
  isLanguageCode,
  language,
  setLanguage,
  stringTable,
  t,
} from '../src/core/game/i18n';

suite('i18n');

test('every language table has the same keys', () => {
  const reference = i18nKeys();
  expect(reference.length > 0, 'the default table is not empty');
  for (const info of LANGUAGES) {
    const keys = Object.keys(stringTable(info.code)).sort();
    expectEqual(keys.join(','), reference.join(','), `${info.code} key set matches the default`);
  }
});

test('placeholder sets match across languages', () => {
  // A translation that drops `{gift}` or invents `{player}` renders a literal
  // brace in one language and an unsubstituted hole in the other.
  const names = (value: string): string[] => (value.match(/\{(\w+)\}/g) ?? []).sort();
  for (const key of i18nKeys()) {
    const reference = names(stringTable(DEFAULT_LANGUAGE)[key] ?? '');
    for (const info of LANGUAGES) {
      const other = names(stringTable(info.code)[key] ?? '');
      expectEqual(other.join(','), reference.join(','), `${info.code} placeholders for ${key}`);
    }
  }
});

test('no table value is empty or still a key', () => {
  for (const info of LANGUAGES) {
    for (const [key, value] of Object.entries(stringTable(info.code))) {
      expect(value.trim() !== '', `${info.code}.${key} is not blank`);
      expect(value !== key, `${info.code}.${key} is not the key echoed back`);
    }
  }
});

test('t() substitutes params and leaves unknown ones visible', () => {
  setLanguage('en');
  expectEqual(t('gift.announce', { from: 'Marisa', to: 'Reimu', gift: 'Tea' }), 'Marisa sent Reimu a Tea');
  // A missing param keeps its placeholder: the sentence stays readable while
  // debugging instead of silently losing a word.
  expectEqual(t('gift.announce', { from: 'Marisa' }), 'Marisa sent {to} a {gift}');
  expectEqual(t('gift.bar.charges', { left: 2, total: 5 }), 'Thoughts 2/5');
});

test('the language switch changes the resolved strings', () => {
  setLanguage('zh');
  expectEqual(language(), 'zh');
  expectEqual(t('ui.play'), '开始');
  expectEqual(t('gift.heart'), '心愿');
  expectEqual(t('gift.announce', { from: 'Marisa', to: 'Reimu', gift: '心愿' }), 'Marisa 向 Reimu 送出了 心愿');
  setLanguage('en');
  expectEqual(t('ui.play'), 'Play');
  expectEqual(t('gift.heart'), 'Heartfelt Wish');
});

test('an unknown language is ignored, and a missing key falls back then echoes', () => {
  setLanguage('en');
  setLanguage('fr'); // not shipped: the active language must not change
  expectEqual(language(), 'en');
  expect(!isLanguageCode('fr'), 'fr is not a shipped language');
  // Missing in the active table -> default table -> the key itself.
  expectEqual(t('gift.heart'), 'Heartfelt Wish');
  expectEqual(t('nope.missing'), 'nope.missing');
});
