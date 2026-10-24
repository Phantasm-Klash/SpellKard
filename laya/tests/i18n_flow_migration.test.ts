/**
 * Regression tests for the i18n migration that removed the hard-coded English
 * status lines from the lobby flow and the auth error table.
 *
 * The bug these pin down: `LobbyFlow` and `auth_messages` used to hold their own
 * English strings, so a player on any language read English while signing in,
 * creating a room or settling a match. The symptom the user reported was a
 * stray Chinese "签到" on screen — a key missing from the *active* table falls
 * through `t()` to the default table (`zh-Hans`), so any language could show
 * Chinese text.
 *
 * These tests therefore assert the property, not the specific copy: every
 * language table carries the `flow.*` / `auth.*` keys, `t()` never leaks the
 * default language into a non-default one, and the auth error mapping resolves
 * every code to a translated sentence rather than echoing the raw code.
 */

import { expect, expectEqual, suite, test } from './harness';
import { describeAuthError, isKnownAuthError } from '../src/core/game/auth_messages';
import {
  LANGUAGES,
  i18nKeys,
  setLanguage,
  stringTable,
  t,
} from '../src/core/game/i18n';

suite('i18n migration: lobby flow and auth errors');

test('every table carries the flow.* and auth.* keys', () => {
  const reference = i18nKeys();
  const flow = reference.filter((key) => key.startsWith('flow.'));
  const auth = reference.filter((key) => key.startsWith('auth.'));
  expect(flow.length > 20, `the flow keys are declared (${flow.length})`);
  expect(auth.length >= 22, `the auth keys are declared (${auth.length})`);
  for (const info of LANGUAGES) {
    const table = stringTable(info.code);
    for (const key of [...flow, ...auth]) {
      expect(key in table, `${info.code} carries ${key}`);
    }
  }
});

test('every key resolves in every language, so nothing falls through to the default', () => {
  // The regression that produced the stray 签到: a key absent from the *active*
  // table falls through `t()` to the default table, which is Simplified
  // Chinese — so any language could show Chinese text. The mechanism is a
  // missing key, so the property worth pinning is completeness, not "does this
  // string look Chinese" (Japanese legitimately uses kanji, and Traditional
  // Chinese uses the same Han characters, so no character heuristic can tell a
  // leaked Simplified sentence from real Japanese copy).
  //
  // `tests/i18n.test.ts` already asserts the key sets match; this test pins the
  // same property from the resolve side, for the namespaces the migration
  // touched, so a future table edit cannot silently drop one.
  const reference = i18nKeys();
  expect(reference.length > 0, 'the default table is not empty');
  for (const info of LANGUAGES) {
    const table = stringTable(info.code);
    for (const key of reference) {
      const value = table[key];
      expect(typeof value === 'string' && value.trim() !== '', `${info.code}.${key} has copy`);
    }
  }
});

test('resolving a key in a non-default language never returns the default copy', () => {
  // `t()` returns the default table's value when the active table misses the
  // key, which is how a Simplified-Chinese string reaches an English screen.
  //
  // This deliberately does NOT assert "the value differs from the default" for
  // every key: Traditional Chinese writes many of these words identically to
  // Simplified Chinese (卡牌池, 回放, 背包, 段位 …), so an equality check would
  // fail on correct copy. The property that actually matters — completeness —
  // is covered by `tests/i18n.test.ts` ("every language table has the same
  // keys") and by the table walk above; what this test adds is the resolve
  // path: on a non-default language, a key that exists must come back with the
  // active table's own value rather than the fallback.
  const reference = i18nKeys();
  for (const info of LANGUAGES) {
    setLanguage(info.code);
    const table = stringTable(info.code);
    for (const key of reference) {
      expectEqual(t(key), table[key], `${info.code} resolves ${key} from its own table`);
    }
  }
});

test('flow status lines resolve in every language, never echoing a key', () => {
  const keys = i18nKeys().filter((key) => key.startsWith('flow.'));
  for (const info of LANGUAGES) {
    setLanguage(info.code);
    for (const key of keys) {
      const value = t(key);
      expect(value !== key, `${info.code} resolves ${key}`);
      expect(value.trim() !== '', `${info.code} has copy for ${key}`);
    }
  }
});

