/**
 * T10 client-half tests: the explicit abandon intent and the auto-reconnect on
 * entering a match.
 *
 * The lobby owns every outcome (who wins, whether a score moves, whether both
 * sides fled); these pin only the two client behaviours — send the typed intent
 * and leave, and resync the tick the server returned — plus the "never pretend
 * to be alive" failure paths.
 */

import { BattleClient, type BattleSessionInfo } from '../src/core/net/battle_client';
import {
  LobbyClient,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { LobbyFlow, LobbyScreen, type MatchStartInfo } from '../src/core/game/lobby_flow';
import { bossRaceSeedFromU32 } from '../src/core/math/boss_race_seed';
import { OfflineDatagramFactory, type TimerLike } from '../src/core/net/transport';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

/** A lobby transport whose replies are scripted per operation id. */
class ScriptedLobbyTransport implements LobbyTransport {
  readonly calls: LobbyRpcRequest[] = [];
  private readonly responses = new Map<string, LobbyRpcResponse>();

  script(id: string, response: LobbyRpcResponse): void {
    this.responses.set(id, response);
  }

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    this.calls.push(request);
    return this.responses.get(request.id) ?? { ok: false, status: 404, error_code: 'unscripted' };
  }

  close(): void {
    // nothing to release
  }

  countOf(id: string): number {
    return this.calls.filter((call) => call.id === id).length;
  }

  payloadOf(id: string): Record<string, unknown> | undefined {
    return this.calls.find((call) => call.id === id)?.payload;
  }
}

/** The battle client only needs a clock; this one never fires. */
class NullTimer implements TimerLike {
  now(): number {
    return 0;
  }
  setInterval(): number {
    return 1;
  }
  clearInterval(): void {}
  setTimeout(): number {
    return 1;
  }
  clearTimeout(): void {}
}

function sessionInfo(playerId: string, playerIds: string[]): BattleSessionInfo {
  return {
    matchId: 'match-1',
    playerId,
    playerIds,
    modeId: 'mvp_boss_race',
    rulesetVersion: 'mvp-boss-race-s0',
    endpoint: 'udp://battle:9000',
    serverSeed: bossRaceSeedFromU32(12345),
  };
}

function matchInfo(): MatchStartInfo {
  return {
    matchId: 'm-1',
    serverSeedHex: '0000000000003039',
    endpoint: 'udp://battle:9000',
    playerIds: ['p-1', 'p-2'],
    playerId: 'p-1',
    modeId: 'mvp_boss_race',
    rulesetVersion: 'ruleset-local-s0',
  };
}

/** A match snapshot whose local (first) player reports `connected`. */
function snapshotResponse(connected: boolean): LobbyRpcResponse {
  return {
    ok: true,
    status: 200,
    payload: {
      match_id: 'm-1',
      stage_id: 'stage-1',
      players: [{ user_id: 'u-1', connected, loadout: { character_id: 'reimu' } }],
      active_cards: [],
    },
  };
}

suite('client disconnect (T10)');

test('disconnectMatch posts the typed abandon intent and projects the lobby view', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.disconnect', {
    ok: true,
    status: 200,
    payload: { match_id: 'm-1', reconnect_status: 'abandoned', connected: false, tick: 42 },
  });
  const client = new LobbyClient({ transport });

  const view = await client.disconnectMatch('m-1', 'abandon');

  expectEqual(transport.calls[0]?.id, 'match.disconnect');
  expectDeepEqual(transport.payloadOf('match.disconnect'), { match_id: 'm-1', intent: 'abandon' });
  expectEqual(view?.status, 'abandoned');
  expectEqual(view?.connected, false);
  expectEqual(view?.tick, 42);
});

test('disconnectMatch defaults to the passive drop intent', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.disconnect', {
    ok: true,
    status: 200,
    payload: { match_id: 'm-1', reconnect_status: 'disconnected', connected: false, tick: 7 },
  });
  const client = new LobbyClient({ transport });

  await client.disconnectMatch('m-1');

  expectDeepEqual(transport.payloadOf('match.disconnect'), { match_id: 'm-1', intent: 'drop' });
});

test('abandonMatch leaves the match through the existing navigation on success', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.disconnect', {
    ok: true,
    status: 200,
    payload: { match_id: 'm-1', reconnect_status: 'abandoned', connected: false, tick: 42 },
  });
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  flow.enterBattle(matchInfo());
  expectEqual(flow.currentScreen, LobbyScreen.Battle, 'starts on the battle screen');

  const ok = await flow.abandonMatch();

  expectEqual(ok, true);
  expectEqual(flow.currentScreen, LobbyScreen.Lobby, 'leaves the match on success');
  expectEqual(flow.snapshot().match, null, 'the match is cleared');
});

