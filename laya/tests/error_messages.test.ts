/**
 * 错误码的文案：不再有原始码漏给玩家。
 *
 * 这张表有两层：`core/game/auth_messages.ts` 的小表（账号与传输类，靠界面自己的
 * `auth.*` 键，自动跟随界面语言），和 `core/i18n/errors.ts` 的大表（全部错误码）。
 * 大表以前**没人调用**，于是扭蛋、商店、对战那几十个码原样显示给玩家。
 */

import { expect, expectEqual, suite, test } from './harness';
import { describeAuthError } from '../src/core/game/auth_messages';
import { describeError, isKnownErrorCode } from '../src/core/i18n/errors';
import { setLanguage } from '../src/core/game/i18n';

suite('error text: every code the client can surface has a sentence');

test('a lobby code outside the small table still reads as a sentence', () => {
  // These used to reach the player as the raw code.
  for (const code of [
    'gacha_pull_missing_pool',
    'gacha_pull_invalid_count',
    'gacha_exchange_missing_item',
    'battle_send_failed',
    'battle_key_id_missing',
    'battle_auth_tag_invalid',
  ]) {
    const text = describeAuthError(code);
    expect(text !== code, `${code} must not be shown raw`);
    expect(text.length > 0, `${code} must have some text`);
  }
});

test('the Nakama transport codes read as sentences too', () => {
  const code = 'nakama_email_code_unsupported';
  expect(describeAuthError(code) !== code, 'must not be shown raw');
  expect(isKnownErrorCode(code), 'and the full table knows it');
});

test('a code nobody knows still falls through untouched', () => {
  // Deliberate: a new server code should show itself rather than be swallowed
  // by a generic "something went wrong".
  expectEqual(describeAuthError('some_code_nobody_mapped'), 'some_code_nobody_mapped');
});

suite('error text: follows the interface language');

test('the sentence is in the language the interface is in', () => {
  const original = setLanguage('zh-Hans');
  try {
    const chinese = describeAuthError('battle_send_failed');
    setLanguage('en');
    const english = describeAuthError('battle_send_failed');
    expect(chinese !== english, 'the two languages must differ');
    expect(/[a-z]/.test(english), 'the English one must be in English');
  } finally {
    setLanguage(original);
  }
});

test('the full table has a sentence in every interface language', () => {
  for (const locale of ['zh-Hans', 'zh-Hant', 'ja', 'en'] as const) {
    const text = describeError('battle_send_failed', locale);
    expect(text.length > 0, `${locale} must have a sentence`);
    expect(text !== 'battle_send_failed', `${locale} must not be the raw code`);
  }
});
