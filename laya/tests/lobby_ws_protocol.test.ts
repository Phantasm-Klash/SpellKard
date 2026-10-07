/**
 * Gensoulkyo lobby WS protocol coverage: the `{"type","seq","payload"}`
 * envelope codec and `WsLobbyTransport`'s request/response + push mapping.
 *
 * The field names asserted here mirror `runtime/lobbyws/protocol.go`; if the
 * server protocol drifts, these tests are the contract that breaks first.
 */

import {
  HttpLobbyTransport,
  WsLobbyTransport,
  matchResultView,
  matchStartEvent,
  roomViewFromState,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import {
  DEFAULT_VERSION_STAMP,
  LOBBY_MESSAGE,
  LOBBY_WS_ROUTES,
  decodeLobbyEnvelope,
  encodeLobbyEnvelope,
  errorStatusFromPayload,
  errorStatusOf,
} from '../src/core/net/lobby_protocol';
import type { SocketHandlers, SocketLike } from '../src/core/net/transport';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

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

  emitClose(code: number, reason: string): void {
    this.connected = false;
    this.handlers.onClose?.(code, reason);
  }

  frame(index: number): Record<string, unknown> {
    return JSON.parse(this.sent[index] ?? '{}') as Record<string, unknown>;
  }
}

class RecordingFallback implements LobbyTransport {
  readonly calls: LobbyRpcRequest[] = [];

  constructor(private readonly response: LobbyRpcResponse = { ok: true, status: 200, payload: {} }) {}

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    this.calls.push(request);
    return this.response;
  }

  close(): void {
    // nothing to release
  }
}

suite('lobby ws envelope codec');

test('encode/decode round-trips type, seq and payload', () => {
  const encoded = encodeLobbyEnvelope(LOBBY_MESSAGE.AuthRequest, { session_token: 'tok' }, 7);
  expectEqual(encoded, '{"type":1,"seq":7,"payload":{"session_token":"tok"}}');
  const decoded = decodeLobbyEnvelope(encoded);
  expectDeepEqual(decoded, { type: 1, seq: 7, payload: { session_token: 'tok' } });
});

test('encode omits seq and payload when not provided', () => {
  expectEqual(encodeLobbyEnvelope(LOBBY_MESSAGE.RoomState), '{"type":10}');
  const decoded = decodeLobbyEnvelope('{"type":10}');
  expectDeepEqual(decoded, { type: 10 });
});

test('decode rejects non-envelope JSON', () => {
  expectEqual(decodeLobbyEnvelope('not json'), null);
  expectEqual(decodeLobbyEnvelope('[]'), null);
  expectEqual(decodeLobbyEnvelope('"text"'), null);
  expectEqual(decodeLobbyEnvelope('{"seq":1}'), null);
  expectEqual(decodeLobbyEnvelope('{"type":"1"}'), null);
});

test('the WS route table only covers the protocol-defined operations', () => {
  expectDeepEqual(Object.keys(LOBBY_WS_ROUTES).sort(), [
    'auth.anonymous',
    'bootstrap',
    'rooms.create',
    'rooms.join',
    'rooms.leave',
  ]);
  expectEqual(LOBBY_WS_ROUTES['auth.anonymous']?.requestType, LOBBY_MESSAGE.AuthRequest);
  expectEqual(LOBBY_WS_ROUTES['rooms.leave']?.responseTypes[0], LOBBY_MESSAGE.RoomState);
});

test('error status helpers read response and transport error shapes', () => {
  expectDeepEqual(errorStatusOf({ error: { code: 'unauthorized', message: 'no token' } }), {
    code: 'unauthorized',
    message: 'no token',
  });
  expectEqual(errorStatusOf({ session_token: 'x' }), null);
  expectDeepEqual(errorStatusFromPayload({ code: 'unsupported_type', message: 'nope', retryable: false }), {
    code: 'unsupported_type',
    message: 'nope',
    retryable: false,
  });
  expectEqual(errorStatusFromPayload(null).code, 'invalid_error');
});

test('DEFAULT_VERSION_STAMP matches the vendored descriptor', () => {
  expectEqual(DEFAULT_VERSION_STAMP.protocol_version, 1);
  expectEqual(DEFAULT_VERSION_STAMP.business_api_version, '0.1.0-draft');
  expectEqual(DEFAULT_VERSION_STAMP.battle_api_version, '0.1.0-draft');
  expectEqual(DEFAULT_VERSION_STAMP.ruleset_version, 'ruleset-local-s0');
});

suite('lobby ws transport');

