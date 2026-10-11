/**
 * Single sign-on "session lost" coverage.
 *
 * When the same account signs in on a second device the lobby drops the older
 * session, pushes an `Error` frame carrying the frozen code `session_replaced`,
 * and closes the connection. These tests pin that the client:
 *   - has player-facing text for the code (`auth_messages`);
 *   - surfaces the proactive WS push as an event instead of swallowing it;
 *   - clears the session, flags the reason and returns to the login screen;
 *   - never reuses the replaced token for a later bootstrap/join;
 *   - treats an authenticated REST `401` carrying `session_replaced` the same
 *     way;
 *   - does NOT confuse a plain wrong-password `401` for a replaced session.
 *
 * They also pin the attribution of a *bare* authenticated `401`: a superseded
 * token, an expired token and a restarted lobby all answer `401`/`unauthorized`,
 * so the client must report `session_expired` rather than telling the player
 * their account was signed in elsewhere.
 */

import {
  HttpLobbyTransport,
  LobbyClient,
  SESSION_EXPIRED_CODE,
  SESSION_REPLACED_CODE,
  WsLobbyTransport,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { LOBBY_MESSAGE } from '../src/core/net/lobby_protocol';
import { LobbyFlow, LobbyScreen } from '../src/core/game/lobby_flow';
import { describeAuthError, isKnownAuthError } from '../src/core/game/auth_messages';
import type { SocketHandlers, SocketLike } from '../src/core/net/transport';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

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

/** Socket that records outbound frames and lets a test inject inbound ones. */
class FakeSocket implements SocketLike {
  connected = true;
  readonly sent: string[] = [];
  private handlers: SocketHandlers = {};

  send(data: string | Uint8Array): void {
    this.sent.push(typeof data === 'string' ? data : '');
  }

  close(): void {
    this.connected = false;
  }

  setHandlers(handlers: SocketHandlers): void {
    this.handlers = handlers;
  }

  deliver(text: string): void {
    this.handlers.onMessage?.(text);
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

/** Answers auth ops with a session and `bootstrap` with an empty profile. */
function authHandler(request: LobbyRpcRequest): LobbyRpcResponse {
  if (request.id === 'bootstrap') {
    return ok({ ruleset_version: 'rs-1' });
  }
  return ok(sessionPayload());
}

/** An `Error` envelope carrying the frozen code. */
function replacedErrorFrame(): string {
  return JSON.stringify({
    type: LOBBY_MESSAGE.Error,
    payload: { code: SESSION_REPLACED_CODE, message: 'signed in elsewhere' },
  });
}

suite('session_replaced message');

test('session_replaced has player-facing text and counts as a known error', () => {
  expectEqual(isKnownAuthError(SESSION_REPLACED_CODE), true);
  const text = describeAuthError(SESSION_REPLACED_CODE);
  expect(text !== SESSION_REPLACED_CODE, 'the code must be translated, not passed through');
  expect(text.includes('another device'), 'the text should say the account signed in elsewhere');
});

suite('session_replaced handling');

test('a session_replaced push clears the session and returns to the login screen', async () => {
  const transport = new ScriptedTransport(authHandler);
  const client = new LobbyClient({ transport });
  const flow = new LobbyFlow(client);

  expectEqual(await flow.signInWithAccount('alice', 'secret'), true);
  expectEqual(flow.currentScreen, LobbyScreen.Lobby);
  expect(client.session !== null, 'the sign-in should install a session');

  const callsBeforeKick = transport.calls.length;
  client.dispatchEvent({ kind: 'session_replaced' });

  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().session, null);
  expectEqual(flow.snapshot().authErrorCode, SESSION_REPLACED_CODE);
  expectEqual(flow.snapshot().sessionLost, true);
  expectEqual(flow.snapshot().lastError, describeAuthError(SESSION_REPLACED_CODE));
  // The kick is a local teardown: it must not fire a fresh network call.
  expectEqual(transport.calls.length, callsBeforeKick, 'the kick must not issue a request');
});

test('a replaced session is never reused for a later bootstrap or join', async () => {
  const transport = new ScriptedTransport(authHandler);
  const client = new LobbyClient({ transport });
  const flow = new LobbyFlow(client);
  await flow.signInWithAccount('alice', 'secret');

  client.dispatchEvent({ kind: 'session_replaced' });
  expectEqual(client.session, null);

  // Even if a later code path asks again, it must not carry the dead token.
  transport.calls.length = 0;
  await client.bootstrap();
  await client.joinRoom('RACE01');
  expect(transport.calls.length >= 2, 'the explicit calls should still reach the transport');
  for (const call of transport.calls) {
    expectEqual(call.session_id ?? '', '', 'the replaced token must not be reused');
    expectEqual(call.user_id ?? '', '', 'the replaced user id must not be reused');
  }
});

test('a second kick report is ignored once handled', async () => {
  const client = new LobbyClient({ transport: new ScriptedTransport(authHandler) });
  const flow = new LobbyFlow(client);
  await flow.signInWithAccount('alice', 'secret');

  client.dispatchEvent({ kind: 'session_replaced' });
  const first = flow.snapshot();
  // The WS push and a REST 401 can both report the same kick; the second must be
  // a no-op so the player-facing state does not churn.
  client.dispatchEvent({ kind: 'session_replaced' });
  expectDeepEqual(flow.snapshot(), first);
});

test('an authenticated REST 401 lands in the same handling', async () => {
  const http: HttpClient = {
    async request(_method, path): Promise<HttpResponseLike> {
      if (path === '/v1/bootstrap') {
        return { status: 401, body: { error_code: SESSION_REPLACED_CODE, message: 'signed in elsewhere' } };
      }
      return { status: 200, body: { ok: true, payload: sessionPayload() } };
    },
  };
  const client = new LobbyClient({ transport: new HttpLobbyTransport(http) });
  const flow = new LobbyFlow(client);

  // auth.login succeeds and installs a session; bootstrap then answers 401.
  expectEqual(await flow.signInWithAccount('alice', 'secret'), false);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().session, null);
  expectEqual(flow.snapshot().authErrorCode, SESSION_REPLACED_CODE);
  expectEqual(flow.snapshot().sessionLost, true);
});

test('a wrong-password 401 is not mistaken for a replaced session', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
  });
  const flow = new LobbyFlow(client);

  expectEqual(await flow.signInWithAccount('alice', 'wrong'), false);
  expectEqual(flow.snapshot().authErrorCode, 'unauthorized');
  expectEqual(flow.snapshot().sessionLost, false);
  expectEqual(flow.snapshot().lastError, describeAuthError('unauthorized'));
});

