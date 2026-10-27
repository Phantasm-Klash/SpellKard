/**
 * Error-code → player-facing text, one table per locale.
 *
 * The lobby never sends prose: it sends a stable snake_case `error_code`, and
 * the client is the seam that turns it into a sentence. This module is the
 * single place that mapping lives.
 *
 * Rules:
 *  - Every known code has a sentence in all three locales. `ErrorMessages` is a
 *    `Record<ErrorCode, string>`, so a missing translation is a compile error.
 *  - An unknown code renders the locale's generic sentence **plus the raw
 *    code** — never a blank, never an English-only string.
 *  - Local client failures (`transport_error`, `login_missing_session`,
 *    `lobby_call_failed:<op>`, …) use the same table.
 *
 * NOTE: `core/` only.
 */

import type { LocaleId } from './messages';
import { enErrors, jaErrors, zhHansErrors, zhHantErrors } from './error_messages';

/**
 * Every code the client can surface.
 *
 * Sources checked:
 *  - `Gensoulkyo/runtime/core/service.go` (`code*` constants)
 *  - `Gensoulkyo/runtime/account/service.go` (`Code*` constants)
 *  - `Gensoulkyo/runtime/nakamaapi/handler.go` + `runtime/security/business_envelope.go`
 *  - client-minted codes in `core/net/lobby_client.ts` and `core/game/lobby_flow.ts`
 *
 * `battle_callback_*` codes are emitted by the lobby's service-to-service
 * callback path; the client never receives them, but they are mapped so a
 * misrouted error still renders a real sentence instead of a raw code.
 */
export const ERROR_CODES = [
  // core lobby
  'not_found',
  'unauthorized',
  'invalid_request',
  'deck_invalid',
  'mode_invalid',
  'forbidden_field',
  'input_invalid',
  'match_state_invalid',
  'rate_limited',
  'claim_ineligible',
  'room_unavailable',
  'reconnect_expired',
  'mode_action_invalid',
  'battle_server_unavailable',
  'insufficient_funds',
  'already_claimed',
  'out_of_window',
  'out_of_stock',
  'session_replaced',
  // shop
  'product_not_found',
  'not_purchasable',
  'insufficient_currency',
  'daily_limit_reached',
  'idempotency_conflict',
  'quantity_invalid',
  // accounts
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
  'storage_unavailable',
  // nakama / envelope
  'business_envelope_required',
  'service_origin_required',
  'client_operation_disallowed',
  'business_envelope_invalid',
  'business_envelope_replay',
  // battle callback / ticket (server-side, mapped defensively)
  'battle_callback_freshness_incomplete',
  'battle_callback_signature_invalid',
  'battle_callback_nonce_invalid',
  'battle_callback_replay',
  'battle_callback_server_mismatch',
  'battle_callback_timestamp_stale',
  'battle_result_rejected',
  'battle_ticket_expired',
  // client-minted
  'login_missing_session',
  'transport_error',
  'session_expired',
  'bootstrap_invalid_payload',
  'lobby_call_failed',
  'lobby_transport_error',
  'lobby_ws_closed',
  'lobby_ws_not_connected',
  'lobby_ws_unsupported_op',
  'matchmaking_ticket_missing_id',
  'matchmaking_cancel_missing_id',
  'shop_purchase_missing_item',
  'chest_open_missing_pool',
  'activity_claim_missing_id',
  'match_start_missing_match_id',
  // gacha / shop / battle
  'gacha_pull_missing_pool',
  'gacha_pull_invalid_count',
  'gacha_exchange_missing_item',
  'battle_send_failed',
  'battle_key_id_missing',
  'battle_auth_tag_invalid',
  // nakama transport
  'nakama_email_code_unsupported',
  'nakama_authenticate_failed',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** One sentence per code. Missing entry = compile error. */
export type ErrorMessages = Record<ErrorCode, string>;

/**
 * The locales the error text exists in.
 *
 * This is wider than the interface's own locale list on purpose: the interface
 * offers English as a fourth language, so the error sentences have to exist in
 * English too. English is not in `core/i18n`'s `SUPPORTED_LOCALES` because that
 * list is about the *interface* strings, which live in a different table.
 */
export type ErrorLocale = LocaleId | 'en';

const TABLES: Readonly<Record<ErrorLocale, ErrorMessages>> = {
  'zh-Hans': zhHansErrors,
  'zh-Hant': zhHantErrors,
  ja: jaErrors,
  en: enErrors,
};

/** The generic sentence for an unrecognised code; `{code}` is the raw code. */
export const UNKNOWN_ERROR: Readonly<Record<ErrorLocale, string>> = {
  'zh-Hans': '发生未知错误（{code}）',
  'zh-Hant': '發生未知錯誤（{code}）',
  ja: '不明なエラーが発生しました（{code}）',
  en: 'Something went wrong ({code})',
};

function isErrorCode(code: string): code is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

/** Replaces `{name}` placeholders. Unknown placeholders are left untouched. */
export function fillTemplate(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (params === undefined) {
    return template;
  }
  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Localised text for one error code.
 *
 * `lobby_call_failed:<op>` and `lobby_transport_error:<op>` keep their operation
 * suffix in the raw-code form: the player gets the generic sentence and the
 * code, which is the only way to tell which call failed without a second table.
 */
export function describeError(code: string, locale: ErrorLocale = 'zh-Hans'): string {
  if (code === '') {
    return '';
  }
  const table = TABLES[locale];
  if (isErrorCode(code)) {
    return table[code];
  }
  return fillTemplate(UNKNOWN_ERROR[locale], { code });
}

/** True when `code` has a sentence of its own (rather than the generic one). */
export function isKnownErrorCode(code: string): boolean {
  return isErrorCode(code);
}
