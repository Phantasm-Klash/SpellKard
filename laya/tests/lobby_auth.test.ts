/**
 * Account auth coverage: `LobbyClient.registerAccount` / `.loginAccount` /
 * `.requestEmailCode` / `.logout` payload mapping, the REST route table for the
 * auth ops, and the `LobbyFlow` login-screen state machine (mode, e-mail code,
 * sign-in/up, sign-out).
 *
 * The account endpoints mirror `auth.anonymous` on the wire, so the session
 * mapping is shared; these tests pin that shared shape plus the flow's local
 * guards (which must not hit the network).
 */

import {
  HttpLobbyTransport,
  LobbyClient,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { LobbyFlow, LobbyScreen } from '../src/core/game/lobby_flow';
import { expect, expectEqual, suite, test } from './harness';

/** Transport that answers every RPC with a scripted response. */
class ScriptedTransport implements LobbyTransport {
  readonly calls: LobbyRpcRequest[] = [];

  constructor(private readonly handler: (request: LobbyRpcRequest) => LobbyRpcResponse) {}

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    this.calls.push(request);
    return this.handler(request);
  }

  close(): void {
    // nothing to release
  }
}

function ok(payload: unknown): LobbyRpcResponse {
  return { ok: true, status: 200, payload };
}

/** A server session envelope shared by every auth op. */
function sessionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_token: 'tok-1',
    user_id: 'u-1',
    player_id: 'p-1',
    display_name: 'Alice',
    character_id: 'reimu',
    ruleset_version: 'rs-1',
    unlocked_character_ids: ['reimu', 'marisa'],
    ...overrides,
  };
}

/** Answers the e-mail-code op with the server's own timing policy. */
function codePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: 'alice@example.com',
    expires_at: '2026-10-11T12:10:00Z',
    resend_after: '2026-10-11T12:01:00Z',
    expires_in_seconds: 600,
    resend_in_seconds: 60,
    server_time: '2026-10-11T12:00:00Z',
    ...overrides,
  };
}

/** Answers auth ops with a session and `bootstrap` with an empty profile. */
function authHandler(request: LobbyRpcRequest): LobbyRpcResponse {
  if (request.id === 'bootstrap') {
    return ok({ ruleset_version: 'rs-1' });
  }
  if (request.id === 'auth.emailCode') {
    return ok(codePayload());
  }
  return ok(sessionPayload());
}

suite('account auth client');

test('loginAccount maps the session token and user id from the response', async () => {
  const transport = new ScriptedTransport(() => ok(sessionPayload()));
  const client = new LobbyClient({ transport });
  const session = await client.loginAccount('alice@example.com', 'secret');
  expect(session !== null, 'login should return a session');
  expectEqual(session?.sessionToken, 'tok-1');
  expectEqual(session?.userId, 'u-1');
  expectEqual(session?.displayName, 'Alice');
  expectEqual(session?.unlockedCharacterIds.length, 2);
  expectEqual(transport.calls[0]?.id, 'auth.login');
  const payload = transport.calls[0]?.payload as Record<string, unknown>;
  // The e-mail address is the sign-in identifier, not the username.
  expectEqual(payload.email, 'alice@example.com');
  expectEqual(payload.username, undefined);
  expectEqual(payload.password, 'secret');
});

test('registerAccount forwards username, e-mail, code and display name', async () => {
  const transport = new ScriptedTransport(() => ok(sessionPayload({ display_name: 'Alice the Great' })));
  const client = new LobbyClient({ transport });
  const session = await client.registerAccount(
    'alice',
    'alice@example.com',
    'secret',
    '123456',
    'Alice the Great',
  );
  expectEqual(session?.displayName, 'Alice the Great');
  expectEqual(transport.calls[0]?.id, 'auth.register');
  const payload = transport.calls[0]?.payload as Record<string, unknown>;
  expectEqual(payload.username, 'alice');
  expectEqual(payload.email, 'alice@example.com');
  expectEqual(payload.code, '123456');
  expectEqual(payload.display_name, 'Alice the Great');
});

test('registerAccount falls back to the username when the display name is empty', async () => {
  const transport = new ScriptedTransport(() => ok(sessionPayload({ display_name: '' })));
  const client = new LobbyClient({ transport });
  const session = await client.registerAccount('bob', 'bob@example.com', 'secret', '654321');
  expectEqual(session?.displayName, 'bob');
});