suite('session_replaced transport');

test('a proactive WS Error frame with session_replaced is surfaced as an event', () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const kinds: string[] = [];
  transport.onEvent((event) => kinds.push(event.kind));

  socket.deliver(replacedErrorFrame());

  expectDeepEqual(kinds, ['session_replaced']);
});

test('a WS Error frame with another code is not surfaced as a replacement', () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const kinds: string[] = [];
  transport.onEvent((event) => kinds.push(event.kind));

  socket.deliver(JSON.stringify({ type: LOBBY_MESSAGE.Error, payload: { code: 'unauthorized', message: 'no' } }));

  expectDeepEqual(kinds, []);
});

test('a WS Error frame while a call is in flight fails it and still reports the kick', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const kinds: string[] = [];
  transport.onEvent((event) => kinds.push(event.kind));

  const pending = transport.call({ id: 'bootstrap' });
  socket.deliver(replacedErrorFrame());

  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, SESSION_REPLACED_CODE);
  expect(kinds.includes('session_replaced'), 'the kick should still be reported');
});

test('the WS transport wiring clears the client session through LobbyFlow', () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const client = new LobbyClient({ transport });
  // Mirror the app wiring: transport events are forwarded to the client.
  transport.onEvent((event) => client.dispatchEvent(event));
  const flow = new LobbyFlow(client);

  client.session = {
    sessionToken: 'tok-1',
    userId: 'u-1',
    playerId: 'p-1',
    displayName: 'Alice',
    characterId: 'reimu',
    rulesetVersion: 'rs-1',
    unlockedCharacterIds: [],
  };

  socket.deliver(replacedErrorFrame());

  expectEqual(client.session, null);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().authErrorCode, SESSION_REPLACED_CODE);
  expectEqual(flow.snapshot().sessionLost, true);
});

