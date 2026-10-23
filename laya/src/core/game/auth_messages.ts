/**
 * Player-facing text for a lobby error code.
 *
 * `LobbyClient.lastError` is either a server `error_code` (`unauthorized`,
 * `account_exists`, …) or a locally minted marker (`transport_error`,
 * `login_missing_session`, `lobby_call_failed:<op>`). The login screen used to
 * print those verbatim, which told the player nothing. This maps the codes the
 * lobby actually emits to a sentence, and — deliberately — **passes anything it
 * does not recognise straight through**, so a new server code degrades to the
 * raw string instead of being swallowed by a generic "something went wrong".
 *
 * The sentences themselves live in `core/game/i18n.ts` under the `auth.*`
 * namespace: this table used to hold hard-coded English, so a player on any
 * other language read English error text. Only the code → key mapping stays
 * here, because that mapping is what the wire defines.
 */

import { t } from './i18n';

/** Server error code → i18n key. Unknown codes fall through untouched. */
const MESSAGES: Record<string, string> = {
  '': '',
  // The lobby answers a wrong password and an unknown address identically, so
  // this string must not imply which of the two was wrong.
  unauthorized: 'auth.unauthorized',
  account_exists: 'auth.accountExists',
  account_username_required: 'auth.usernameRequired',
  account_email_required: 'auth.emailRequired',
  account_password_required: 'auth.passwordRequired',
  account_username_invalid: 'auth.usernameInvalid',
  account_email_invalid: 'auth.emailInvalid',
  account_password_weak: 'auth.passwordWeak',
  account_username_taken: 'auth.usernameTaken',
  account_email_taken: 'auth.emailTaken',
  account_email_not_verified: 'auth.emailNotVerified',
  verification_code_required: 'auth.codeRequired',
  verification_code_invalid: 'auth.codeInvalid',
  verification_code_expired: 'auth.codeExpired',
  verification_rate_limited: 'auth.codeRateLimited',
  mail_unavailable: 'auth.mailUnavailable',
  accounts_unavailable: 'auth.accountsUnavailable',
  invalid_request: 'auth.invalidRequest',
  storage_unavailable: 'auth.storageUnavailable',
  login_missing_session: 'auth.loginMissingSession',
  transport_error: 'auth.transportError',
  // Pushed when the same account signs in on another device: the server drops
  // the older session and closes its connection.
  session_replaced: 'auth.sessionReplaced',
  // Minted locally when the lobby answers a bare `401` to an authenticated
  // call. That covers an aged-out token and a lobby restart as well as a
  // takeover, and the wire cannot tell them apart — so it must not claim the
  // alarming one.
  session_expired: 'auth.sessionExpired',
};

export function describeAuthError(code: string): string {
  // `Object.prototype.hasOwnProperty` rather than a truthiness check: the empty
  // code maps to the empty string, which must not be mistaken for "unknown".
  if (Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
    return t(MESSAGES[code]);
  }
  return code;
}

/** True when `code` names a real lobby error (i.e. `describeAuthError` changed it). */
export function isKnownAuthError(code: string): boolean {
  return describeAuthError(code) !== code;
}