test('registerAccount trims the address and the code', async () => {
  const transport = new ScriptedTransport(() => ok(sessionPayload()));
  const client = new LobbyClient({ transport });
  await client.registerAccount('bob', '  bob@example.com  ', 'secret', ' 123456 ');
  const payload = transport.calls[0]?.payload as Record<string, unknown>;
  expectEqual(payload.email, 'bob@example.com');
  expectEqual(payload.code, '123456');
});

test('requestEmailCode maps the server timing policy', async () => {
  const transport = new ScriptedTransport(() => ok(codePayload()));
  const client = new LobbyClient({ transport });
  const receipt = await client.requestEmailCode('alice@example.com');
  expect(receipt !== null, 'a receipt should come back');
  expectEqual(receipt?.email, 'alice@example.com');
  expectEqual(receipt?.expiresInSeconds, 600);
  expectEqual(receipt?.resendInSeconds, 60);
  expectEqual(transport.calls[0]?.id, 'auth.emailCode');
  expectEqual((transport.calls[0]?.payload as Record<string, unknown>).email, 'alice@example.com');
});

test('requestEmailCode surfaces a rate-limit failure as a code', async () => {
  const transport = new ScriptedTransport(() => ({
    ok: false,
    status: 429,
    error_code: 'verification_rate_limited',
  }));
  const client = new LobbyClient({ transport });
  expectEqual(await client.requestEmailCode('alice@example.com'), null);
  expectEqual(client.lastError, 'verification_rate_limited');
});

test('a rejected credential surfaces the server error code', async () => {
  const transport = new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' }));
  const client = new LobbyClient({ transport });
  expectEqual(await client.loginAccount('alice@example.com', 'wrong'), null);
  expectEqual(client.lastError, 'unauthorized');
  expectEqual(await client.registerAccount('alice', 'alice@example.com', 'secret', '123456'), null);
  expectEqual(client.lastError, 'unauthorized');
});

test('empty credentials are rejected locally without a request', async () => {
  const transport = new ScriptedTransport(() => ok(sessionPayload()));
  const client = new LobbyClient({ transport });
  expectEqual(await client.loginAccount('   ', 'secret'), null);
  expectEqual(client.lastError, 'account_email_required');
  expectEqual(await client.loginAccount('alice@example.com', ''), null);
  expectEqual(client.lastError, 'account_password_required');
  expectEqual(await client.registerAccount('', 'alice@example.com', 'secret', '123456'), null);
  expectEqual(client.lastError, 'account_username_required');
  expectEqual(await client.registerAccount('alice', '', 'secret', '123456'), null);
  expectEqual(client.lastError, 'account_email_required');
  expectEqual(await client.registerAccount('alice', 'alice@example.com', '', '123456'), null);
  expectEqual(client.lastError, 'account_password_required');
  // Registration without the mailed code never leaves the client.
  expectEqual(await client.registerAccount('alice', 'alice@example.com', 'secret', '  '), null);
  expectEqual(client.lastError, 'verification_code_required');
  expectEqual(await client.requestEmailCode('  '), null);
  expectEqual(client.lastError, 'account_email_required');
  expectEqual(transport.calls.length, 0);
});

test('logout clears the session and every per-session field', () => {
  const client = new LobbyClient({ transport: new ScriptedTransport(() => ok({})) });
  client.session = {
    sessionToken: 'tok-1',
    userId: 'u-1',
    playerId: 'p-1',
    displayName: 'Alice',
    characterId: 'reimu',
    rulesetVersion: 'rs-1',
    unlockedCharacterIds: [],
  };
  client.room = {
    roomCode: 'R1',
    hostUserId: 'u-1',
    modeId: 'm',
    allReady: false,
    rulesetVersion: 'rs-1',
    players: [],
    bossId: '',
    stageId: '',
    matchId: '',
  };
  client.allocation = {
    matchId: 'M1',
    modeId: 'm',
    battleServerId: 'bs-1',
    endpoint: '127.0.0.1:9000',
    serverSeedHex: 'ab',
  };
  client.ticket = {
    ticketId: 'T1',
    matchId: 'M1',
    playerId: 'p-1',
    modeId: 'm',
    battleServerId: 'bs-1',
    endpoint: '127.0.0.1:9000',
    rulesetVersion: 'rs-1',
    expiresAtMs: 1,
    signatureAlg: 'ed25519',
    keyId: 'k1',
    signatureHex: 'ff',
    raw: {},
  };
  client.matchmakingTicket = { ticketId: 'T1', modeId: 'm', queueStatus: 'queued', matchId: '', roomCode: '' };
  client.lastError = 'boom';

  client.logout();

  expectEqual(client.session, null);
  expectEqual(client.room, null);
  expectEqual(client.allocation, null);
  expectEqual(client.ticket, null);
  expectEqual(client.matchmakingTicket, null);
  expectEqual(client.lastError, '');
  expectEqual(client.lastResponse, null);
});

