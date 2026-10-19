/**
 * i18n runtime: catalogue lookup, error-code mapping and the locale holder.
 *
 * Design:
 *  - `translate` is a PURE function (locale + key + params -> string), so the
 *    whole catalogue is testable without an engine or a DOM.
 *  - The current locale is held here (a tiny observable) and the platform layer
 *    pushes it from the settings store on every change. That keeps `core/`
 *    DOM-free while still giving screens a single "re-render me" hook.
 *  - Unknown codes never render blank: they render `error.unknownCode` WITH the
 *    raw code interpolated, so a player can report a code and the developer
 *    can still see which one it was.
 */

import { isLocaleId, type LocaleId, type Messages } from './messages';
import { zhHans } from './zh-Hans';
import { zhHant } from './zh-Hant';
import { ja } from './ja';

export { SUPPORTED_LOCALES, LOCALE_LABELS, isLocaleId } from './messages';
export type { LocaleId, Messages } from './messages';

const CATALOGUE: Readonly<Record<LocaleId, Messages>> = {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
};

/** The locale used when nothing else is known. */
export const FALLBACK_LOCALE: LocaleId = 'zh-Hans';

/** Substitutes `{name}` placeholders. Unknown placeholders are left as-is. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Looks a key up in `locale`. A missing key in a SHIPPED locale is a bug (the
 * compiler prevents it), so this falls back to the root locale and finally to
 * the key itself — never to an empty string.
 */
export function translate(
  locale: LocaleId,
  key: keyof Messages,
  params?: Record<string, string | number>,
): string {
  const table = CATALOGUE[locale] ?? CATALOGUE[FALLBACK_LOCALE];
  const template = table[key] ?? CATALOGUE[FALLBACK_LOCALE][key] ?? String(key);
  return interpolate(template, params);
}

/** Every error code the Go lobby can return, mapped to its message key. */
const ERROR_CODE_KEYS: Readonly<Record<string, keyof Messages>> = {
  unauthorized: 'error.unauthorized',
  not_found: 'error.not_found',
  invalid_request: 'error.invalid_request',
  deck_invalid: 'error.deck_invalid',
  mode_invalid: 'error.mode_invalid',
  forbidden_field: 'error.forbidden_field',
  match_state_invalid: 'error.match_state_invalid',
  rate_limited: 'error.rate_limited',
  battle_callback_freshness_incomplete: 'error.battle_callback_freshness_incomplete',
  reconnect_expired: 'error.reconnect_expired',
  match_already_ended: 'error.match_already_ended',
  claim_ineligible: 'error.claim_ineligible',
};

/**
 * Localizes a lobby error code. An unmapped code falls back to
 * `error.unknownCode` with the raw code interpolated — a player sees a message
 * in their language, a developer still learns which code fired.
 */
export function errorMessage(locale: LocaleId, code: string): string {
  const key = ERROR_CODE_KEYS[code];
  if (!key) {
    return translate(locale, 'error.unknownCode', { code });
  }
  return translate(locale, key);
}

// --- the current-locale holder ------------------------------------------------

let currentLocale: LocaleId = FALLBACK_LOCALE;
const listeners = new Set<(locale: LocaleId) => void>();

export function getLocale(): LocaleId {
  return currentLocale;
}

/** Sets the locale and notifies listeners only when it actually changes. */
export function setLocale(next: unknown): void {
  const locale: LocaleId = isLocaleId(next) ? next : FALLBACK_LOCALE;
  if (locale === currentLocale) {
    return;
  }
  currentLocale = locale;
  for (const listener of [...listeners]) {
    listener(locale);
  }
}

/** Subscribes to locale changes; returns the unsubscribe function. */
export function onLocaleChange(listener: (locale: LocaleId) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `t` against the CURRENT locale — the call sites' convenience. */
export function t(key: keyof Messages, params?: Record<string, string | number>): string {
  return translate(currentLocale, key, params);
}
