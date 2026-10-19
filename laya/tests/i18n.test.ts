import { expectDeepEqual, expectEqual, suite, test } from './harness';
import {
  FALLBACK_LOCALE,
  errorMessage,
  getLocale,
  onLocaleChange,
  setLocale,
  t,
  translate,
  SUPPORTED_LOCALES,
} from '../src/core/i18n';
import { defaultSettings, normalizeSettings } from '../src/core/settings';
import { zhHans } from '../src/core/i18n/zh-Hans';
import { zhHant } from '../src/core/i18n/zh-Hant';
import { ja } from '../src/core/i18n/ja';

suite('i18n catalogue');

test('every shipped locale defines every key of the authoring locale', () => {
  const authoringKeys = Object.keys(zhHans).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const table = { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja }[locale];
    const keys = Object.keys(table).sort();
    expectDeepEqual(keys, authoringKeys, `${locale} must define exactly the authoring key set`);
  }
});

test('a locale never renders an empty string for any key', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of Object.keys(zhHans) as (keyof typeof zhHans)[]) {
      const text = translate(locale, key);
      if (text.trim() === '') {
        throw new Error(`${locale}.${key} is empty`);
      }
    }
  }
});

test('the three locales are genuinely different scripts, not a font swap', () => {
  // Simplified vs Traditional must differ (the classic trap is returning the
  // same array for both), and Japanese must differ from both.
  const sameHansHant: string[] = [];
  for (const key of Object.keys(zhHans) as (keyof typeof zhHans)[]) {
    if (zhHans[key] === zhHant[key] && /[\u4e00-\u9fff]/.test(zhHans[key])) {
      sameHansHant.push(key);
    }
  }
  // Locale *names* are intentionally identical across locales (they are the
  // languages' own endonyms), so those are excluded from the comparison.
  const meaningful = sameHansHant.filter((k) => !k.startsWith('settings.language.'));
  if (meaningful.length > 0) {
    throw new Error(`zh-Hant is not genuinely Traditional for: ${meaningful.join(', ')}`);
  }
  // The same by-design exclusions apply: the brand subtitle and the three
  // endonyms are intentionally identical in every locale.
  const JA_EXEMPT = new Set(['app.subtitle', 'settings.language.zh-Hans', 'settings.language.zh-Hant', 'settings.language.ja']);
  const sameWithJa: string[] = [];
  for (const key of Object.keys(zhHans) as (keyof typeof zhHans)[]) {
    if (ja[key] === zhHans[key] && !JA_EXEMPT.has(key)) {
      sameWithJa.push(key);
    }
  }
  expectDeepEqual(sameWithJa, [], 'ja must differ from zh-Hans on all authored prose');
});

suite('i18n runtime');

test('translate interpolates {placeholders} and leaves unknown ones alone', () => {
  expectEqual(translate('zh-Hans', 'error.unknownCode', { code: 'weird_code' }), '发生未知错误（代码：weird_code）。');
  expectEqual(translate('ja', 'error.unknownCode', { code: 'x' }), '不明なエラーが発生しました（コード：x）。');
  expectEqual(translate('ja', 'error.unknownCode'), '不明なエラーが発生しました（コード：{code}）。');
});

test('a known lobby code maps to localized text, an unknown one keeps the code', () => {
  expectEqual(errorMessage('zh-Hans', 'rate_limited'), '操作太频繁了，请稍后再试。');
  expectEqual(errorMessage('ja', 'rate_limited'), '操作が頻繁すぎます。しばらくしてからお試しください。');
  const unknown = errorMessage('zh-Hant', 'some_new_code');
  if (!unknown.includes('some_new_code')) {
    throw new Error(`an unmapped code must still surface it: ${unknown}`);
  }
});

test('setLocale notifies only on a real change and is clamped to shipped locales', () => {
  setLocale('zh-Hans');
  let calls = 0;
  const seen: string[] = [];
  const off = onLocaleChange((locale) => {
    calls++;
    seen.push(locale);
  });
  setLocale('zh-Hans'); // no change -> no notification
  expectEqual(calls, 0, 'setting the same locale must not notify');
  setLocale('zh-Hant');
  expectEqual(calls, 1, 'a real change notifies once');
  expectEqual(getLocale(), 'zh-Hant');
  setLocale('ja');
  expectDeepEqual(seen, ['zh-Hant', 'ja'], 'one notification per change');
  setLocale('klingon'); // unknown -> falls back, still a change from ja
  expectEqual(getLocale(), FALLBACK_LOCALE, 'an unknown locale falls back');
  off();
  setLocale('ja');
  expectEqual(calls, 3, 'after unsubscribe nothing else arrives');
  setLocale('zh-Hans');
});

test('t() reads the current locale', () => {
  setLocale('ja');
  expectEqual(t('login.signIn'), 'ログイン');
  setLocale('zh-Hans');
  expectEqual(t('login.signIn'), '登录');
});

suite('settings locale persistence');

test('the locale lives in the settings and survives a corrupt blob', () => {
  const settings = normalizeSettings({ locale: 'ja' });
  expectEqual(settings.locale, 'ja');
  const defaults = defaultSettings();
  expectEqual(defaults.locale, FALLBACK_LOCALE);
  const coerced = normalizeSettings({ locale: 'klingon' });
  expectEqual(coerced.locale, FALLBACK_LOCALE, 'a bad stored locale falls back');
});