test('flow placeholders substitute in every language', () => {
  // The parameter set is derived from the tables rather than written out by
  // hand: a hand-written set silently goes stale the moment a key introduces a
  // new placeholder, and the test then fails on the *new* key for a reason that
  // has nothing to do with the substitution.
  const placeholderNames = new Set<string>();
  for (const key of i18nKeys()) {
    const value = stringTable('zh-Hans')[key] ?? '';
    for (const match of value.matchAll(/\{(\w+)\}/g)) {
      placeholderNames.add(match[1]);
    }
  }
  const params: Record<string, string> = {};
  for (const name of placeholderNames) {
    params[name] = `<${name}>`;
  }
  const keys = i18nKeys().filter((key) => key.startsWith('flow.'));
  for (const info of LANGUAGES) {
    setLanguage(info.code);
    for (const key of keys) {
      const value = t(key, params);
      // A dropped placeholder renders as a literal `{name}`, which is what the
      // player would see — so none may survive substitution.
      expect(!/\{\w+\}/.test(value), `${info.code} substitutes ${key}: ${value}`);
    }
  }
});

test('every language uses the same placeholders for the same key', () => {
  // A translation that renames a placeholder (`{error}` → `{reason}`) would
  // substitute to the literal `{reason}` in that language only, and the
  // substitution test above would catch it — but only if it happens to run
  // with that language selected. Comparing the sets directly names the key
  // and the two languages involved.
  const names = (code: string, key: string): string[] => {
    const value = stringTable(code as never)[key] ?? '';
    return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  };
  const reference = 'zh-Hans';
  for (const key of i18nKeys()) {
    const expected = names(reference, key);
    for (const info of LANGUAGES) {
      if (info.code === reference) {
        continue;
      }
      const actual = names(info.code, key);
      expect(
        actual.join(',') === expected.join(','),
        `${info.code}.${key} placeholders [${actual.join(',')}] differ from ${reference} [${expected.join(',')}]`,
      );
    }
  }
});

test('every known auth code maps to a translated sentence', () => {
  const codes = [
    'unauthorized',
    'account_exists',
    'account_username_required',
    'account_email_required',
    'account_password_required',
    'account_username_invalid',
    'account_email_invalid',
    'account_password_weak',
    'account_username_taken',
    'account_email_taken',
    'account_email_not_verified',
    'verification_code_required',
    'verification_code_invalid',
    'verification_code_expired',
    'verification_rate_limited',
    'mail_unavailable',
    'accounts_unavailable',
    'invalid_request',
    'storage_unavailable',
    'login_missing_session',
    'transport_error',
    'session_replaced',
    'session_expired',
  ];
  for (const info of LANGUAGES) {
    setLanguage(info.code);
    for (const code of codes) {
      const text = describeAuthError(code);
      expect(text !== code, `${info.code} translates ${code}`);
      expect(text.trim() !== '', `${info.code} has copy for ${code}`);
    }
  }
});

test('the auth error text follows the active language', () => {
  // The same code must not read English on a Chinese build, and must not read
  // Chinese on an English one.
  setLanguage('en');
  expectEqual(describeAuthError('unauthorized'), 'Wrong e-mail or password');
  setLanguage('zh-Hans');
  expectEqual(describeAuthError('unauthorized'), '邮箱或密码错误');
  setLanguage('ja');
  expect(describeAuthError('unauthorized') !== 'Wrong e-mail or password', 'ja has its own copy');
});

test('an unknown code still passes through untouched', () => {
  setLanguage('en');
  // Deliberate: a new server code degrades to the raw string instead of being
  // swallowed by a generic message.
  expectEqual(describeAuthError('some_future_code'), 'some_future_code');
  expect(!isKnownAuthError('some_future_code'), 'an unknown code is not "known"');
  expect(isKnownAuthError('unauthorized'), 'a known code is "known"');
});