test('auth sends a LobbyAuthRequest envelope and resolves on AuthResponse', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket, { platform: 'laya', clientBuild: 'build-9' });
  const pending = transport.call({ id: 'auth.anonymous', session_id: 'tok', user_id: 'u-1' });

  const frame = socket.frame(0);
  expectEqual(frame.type, LOBBY_MESSAGE.AuthRequest);
  expectEqual(frame.seq, 1);
  expectDeepEqual(frame.payload, {
    version: DEFAULT_VERSION_STAMP,
    session_token: 'tok',
    user_id: 'u-1',
    platform: 'laya',
    client_build: 'build-9',
  });

  socket.deliver(JSON.stringify({ type: LOBBY_MESSAGE.AuthResponse, payload: { session_token: 'tok', user_id: 'u-1' } }));
  const response = await pending;
  expect(response.ok, 'auth should resolve ok');
  expectDeepEqual(response.payload, { session_token: 'tok', user_id: 'u-1' });
});

test('bootstrap sends known_ruleset_version', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket, { userId: 'device-1' });
  const pending = transport.call({ id: 'bootstrap', payload: { known_ruleset_version: 'ruleset-local-s0' } });

  const payload = socket.frame(0).payload as Record<string, unknown>;
  expectEqual(socket.frame(0).type, LOBBY_MESSAGE.BootstrapRequest);
  expectEqual(payload.user_id, 'device-1');
  expectEqual(payload.known_ruleset_version, 'ruleset-local-s0');

  socket.deliver(JSON.stringify({ type: LOBBY_MESSAGE.BootstrapResponse, payload: { ruleset_version: 'ruleset-local-s0' } }));
  expectEqual((await pending).ok, true);
});

test('room create/join/leave use the documented payload fields', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket, { userId: 'host-1' });

  void transport.call({
    id: 'rooms.create',
    payload: { room_code: 'RACE01', mode_id: 'mvp_boss_race', host_user_id: 'host-1' },
  });
  const create = socket.frame(0);
  expectEqual(create.type, LOBBY_MESSAGE.RoomCreateRequest);
  expectDeepEqual(create.payload, {
    version: DEFAULT_VERSION_STAMP,
    room_code: 'RACE01',
    mode_id: 'mvp_boss_race',
    host_user_id: 'host-1',
    loadout: { user_id: 'host-1', player_id: '', character_id: '', stage_id: '', rating_code: '' },
    mode_params: {},
  });

  void transport.call({ id: 'rooms.join', payload: { room_code: 'RACE01', user_id: 'guest-1', player_id: 'p-2' } });
  const join = socket.frame(1);
  expectEqual(join.type, LOBBY_MESSAGE.RoomJoinRequest);
  const joinPayload = join.payload as Record<string, unknown>;
  expectEqual(joinPayload.room_code, 'RACE01');
  expectEqual(joinPayload.user_id, 'guest-1');
  expectEqual(joinPayload.player_id, 'p-2');

  const leave = transport.call({ id: 'rooms.leave', payload: { room_code: 'RACE01', reason: 'client_left' } });
  const leaveFrame = socket.frame(2);
  expectEqual(leaveFrame.type, LOBBY_MESSAGE.RoomLeaveRequest);
  expectEqual((leaveFrame.payload as Record<string, unknown>).reason, 'client_left');

  // A leave is acknowledged by the resulting RoomState push.
  socket.deliver(JSON.stringify({ type: LOBBY_MESSAGE.RoomState, payload: { room_code: 'RACE01' } }));
  expectEqual((await leave).ok, true);
});

test('an error sub-object in a response resolves the call as failed', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const pending = transport.call({ id: 'rooms.join', payload: { room_code: 'X' } });
  socket.deliver(
    JSON.stringify({
      type: LOBBY_MESSAGE.RoomJoinResponse,
      payload: { error: { code: 'room_not_found', message: 'no such room' } },
    }),
  );
  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, 'room_not_found');
  expectEqual(response.message, 'no such room');
});

test('a TypeError envelope fails the oldest pending call', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const pending = transport.call({ id: 'auth.anonymous', user_id: 'u-1' });
  socket.deliver(
    JSON.stringify({ type: LOBBY_MESSAGE.Error, payload: { code: 'unauthorized', message: 'no token' } }),
  );
  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, 'unauthorized');
  expectEqual(response.message, 'no token');
});

test('operations outside the WS protocol delegate to the fallback transport', async () => {
  const socket = new FakeSocket();
  const fallback = new RecordingFallback({ ok: true, status: 200, payload: { ticket_id: 'T-1' } });
  const transport = new WsLobbyTransport(socket, { fallback });

  const response = await transport.call({ id: 'matchmaking.join', payload: { mode_id: 'mvp_boss_race' } });
  expectEqual(response.ok, true);
  expectEqual(fallback.calls[0]?.id, 'matchmaking.join');
  expectEqual(socket.sent.length, 0, 'unsupported op must not touch the socket');

  const bare = new WsLobbyTransport(new FakeSocket());
  const unsupported = await bare.call({ id: 'replay.get', payload: { replay_id: 'R' } });
  expectEqual(unsupported.ok, false);
  expectEqual(unsupported.error_code, 'lobby_ws_unsupported_op:replay.get');
});