test('HTTP transport maps the account routes onto the Gensoulkyo REST paths', async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const http: HttpClient = {
    async request(method, path, body): Promise<HttpResponseLike> {
      seen.push({ method, path, body });
      return { status: 200, body: { ok: true, payload: sessionPayload() } };
    },
  };
  const transport = new HttpLobbyTransport(http);
  await transport.call({ id: 'auth.register', payload: { username: 'alice' } });
  await transport.call({ id: 'auth.login', payload: { email: 'alice@example.com' } });
  await transport.call({ id: 'auth.emailCode', payload: { email: 'alice@example.com' } });
  expectEqual(seen[0]?.path, '/v1/auth/register');
  expectEqual(seen[0]?.method, 'POST');
  expectEqual(seen[1]?.path, '/v1/auth/login');
  expectEqual(seen[1]?.method, 'POST');
  expectEqual(seen[2]?.path, '/v1/auth/email/code');
  expectEqual(seen[2]?.method, 'POST');
  expectEqual((seen[0]?.body as Record<string, unknown>)?.username, 'alice');
});

suite('account auth flow');

test('setAuthMode flips the form and clears the last error', () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(() => ok({})) }));
  flow.setAuthMode('register');
  expectEqual(flow.snapshot().authMode, 'register');
  expectEqual(flow.snapshot().lastError, '');
});

test('signInWithAccount lands on the lobby and keeps the session', async () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(authHandler) }));
  expectEqual(await flow.signInWithAccount('alice@example.com', 'secret'), true);
  expectEqual(flow.currentScreen, LobbyScreen.Lobby);
  expect(flow.snapshot().session !== null, 'session should be installed');
  expectEqual(flow.snapshot().session?.displayName, 'Alice');
  expectEqual(flow.snapshot().authEmail, 'alice@example.com');
});

test('signInWithAccount stays on the login screen when the server rejects', async () => {
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
    }),
  );
  expectEqual(await flow.signInWithAccount('alice@example.com', 'wrong'), false);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expect(flow.snapshot().lastError !== '', 'the failure reason should be shown');
  expectEqual(flow.snapshot().session, null);
});

test('signInWithAccount rejects empty credentials without a request', async () => {
  const transport = new ScriptedTransport(() => ok(sessionPayload()));
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.signInWithAccount('', ''), false);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expect(flow.snapshot().lastError !== '', 'the reason should be shown');
  expectEqual(transport.calls.length, 0);
});

test('requestEmailCode reports the resend window and echoes the address', async () => {
  const transport = new ScriptedTransport(authHandler);
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  const result = await flow.requestEmailCode(' alice@example.com ');
  expectEqual(result.ok, true);
  expectEqual(result.resendInSeconds, 60);
  expectEqual(flow.snapshot().authEmail, 'alice@example.com');
  expectEqual(flow.snapshot().lastError, '');
  expectEqual(transport.calls[0]?.id, 'auth.emailCode');
});

test('requestEmailCode surfaces a rate limit and returns no window', async () => {
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new ScriptedTransport(() => ({
        ok: false,
        status: 429,
        error_code: 'verification_rate_limited',
      })),
    }),
  );
  const result = await flow.requestEmailCode('alice@example.com');
  expectEqual(result.ok, false);
  expectEqual(result.resendInSeconds, 0);
  expectEqual(flow.snapshot().authErrorCode, 'verification_rate_limited');
  expectEqual(flow.snapshot().lastError, 'Please wait a moment before requesting another code');
});