suite('session_expired attribution');

test('session_expired has player-facing text and counts as a known error', () => {
  expectEqual(isKnownAuthError(SESSION_EXPIRED_CODE), true);
  const text = describeAuthError(SESSION_EXPIRED_CODE);
  expect(text !== SESSION_EXPIRED_CODE, 'the code must be translated, not passed through');
  expect(
    !text.includes('another device'),
    'an expiry must not tell the player the account was signed in elsewhere',
  );
});

test('a bare authenticated REST 401 is reported as an expiry, not a takeover', async () => {
  // This is exactly what the lobby answers for a superseded token over REST —
  // and for a token that simply aged out, and after a lobby restart. Only the
  // explicit `session_replaced` code may claim a takeover.
  const http: HttpClient = {
    async request(_method, path): Promise<HttpResponseLike> {
      if (path === '/v1/bootstrap') {
        return { status: 401, body: { error_code: 'unauthorized', message: 'invalid session token' } };
      }
      return { status: 200, body: { ok: true, payload: sessionPayload() } };
    },
  };
  const client = new LobbyClient({ transport: new HttpLobbyTransport(http) });
  const kinds: string[] = [];
  client.onEvent((event) => kinds.push(event.kind));
  const flow = new LobbyFlow(client);

  expectEqual(await flow.signInWithAccount('alice', 'secret'), false);
  expectDeepEqual(kinds, ['session_expired']);
  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().session, null);
  expectEqual(flow.snapshot().authErrorCode, SESSION_EXPIRED_CODE);
  expectEqual(flow.snapshot().sessionLost, true);
  expectEqual(flow.snapshot().lastError, describeAuthError(SESSION_EXPIRED_CODE));
});

test('an explicit session_replaced code is not downgraded to an expiry', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport((request) =>
      request.id === 'bootstrap'
        ? { ok: false, status: 401, error_code: SESSION_REPLACED_CODE }
        : ok(sessionPayload()),
    ),
  });
  const kinds: string[] = [];
  client.onEvent((event) => kinds.push(event.kind));
  const flow = new LobbyFlow(client);

  expectEqual(await flow.signInWithAccount('alice', 'secret'), false);
  expectDeepEqual(kinds, ['session_replaced']);
  expectEqual(flow.snapshot().authErrorCode, SESSION_REPLACED_CODE);
});

test('a bare 401 without a session is not a session loss', async () => {
  // The login endpoints answer bad credentials with the same status; reporting
  // that as a lost session would bounce the player out of the form they are
  // still filling in.
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
  });
  const kinds: string[] = [];
  client.onEvent((event) => kinds.push(event.kind));

  expectEqual(await client.loginAccount('alice', 'wrong'), null);
  expectDeepEqual(kinds, []);
});

test('a session_expired event clears the session and returns to the login screen', async () => {
  const transport = new ScriptedTransport(authHandler);
  const client = new LobbyClient({ transport });
  const flow = new LobbyFlow(client);
  expectEqual(await flow.signInWithAccount('alice', 'secret'), true);
  expectEqual(flow.currentScreen, LobbyScreen.Lobby);

  const callsBefore = transport.calls.length;
  client.dispatchEvent({ kind: 'session_expired' });

  expectEqual(flow.currentScreen, LobbyScreen.Login);
  expectEqual(flow.snapshot().session, null);
  expectEqual(flow.snapshot().authErrorCode, SESSION_EXPIRED_CODE);
  expectEqual(flow.snapshot().sessionLost, true);
  expectEqual(flow.snapshot().lastError, describeAuthError(SESSION_EXPIRED_CODE));
  expectEqual(transport.calls.length, callsBefore, 'the teardown must not issue a request');
});
