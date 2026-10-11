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
 */

const MESSAGES: Record<string, string> = {
  '': '',
  // The lobby answers a wrong password and an unknown address identically, so
  // this string must not imply which of the two was wrong.
  unauthorized: 'Wrong e-mail or password',
  account_exists: 'That account is already registered',
  account_username_required: 'Enter a username',
  account_email_required: 'Enter your e-mail address',
  account_password_required: 'Enter a password',
  account_username_invalid: 'Username must be 3-24 letters, digits or underscores',
  account_email_invalid: 'That e-mail address is not valid',
  account_password_weak: 'Password must be at least 8 characters',
  account_username_taken: 'That username is already taken',
  account_email_taken: 'That e-mail is already registered — sign in instead',
  account_email_not_verified: 'Verify your e-mail before signing in',
  verification_code_required: 'Enter the 6-digit code we e-mailed you',
  verification_code_invalid: 'That verification code is incorrect',
  verification_code_expired: 'That code has expired — request a new one',
  verification_rate_limited: 'Please wait a moment before requesting another code',
  mail_unavailable: 'The lobby could not send the e-mail — please try again shortly',
  accounts_unavailable: 'Accounts are unavailable right now — please try again shortly',
  invalid_request:
    'Username must be 3-24 letters, digits or underscores, and the password at least 8 characters',
  storage_unavailable: 'The lobby cannot reach its database right now — please try again shortly',
  login_missing_session: 'The lobby accepted the sign-in but returned no session',
  transport_error: 'Cannot reach the lobby — check that it is running',
  // Pushed when the same account signs in on another device: the server drops
  // the older session and closes its connection.
  session_replaced: 'This account was signed in on another device — this session has ended',
  // Minted locally when the lobby answers a bare `401` to an authenticated
  // call. That covers an aged-out token and a lobby restart as well as a
  // takeover, and the wire cannot tell them apart — so it must not claim the
  // alarming one.
  session_expired: 'Your session has expired — please sign in again',
};

export function describeAuthError(code: string): string {
  // `Object.prototype.hasOwnProperty` rather than a truthiness check: the empty
  // code maps to the empty string, which must not be mistaken for "unknown".
  if (Object.prototype.hasOwnProperty.call(MESSAGES, code)) {
    return MESSAGES[code];
  }
  return code;
}

/** True when `code` names a real lobby error (i.e. `describeAuthError` changed it). */
export function isKnownAuthError(code: string): boolean {
  return describeAuthError(code) !== code;
}