test('abandonMatch surfaces a failure and stays on the battle screen', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.disconnect', { ok: false, status: 409, error_code: 'match_state' });
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  flow.enterBattle(matchInfo());

  const ok = await flow.abandonMatch();

  expectEqual(ok, false);
  expectEqual(flow.currentScreen, LobbyScreen.Battle, 'a failure must not leave the match');
  expect(flow.snapshot().lastError.includes('match_state'), 'the reason is surfaced');
});

test('reconnectMatch reads the tick from the top level and its window', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.reconnect', {
    ok: true,
    status: 200,
    payload: {
      match_id: 'm-1',
      reconnect_status: 'restored',
      connected: true,
      tick: 420,
      snapshot: { tick: 419 },
      seconds_left: 12,
    },
  });
  const client = new LobbyClient({ transport });

  const view = await client.reconnectMatch('m-1');

  expectEqual(view?.status, 'restored');
  expectEqual(view?.connected, true);
  expectEqual(view?.tick, 420);
  expectEqual(view?.secondsLeft, 12);
});

test('reconnectMatch falls back to snapshot.tick when the top-level tick is absent', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.reconnect', {
    ok: true,
    status: 200,
    payload: { match_id: 'm-1', reconnect_status: 'restored', connected: true, snapshot: { tick: 77 } },
  });
  const client = new LobbyClient({ transport });

  const view = await client.reconnectMatch('m-1');

  expectEqual(view?.tick, 77, 'the snapshot tick is the value that carries today');
});

test('resumeMatch does not reconnect a connected player', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.snapshot', snapshotResponse(true));
  transport.script('match.reconnect', {
    ok: true,
    status: 200,
    payload: { reconnect_status: 'restored', connected: true, tick: 100 },
  });
  const flow = new LobbyFlow(new LobbyClient({ transport }));

  const tick = await flow.resumeMatch('m-1');

  expectEqual(tick, null, 'a connected player has nothing to resume');
  expectEqual(transport.countOf('match.reconnect'), 0, 'no reconnect call is made');
});

test('resumeMatch reconnects a disconnected player and returns the server tick', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.snapshot', snapshotResponse(false));
  transport.script('match.reconnect', {
    ok: true,
    status: 200,
    payload: { reconnect_status: 'restored', connected: true, tick: 300 },
  });
  const flow = new LobbyFlow(new LobbyClient({ transport }));

  const tick = await flow.resumeMatch('m-1');

  expectEqual(transport.countOf('match.reconnect'), 1, 'exactly one reconnect call');
  expectEqual(tick, 300, 'the server tick reaches the caller');
});

test('resumeMatch leaves the player disconnected when the reconnect fails', async () => {
  const transport = new ScriptedLobbyTransport();
  transport.script('match.snapshot', snapshotResponse(false));
  transport.script('match.reconnect', { ok: false, status: 409, error_code: 'reconnect_expired' });
  const flow = new LobbyFlow(new LobbyClient({ transport }));

  const tick = await flow.resumeMatch('m-1');

  expectEqual(tick, null, 'a failed reconnect must not pretend to be alive');
});

test('resyncTick adopts the server tick forward only and revives the local player', () => {
  const client = new BattleClient({ datagramFactory: new OfflineDatagramFactory(), timer: new NullTimer() });
  expectEqual(client.resyncTick(120), false, 'nothing to resync before connect');
  expectEqual(client.connect(sessionInfo('p-1', ['p-1', 'p-2'])), true);
  expectEqual(client.simulationRef?.getCurrentTick(), 0, 'a fresh prediction starts at tick 0');

  expectEqual(client.resyncTick(120), true);
  expectEqual(client.simulationRef?.getCurrentTick(), 120, 'the local tick adopts the server value');

  // The player died on drop; the resync presents them alive again.
  client.simulationRef?.setPlayerConnected('p-1', false);
  expectEqual(
    client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1')?.connected,
    false,
  );
  expectEqual(client.resyncTick(200), true);
  expectEqual(
    client.simulationRef?.snapshot().players.find((player) => player.playerId === 'p-1')?.connected,
    true,
    'the local player is marked connected again',
  );

  // A stale (lower) server tick must never rewind the prediction.
  expectEqual(client.resyncTick(30), true);
  expectEqual(client.simulationRef?.getCurrentTick(), 200, 'the tick never moves backwards');

  expectEqual(client.resyncTick(0), false, 'a non-positive tick is refused');
  client.close();
});