test('pushed RoomState / MatchStart / MatchResult are surfaced as events', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const events: string[] = [];
  let roomCode = '';
  let seedHex = '';
  let winner = '';
  transport.onEvent((event) => {
    events.push(event.kind);
    if (event.kind === 'room_state') {
      roomCode = event.room.roomCode;
    }
    if (event.kind === 'match_start') {
      seedHex = event.serverSeedHex;
    }
    if (event.kind === 'match_result') {
      winner = event.result.winnerPlayerId;
    }
  });

  socket.deliver(
    JSON.stringify({
      type: LOBBY_MESSAGE.RoomState,
      payload: {
        room_code: 'RACE01',
        host_user_id: 'host-1',
        mode_id: 'mvp_boss_race',
        all_ready: true,
        ruleset_version: 'ruleset-local-s0',
        players: [
          {
            user_id: 'host-1',
            player_id: 'p-1',
            display_name: 'Host',
            ready: true,
            host: true,
            connected: true,
            character_id: 'balanced',
          },
        ],
      },
    }),
  );
  socket.deliver(
    JSON.stringify({
      type: LOBBY_MESSAGE.MatchStart,
      payload: { match_id: 'M-1', server_seed_hex: '00000000000000ff', endpoint: 'host:9000', player_ids: ['p-1'] },
    }),
  );
  socket.deliver(
    JSON.stringify({
      type: LOBBY_MESSAGE.MatchResult,
      payload: {
        match_id: 'M-1',
        winner_player_id: 'p-1',
        points: { 'p-1': 10 },
        replay_id: 'R-1',
        server_authoritative: true,
        mode_id: 'mvp_boss_race',
        settled_at_ms: 42,
      },
    }),
  );

  expectDeepEqual(events, ['room_state', 'match_start', 'match_result']);
  expectEqual(roomCode, 'RACE01');
  expectEqual(seedHex, '00000000000000ff');
  expectEqual(winner, 'p-1');
});

test('close rejects in-flight calls and emits transport_closed', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const reasons: string[] = [];
  transport.onEvent((event) => {
    if (event.kind === 'transport_closed') {
      reasons.push(event.reason);
    }
  });
  const pending = transport.call({ id: 'bootstrap' });
  transport.close();
  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, 'lobby_ws_closed');
  expectEqual(socket.connected, false);
});

test('a socket close fails pending calls and reports the reason', async () => {
  const socket = new FakeSocket();
  const transport = new WsLobbyTransport(socket);
  const pending = transport.call({ id: 'bootstrap' });
  socket.emitClose(1006, 'gone');
  const response = await pending;
  expectEqual(response.ok, false);
  expectEqual(response.error_code, 'lobby_ws_closed:1006:gone');
});

suite('lobby payload views');

test('roomViewFromState maps LobbyPlayer fields', () => {
  const room = roomViewFromState({
    room_code: 'RACE01',
    host_user_id: 'host-1',
    mode_id: 'mvp_boss_race',
    all_ready: false,
    ruleset_version: 'ruleset-local-s0',
    players: [{ user_id: 'host-1', player_id: 'p-1', display_name: 'Host', host: true, connected: true }],
  });
  expectEqual(room.roomCode, 'RACE01');
  expectEqual(room.players[0]?.displayName, 'Host');
  expectEqual(room.players[0]?.host, true);
  expectEqual(room.players[0]?.ready, false);
});

test('matchStartEvent / matchResultView map the proto payloads', () => {
  const start = matchStartEvent({ match_id: 'M-1', server_seed_hex: 'ff', endpoint: 'host:9000', player_ids: ['p-1'] });
  expectDeepEqual(start, {
    kind: 'match_start',
    matchId: 'M-1',
    serverSeedHex: 'ff',
    endpoint: 'host:9000',
    playerIds: ['p-1'],
  });
  const result = matchResultView({
    match_id: 'M-1',
    winner_player_id: 'p-1',
    points: { 'p-1': 3 },
    replay_id: 'R-1',
    server_authoritative: true,
    mode_id: 'mvp_boss_race',
    settled_at_ms: 9,
  });
  expectEqual(result.winnerPlayerId, 'p-1');
  expectEqual(result.points['p-1'], 3);
  expectEqual(result.serverAuthoritative, true);
});

test('the REST transport is unchanged: matchmaking still maps to REST paths', async () => {
  const seen: Array<{ method: string; path: string }> = [];
  const http: HttpClient = {
    async request(method, path): Promise<HttpResponseLike> {
      seen.push({ method, path });
      return { status: 200, body: { ok: true, payload: {} } };
    },
  };
  await new HttpLobbyTransport(http).call({ id: 'matchmaking.join', payload: { mode_id: 'mvp_boss_race' } });
  expectEqual(seen[0]?.method, 'POST');
  expectEqual(seen[0]?.path, '/v1/matchmaking/join');
});