test('requestEmailCode refuses an empty address without a request', async () => {
  const transport = new ScriptedTransport(authHandler);
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  const result = await flow.requestEmailCode('   ');
  expectEqual(result.ok, false);
  expect(flow.snapshot().lastError !== '', 'the reason should be shown');
  expectEqual(transport.calls.length, 0);
});

test('registerAccount signs the new account straight into the lobby', async () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(authHandler) }));
  expectEqual(await flow.registerAccount('alice', 'alice@example.com', 'secret', '123456', 'Alice'), true);
  expectEqual(flow.currentScreen, LobbyScreen.Lobby);
  expect(flow.snapshot().session !== null, 'session should be installed');
  expectEqual(flow.snapshot().authEmail, 'alice@example.com');
});

test('registerAccount refuses to submit without the mailed code', async () => {
  const transport = new ScriptedTransport(authHandler);
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.registerAccount('alice', 'alice@example.com', 'secret', '   '), false);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().authErrorCode, 'verification_code_required');
  expectEqual(flow.snapshot().lastError, 'Enter the 6-digit code we e-mailed you');
  expectEqual(transport.calls.length, 0);
});

test('registerAccount refuses to submit without the required fields', async () => {
  const transport = new ScriptedTransport(authHandler);
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.registerAccount('alice', '', 'secret', '123456'), false);
  expectEqual(transport.calls.length, 0);
  expect(flow.snapshot().lastError !== '', 'the reason should be shown');
});

test('signOut drops the session and returns to the login form', async () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(authHandler) }));
  await flow.signInWithAccount('alice@example.com', 'secret');
  flow.signOut();
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().session, null);
  expectEqual(flow.snapshot().authMode, 'login');
});

test('showLogin returns to the login form but keeps the session', async () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(authHandler) }));
  await flow.signInWithAccount('alice@example.com', 'secret');
  flow.showLogin();
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expect(flow.snapshot().session !== null, 'the session should survive showLogin');
});

test('a rejected sign-in keeps the raw code on the client and translates the player text', async () => {
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
    }),
  );
  expectEqual(await flow.signInWithAccount('alice@example.com', 'wrong'), false);
  expectEqual(flow.snapshot().authErrorCode, 'unauthorized');
  expectEqual(flow.snapshot().lastError, 'Wrong e-mail or password');
  expectEqual(flow.client.lastError, 'unauthorized', 'the raw code must not be rewritten');
});

test('a rejected registration reports the translated taken-address message', async () => {
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new ScriptedTransport(() => ({ ok: false, status: 400, error_code: 'account_email_taken' })),
    }),
  );
  expectEqual(await flow.registerAccount('alice', 'alice@example.com', 'secret', '123456'), false);
  expectEqual(flow.snapshot().authErrorCode, 'account_email_taken');
  expectEqual(flow.snapshot().lastError, 'That e-mail is already registered — sign in instead');
  expectEqual(flow.client.lastError, 'account_email_taken');
});

test('setAuthMode clears the auth error code', async () => {
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
    }),
  );
  await flow.signInWithAccount('alice@example.com', 'wrong');
  expectEqual(flow.snapshot().authErrorCode, 'unauthorized');
  flow.setAuthMode('register');
  expectEqual(flow.snapshot().authErrorCode, '');
});

test('signOut clears the auth error code', async () => {
  const flow = new LobbyFlow(
    new LobbyClient({
      transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
    }),
  );
  await flow.signInWithAccount('alice@example.com', 'wrong');
  flow.signOut();
  expectEqual(flow.snapshot().authErrorCode, '');
});

test('a successful sign-in leaves no auth error code', async () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(authHandler) }));
  expectEqual(await flow.signInWithAccount('alice@example.com', 'secret'), true);
  expectEqual(flow.snapshot().authErrorCode, '');
});

test('locally rejected empty credentials leave no auth error code', async () => {
  const flow = new LobbyFlow(new LobbyClient({ transport: new ScriptedTransport(() => ok({})) }));
  expectEqual(await flow.signInWithAccount('', ''), false);
  expectEqual(flow.snapshot().authErrorCode, '');
  expect(flow.snapshot().lastError !== '', 'the local reason should still be shown');
});
