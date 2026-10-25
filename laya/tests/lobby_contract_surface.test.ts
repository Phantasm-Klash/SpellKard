/**
 * Lobby contract-surface coverage for the shapes the E2E verified against the
 * real Nakama (`tmp/fix-lobby-e2e/report.md`):
 *
 *   - `rooms.get` / `RoomState` payloads spell the roster `participants`
 *     (`RoomParticipantSnapshot`), not `players`; the host is derived from
 *     `host_user_id` because the participant row carries no `host` flag; the
 *     room snapshot carries the `match_id` once the room filled.
 *   - `match.events` / `match.snapshot` are not registered client RPCs on the
 *     Nakama path — the transport must decode that failure cleanly.
 *   - `rooms.update` maps onto the REST bridge's `/v1/rooms/{code}/options`.
 *
 * These guard the client-side projections; the server side of each contract
 * lives in `Gensoulkyo/runtime/core` and is verified by the live E2E.
 */

import {
  HttpLobbyTransport,
  LobbyClient,
  NakamaLobbyTransport,
  roomViewFromState,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

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

/** A `RoomSnapshot` as the server emits it (participants, not players). */
const ROOM_SNAPSHOT = {
  ok: true,
  room_code: 'R692BD0D0',
  room_status: 'waiting',
  mode_id: 'mvp_boss_race',
  host_user_id: 'u-host',
  required_players: 2,
  current_players: 2,
  match_id: 'match-42',
  boss_id: 'tian',
  stage_id: 'stage-1',
  mode_ruleset_version: 'ruleset-local-s0',
  mode_params: { coop_players: '2' },
  participants: [
    {
      user_id: 'u-host',
      display_name: 'Host',
      ticket_id: 't-1',
      loadout: { character_id: 'reimu', shot_type: 'ReimuA1', bomb_type: 'Reimu' },
    },
    {
      user_id: 'u-guest',
      display_name: 'Guest',
      ticket_id: 't-2',
      loadout: { character_id: 'marisa' },
    },
  ],
};

suite('lobby contract surface (server-verified shapes)');

test('refreshRoom maps participants[] and derives the host from host_user_id', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'rooms.get' ? ok(ROOM_SNAPSHOT) : ok({ ok: true }),
  );
  const client = new LobbyClient({ transport });
  // Seed the room code the way createRoom does, then refresh it.
  await client.createRoom('', 'mvp_boss_race');
  const room = await client.refreshRoom();

  expect(room !== null, 'refreshRoom should return a view');
  expectEqual(room?.players.length, 2, 'participants[] must map onto the roster');
  expectEqual(room?.players[0]?.userId, 'u-host');
  expectEqual(room?.players[0]?.displayName, 'Host');
  expectEqual(room?.players[0]?.host, true, 'the participant matching host_user_id is the host');
  expectEqual(room?.players[1]?.host, false);
  expectEqual(room?.players[0]?.characterId, 'reimu');
  expectEqual(room?.players[0]?.shotType, 'ReimuA1');
  expectEqual(room?.players[0]?.bombType, 'Reimu');
  expectEqual(room?.players[1]?.characterId, 'marisa');
  expectEqual(room?.matchId, 'match-42', 'the room snapshot carries the match id once filled');
  expectEqual(room?.coopPlayers, 2, 'coop_players is read out of mode_params');
  expectEqual(room?.rulesetVersion, 'ruleset-local-s0', 'mode_ruleset_version is accepted');
});

test('roomViewFromState maps the pushed participants[] the same way', () => {
  const room = roomViewFromState(ROOM_SNAPSHOT);
  expectEqual(room.players.length, 2);
  expectEqual(room.players[0]?.host, true);
  expectEqual(room.players[1]?.host, false);
  expectEqual(room.matchId, 'match-42');
  expectEqual(room.roomCode, 'R692BD0D0');
});

test('a legacy players[] payload still maps, with host flags honoured verbatim', () => {
  const room = roomViewFromState({
    room_code: 'LEGACY1',
    host_user_id: 'u-a',
    players: [
      { user_id: 'u-a', display_name: 'A', host: true, connected: true, ready: true },
      { user_id: 'u-b', display_name: 'B', host: false, connected: false, ready: false },
    ],
  });
  expectEqual(room.players.length, 2);
  expectEqual(room.players[0]?.host, true);
  expectEqual(room.players[0]?.ready, true);
  expectEqual(room.players[1]?.connected, false);
  expectEqual(room.matchId, '');
});

test('the Nakama transport decodes an unregistered RPC (match.events) as a business rejection', async () => {
  // The runtime answers 404 "RPC function not found" for ops outside its
  // registry (`contractClientOperations`); the client must surface that as an
  // ordinary failure — never as a success and never as a thrown error.
  const http: HttpClient = {
    async request(): Promise<HttpResponseLike> {
      return { status: 404, body: { error: 'RPC function not found', message: 'RPC function not found', code: 5 } };
    },
  };
  const transport = new NakamaLobbyTransport(http, { sessionToken: 'jwt' });
  const client = new LobbyClient({ transport });
  const events = await client.fetchMatchEvents('match-42', 0, 10);
  expectEqual(events, null);
  expect(client.lastError !== '', 'the failure must be recorded');
  expect(!client.lastError.startsWith('lobby_transport_error'), 'a decoded rejection is not a transport error');
});

test('the HTTP transport maps rooms.update onto /v1/rooms/{code}/options', async () => {
  const seen: Array<{ method: string; path: string }> = [];
  const http: HttpClient = {
    async request(method, path): Promise<HttpResponseLike> {
      seen.push({ method, path });
      return { status: 200, body: { ok: true } };
    },
  };
  const transport = new HttpLobbyTransport(http);
  await transport.call({ id: 'rooms.update', payload: { room_code: 'R692BD0D0', boss_id: 'hui' } });
  expectDeepEqual(seen, [{ method: 'POST', path: '/v1/rooms/R692BD0D0/options' }]);
});
