/**
 * `describeAuthError` / `isKnownAuthError` coverage.
 *
 * The login screen renders `describeAuthError(code)` and flags it red when
 * `isKnownAuthError(code)` is true. Every row of the mapping table is pinned,
 * plus the deliberate pass-through for codes the table does not know (a new
 * server code must degrade to the raw string, not a generic message).
 */

import { describeAuthError, isKnownAuthError } from '../src/core/game/auth_messages';
import { expectEqual, suite, test } from './harness';

suite('auth messages');

test('the empty code maps to the empty string', () => {
  expectEqual(describeAuthError(''), '');
});

test('unauthorized reads as a wrong-credentials message', () => {
  expectEqual(describeAuthError('unauthorized'), 'Wrong e-mail or password');
});

test('account_exists reads as an already-registered message', () => {
  expectEqual(describeAuthError('account_exists'), 'That account is already registered');
});

test('account_username_required asks for a username', () => {
  expectEqual(describeAuthError('account_username_required'), 'Enter a username');
});

test('account_email_required asks for an e-mail address', () => {
  expectEqual(describeAuthError('account_email_required'), 'Enter your e-mail address');
});

test('account_password_required asks for a password', () => {
  expectEqual(describeAuthError('account_password_required'), 'Enter a password');
});

test('account_username_invalid spells out the username rule', () => {
  expectEqual(
    describeAuthError('account_username_invalid'),
    'Username must be 3-24 letters, digits or underscores',
  );
});

test('account_email_invalid rejects a malformed address', () => {
  expectEqual(describeAuthError('account_email_invalid'), 'That e-mail address is not valid');
});

test('account_password_weak spells out the minimum length', () => {
  expectEqual(describeAuthError('account_password_weak'), 'Password must be at least 8 characters');
});

test('the taken-account codes name what is taken', () => {
  expectEqual(describeAuthError('account_username_taken'), 'That username is already taken');
  expectEqual(
    describeAuthError('account_email_taken'),
    'That e-mail is already registered — sign in instead',
  );
});

test('account_email_not_verified tells the player to verify first', () => {
  expectEqual(describeAuthError('account_email_not_verified'), 'Verify your e-mail before signing in');
});

test('the verification-code codes are all mapped', () => {
  expectEqual(describeAuthError('verification_code_required'), 'Enter the 6-digit code we e-mailed you');
  expectEqual(describeAuthError('verification_code_invalid'), 'That verification code is incorrect');
  expectEqual(
    describeAuthError('verification_code_expired'),
    'That code has expired — request a new one',
  );
  expectEqual(
    describeAuthError('verification_rate_limited'),
    'Please wait a moment before requesting another code',
  );
});

test('mail and account outages are reported as temporary', () => {
  expectEqual(
    describeAuthError('mail_unavailable'),
    'The lobby could not send the e-mail — please try again shortly',
  );
  expectEqual(
    describeAuthError('accounts_unavailable'),
    'Accounts are unavailable right now — please try again shortly',
  );
});

test('invalid_request spells out the username and password rules', () => {
  expectEqual(
    describeAuthError('invalid_request'),
    'Username must be 3-24 letters, digits or underscores, and the password at least 8 characters',
  );
});

test('storage_unavailable explains the database is unreachable', () => {
  expectEqual(
    describeAuthError('storage_unavailable'),
    'The lobby cannot reach its database right now — please try again shortly',
  );
});

test('login_missing_session explains the missing session', () => {
  expectEqual(
    describeAuthError('login_missing_session'),
    'The lobby accepted the sign-in but returned no session',
  );
});

test('transport_error tells the player the lobby is unreachable', () => {
  expectEqual(
    describeAuthError('transport_error'),
    'Cannot reach the lobby — check that it is running',
  );
});

test('an unknown server code passes straight through', () => {
  expectEqual(describeAuthError('weird_new_code'), 'weird_new_code');
});

test('a prefixed local marker passes straight through', () => {
  expectEqual(describeAuthError('lobby_call_failed:rooms.create'), 'lobby_call_failed:rooms.create');
});

test('isKnownAuthError recognises a mapped code', () => {
  expectEqual(isKnownAuthError('unauthorized'), true);
});

test('isKnownAuthError rejects an unknown code', () => {
  expectEqual(isKnownAuthError('weird_new_code'), false);
});

test('isKnownAuthError treats the empty code as no error', () => {
  expectEqual(isKnownAuthError(''), false);
});
