/**
 * i18n message catalogue — the typed contract every locale must satisfy.
 *
 * Why an interface rather than a loose record: a missing key must be a
 * COMPILE error, not a runtime blank. TypeScript rejects a locale object that
 * does not provide every field of `Messages`, so adding a string is a
 * "the build tells you which locales are now incomplete" operation instead of
 * a "some player sees an empty label" bug.
 *
 * Coverage note (honest): this catalogue covers the login screen, the settings
 * surface and the error strings. In-game HUD/draft/gift labels still carry
 * their original literals and are migrated one surface at a time — see
 * `/root/gotouhou/task-queue/out/i18n_design.md`.
 */

/** The locales shipped today. The first entry is the fallback root. */
export const SUPPORTED_LOCALES = ['zh-Hans', 'zh-Hant', 'ja'] as const;
export type LocaleId = (typeof SUPPORTED_LOCALES)[number];

/** Locales presented to the player, in the order the selector lists them. */
export const LOCALE_LABELS: Readonly<Record<LocaleId, string>> = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
};

/** True when `value` is one of the locales this build ships. */
export function isLocaleId(value: unknown): value is LocaleId {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export interface Messages {
  'app.title': string;
  'app.subtitle': string;

  'login.title': string;
  'login.email': string;
  'login.password': string;
  'login.signIn': string;
  'login.createAccount': string;
  'login.notConnected': string;
  'login.signingIn': string;
  'login.failed': string;
  'login.transportError': string;

  'settings.title': string;
  'settings.language': string;
  'settings.language.hint': string;
  'settings.language.zh-Hans': string;
  'settings.language.zh-Hant': string;
  'settings.language.ja': string;
  'settings.applied': string;

  'error.generic': string;
  'error.network': string;
  'error.timeout': string;
  'error.unknownCode': string;

  'error.unauthorized': string;
  'error.not_found': string;
  'error.invalid_request': string;
  'error.deck_invalid': string;
  'error.mode_invalid': string;
  'error.forbidden_field': string;
  'error.match_state_invalid': string;
  'error.rate_limited': string;
  'error.battle_callback_freshness_incomplete': string;
  'error.reconnect_expired': string;
  'error.match_already_ended': string;
  'error.claim_ineligible': string;
}
