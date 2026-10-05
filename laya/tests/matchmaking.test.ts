/**
 * Matchmaking queue coverage: `LobbyClient.joinMatchmaking` / `.ticket` /
 * `.cancel` payload mapping, the REST route table, the `LobbyFlow` queue
 * actions and the lobby's queue status line.
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
import { LobbyFlow, describeMatchmakingQueue, LobbyScreen } from '../src/core/game/lobby_flow';
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

suite('matchmaking queue');

test('joinMatchmaking stores the queue ticket from the response', async () => {
  const transport = new ScriptedTransport(() =>
    ok({ ticket_id: 'T-1', queue_status: 'queued', mode_id: 'mvp_boss_race' }),
  );
  const client = new LobbyClient({ transport });
  const ticket = await client.joinMatchmaking('mvp_boss_race');
  expect(ticket !== null, 'join should return a ticket');
  expectEqual(ticket?.ticketId, 'T-1');
  expectEqual(ticket?.queueStatus, 'queued');
  expectEqual(client.matchmakingTicket?.ticketId, 'T-1');
  expectEqual(transport.calls[0]?.id, 'matchmaking.join');
  expectEqual((transport.calls[0]?.payload as Record<string, unknown>)?.mode_id, 'mvp_boss_race');
});

test('joinMatchmaking defaults the queue status and surfaces failures', async () => {
  const failing = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 409, error_code: 'queue_full' })),
  });
  expectEqual(await failing.joinMatchmaking(), null);
  expectEqual(failing.lastError, 'queue_full');
  expectEqual(failing.matchmakingTicket, null);

  const bare = new LobbyClient({
    transport: new ScriptedTransport(() => ok({ ticket_id: 'T-2' })),
  });
  const ticket = await bare.joinMatchmaking('duel');
  expectEqual(ticket?.queueStatus, 'queued');
  expectEqual(ticket?.modeId, 'duel');
});

test('fetchMatchmakingTicket polls the stored ticket and maps a found match', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'matchmaking.join'
      ? ok({ ticket_id: 'T-9', queue_status: 'queued' })
      : ok({ ticket_id: 'T-9', queue_status: 'matched', match_id: 'M-7', room_code: 'RACE01' }),
  );
  const client = new LobbyClient({ transport });
  await client.joinMatchmaking();
  const updated = await client.fetchMatchmakingTicket();
  expectEqual(updated?.queueStatus, 'matched');
  expectEqual(updated?.matchId, 'M-7');
  expectEqual(updated?.roomCode, 'RACE01');
  expectEqual((transport.calls[1]?.payload as Record<string, unknown>)?.ticket_id, 'T-9');
});

test('fetchMatchmakingTicket without a ticket fails instead of calling the server', async () => {
  const transport = new ScriptedTransport(() => ok({}));
  const client = new LobbyClient({ transport });
  expectEqual(await client.fetchMatchmakingTicket(), null);
  expectEqual(client.lastError, 'matchmaking_ticket_missing_id');
  expectEqual(transport.calls.length, 0);
});

test('cancelMatchmaking clears the queue ticket', async () => {
  const transport = new ScriptedTransport(() => ok({ ticket_id: 'T-3', queue_status: 'cancelled' }));
  const client = new LobbyClient({ transport });
  await client.joinMatchmaking();
  expectEqual(await client.cancelMatchmaking(), true);
  expectEqual(client.matchmakingTicket, null);
  expectEqual(transport.calls[1]?.id, 'matchmaking.cancel');
  expectEqual((transport.calls[1]?.payload as Record<string, unknown>)?.ticket_id, 'T-3');
});

test('a match start clears the queue ticket', async () => {
  const client = new LobbyClient({ transport: new ScriptedTransport(() => ok({ ticket_id: 'T-4' })) });
  await client.joinMatchmaking();
  client.applyMatchStart({ matchId: 'M-1', endpoint: '127.0.0.1:9000' });
  expectEqual(client.matchmakingTicket, null);
});

test('HTTP transport maps the matchmaking routes onto the Gensoulkyo REST paths', async () => {
  const seen: Array<{ method: string; path: string }> = [];
  const http: HttpClient = {
    async request(method, path): Promise<HttpResponseLike> {
      seen.push({ method, path });
      return { status: 200, body: { ok: true, payload: { ticket_id: 'T-5', queue_status: 'queued' } } };
    },
  };
  const transport = new HttpLobbyTransport(http);
  await transport.call({ id: 'matchmaking.join', payload: { mode_id: 'mvp_boss_race' } });
  await transport.call({ id: 'matchmaking.ticket', payload: { ticket_id: 'T-5' } });
  await transport.call({ id: 'matchmaking.cancel', payload: { ticket_id: 'T-5' } });
  expectEqual(seen[0]?.path, '/v1/matchmaking/join');
  expectEqual(seen[0]?.method, 'POST');
  expectEqual(seen[1]?.path, '/v1/matchmaking/tickets/T-5');
  expectEqual(seen[1]?.method, 'GET');
  expectEqual(seen[2]?.path, '/v1/matchmaking/tickets/T-5/cancel');
  expectEqual(seen[2]?.method, 'POST');
});

test('LobbyFlow drives the queue and reports it on the lobby screen', async () => {
  const transport = new ScriptedTransport((request) =>
    request.id === 'matchmaking.cancel'
      ? ok({ ticket_id: 'T-6', queue_status: 'cancelled' })
      : ok({ ticket_id: 'T-6', queue_status: 'queued', mode_id: 'mvp_boss_race' }),
  );
  const flow = new LobbyFlow(new LobbyClient({ transport }));

  expectEqual(await flow.joinMatchmaking(), true);
  expect(flow.currentScreen !== LobbyScreen.Matching, 'queueing stays on the lobby screen');
  const queued = flow.snapshot();
  expectEqual(queued.matchmaking?.ticketId, 'T-6');
  expectEqual(describeMatchmakingQueue(queued), 'Matchmaking queue: queued\nticket T-6 · mvp_boss_race');

  expectEqual(await flow.cancelMatchmaking(), true);
  expectEqual(flow.snapshot().matchmaking, null);
  expectEqual(describeMatchmakingQueue(flow.snapshot()), 'Matchmaking queue: idle');
});

test('LobbyFlow reports a missing queue instead of calling cancel', async () => {
  const transport = new ScriptedTransport(() => ok({}));
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.cancelMatchmaking(), false);
  expectEqual(await flow.refreshMatchmakingTicket(), false);
  expectEqual(transport.calls.length, 0);
});
