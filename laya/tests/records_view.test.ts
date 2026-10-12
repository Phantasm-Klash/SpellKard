/**
 * Personal-records coverage: `LobbyClient.fetchRecords` payload mapping (the
 * `RecordsView` from `card_records_spec.md` §2.3), the `records.get` REST route,
 * the `LobbyFlow` records screen, and the `ActiveCardSnapshot` accessor that
 * carries the new `pattern_id` / `purge_radius` / `purge_count` / `target_user_id`
 * fields plus the `started_tick` / `expires_tick` window the wire really sends.
 */

import {
  HttpLobbyTransport,
  LobbyClient,
  activeCardDurationTicks,
  activeCardRemainingTicks,
  activeCardSnapshotFromPayload,
  type HttpClient,
  type HttpResponseLike,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';
import { LobbyFlow, LobbyScreen } from '../src/core/game/lobby_flow';
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

function ok(payload: unknown): LobbyRpcResponse {
  return { ok: true, status: 200, payload };
}

/** The contract's `GET /v1/records` body. */
const RECORDS_BODY = {
  ok: true,
  user_id: 'u-1',
  display_name: 'Alice',
  gold: 1234,
  tickets: 5,
  points: 1600,
  rating_code: 'gold',
  season_id: 's1',
  matches_played: 20,
  wins: 12,
  losses: 6,
  draws: 2,
  win_rate: 0.6,
  best_score: 5400,
  average_score: 3210.5,
  total_graze: 400,
  total_hits: 55,
  total_damage_dealt: 9000,
  total_card_plays: 77,
  deck_count: 3,
  card_count: 41,
  recent: [
    {
      match_id: 'm-1',
      mode_id: 'mvp_boss_race',
      stage_id: 'stage-1',
      result: 'win',
      score: 5400,
      rank_delta: 12,
      opponent_id: 'p-2',
      graze_count: 30,
      hit_count: 1,
      damage_dealt: 6000,
      card_plays: 4,
      duration_ticks: 3600,
      ended_at: '2026-10-10T12:00:00Z',
    },
  ],
  server_time: '2026-10-10T12:00:01Z',
  server_authoritative: true,
  client_result_authoritative: false,
};

suite('records: LobbyClient');

test('fetchRecords maps the whole dashboard including the recent list', async () => {
  const transport = new ScriptedTransport(() => ok(RECORDS_BODY));
  const client = new LobbyClient({ transport });
  const view = await client.fetchRecords();
  expect(view !== null, 'fetchRecords should return a view');
  expectEqual(transport.calls[0]?.id, 'records.get');
  expectEqual(view?.displayName, 'Alice');
  expectEqual(view?.gold, 1234);
  expectEqual(view?.tickets, 5);
  expectEqual(view?.points, 1600);
  expectEqual(view?.ratingCode, 'gold');
  expectEqual(view?.seasonId, 's1');
  expectEqual(view?.matchesPlayed, 20);
  expectEqual(view?.wins, 12);
  expectEqual(view?.losses, 6);
  expectEqual(view?.draws, 2);
  expectEqual(view?.winRate, 0.6);
  expectEqual(view?.bestScore, 5400);
  expectEqual(view?.averageScore, 3210.5);
  expectEqual(view?.totalGraze, 400);
  expectEqual(view?.totalHits, 55);
  expectEqual(view?.totalDamageDealt, 9000);
  expectEqual(view?.totalCardPlays, 77);
  expectEqual(view?.deckCount, 3);
  expectEqual(view?.cardCount, 41);
  expectEqual(view?.serverAuthoritative, true);
  expectEqual(view?.clientResultAuthoritative, false);
  expectEqual(view?.serverTimeMs, Date.parse('2026-10-10T12:00:01Z'));
  expectEqual(view?.recent.length, 1);
  expectDeepEqual(view?.recent[0], {
    matchId: 'm-1',
    modeId: 'mvp_boss_race',
    stageId: 'stage-1',
    result: 'win',
    score: 5400,
    rankDelta: 12,
    opponentId: 'p-2',
    grazeCount: 30,
    hitCount: 1,
    damageDealt: 6000,
    cardPlays: 4,
    durationTicks: 3600,
    endedAtMs: Date.parse('2026-10-10T12:00:00Z'),
  });
});

test('fetchRecords returns null and records lastError on a rejection', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: false, status: 401, error_code: 'unauthorized' })),
  });
  expectEqual(await client.fetchRecords(), null);
  expectEqual(client.lastError, 'unauthorized');
});

test('the HTTP transport maps records.get onto GET /v1/records', async () => {
  const seen: Array<{ method: string; path: string }> = [];
  const http: HttpClient = {
    async request(method, path): Promise<HttpResponseLike> {
      seen.push({ method, path });
      return { status: 200, body: { ok: true, recent: [] } };
    },
  };
  await new HttpLobbyTransport(http).call({ id: 'records.get' });
  expectDeepEqual(seen, [{ method: 'GET', path: '/v1/records' }]);
});

suite('records: LobbyFlow');

test('openRecords switches to the records screen and loads the view', async () => {
  const transport = new ScriptedTransport(() => ok(RECORDS_BODY));
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.openRecords(), true);
  expectEqual(flow.currentScreen, LobbyScreen.Records);
  const snapshot = flow.snapshot();
  expectEqual(snapshot.records?.wins, 12);
  expectEqual(snapshot.records?.recent.length, 1);
});

test('openRecords reports a failure without landing on an empty screen', async () => {
  const transport = new ScriptedTransport(() => ({ ok: false, status: 500, error_code: 'records_unavailable' }));
  const flow = new LobbyFlow(new LobbyClient({ transport }));
  expectEqual(await flow.openRecords(), false);
  expectEqual(flow.snapshot().lastError, 'Records load failed: records_unavailable');
});

suite('records: ActiveCardSnapshot accessor');

test('activeCardSnapshotFromPayload maps the base fields', () => {
  const snapshot = activeCardSnapshotFromPayload({
    card_id: 'aegis_ward',
    effect_kind: 'invulnerable',
    started_tick: 300,
    expires_tick: 480,
  });
  expectEqual(snapshot.cardId, 'aegis_ward');
  expectEqual(snapshot.effectKind, 'invulnerable');
  expectEqual(snapshot.startedTick, 300);
  expectEqual(snapshot.expiresTick, 480);
  expectEqual(activeCardDurationTicks(snapshot), 180, 'duration is derived from the window');
  expectEqual(activeCardRemainingTicks(snapshot, 360), 120, 'half-way through the window');
  expectEqual(activeCardRemainingTicks(snapshot, 480), 0, 'the expiry tick reads zero');
  expectEqual(activeCardRemainingTicks(snapshot, 900), 0, 'an expired effect floors at zero');
  expectEqual(snapshot.patternId, undefined, 'absent optional fields stay unset');
  expectEqual(snapshot.purgeRadius, undefined);
});

test('the parser ignores the phantom remaining_ticks / duration_ticks pair', () => {
  // `Gensoulkyo/runtime/core/types.go` sends started_tick/expires_tick only; a
  // payload shaped the old way must not silently produce a fake countdown.
  const snapshot = activeCardSnapshotFromPayload({
    card_id: 'aegis_ward',
    effect_kind: 'invulnerable',
    remaining_ticks: 120,
    duration_ticks: 180,
  });
  expectEqual(snapshot.startedTick, 0);
  expectEqual(snapshot.expiresTick, 0);
  expectEqual(activeCardDurationTicks(snapshot), 0);
  expectEqual(activeCardRemainingTicks(snapshot, 60), 0);
});

test('activeCardSnapshotFromPayload carries the new optional fields', () => {
  const purge = activeCardSnapshotFromPayload({
    card_id: 'purge_bell',
    effect_kind: 'bullet_purge',
    started_tick: 700,
    expires_tick: 701,
    purge_radius: 120,
    purge_count: 24,
  });
  expectEqual(purge.purgeRadius, 120);
  expectEqual(purge.purgeCount, 24);
  expectEqual(activeCardDurationTicks(purge), 1, 'a one-shot effect lasts a single tick');

  const aimed = activeCardSnapshotFromPayload({
    card_id: 'mirror_lance',
    effect_kind: 'opponent_pattern',
    started_tick: 100,
    expires_tick: 460,
    pattern_id: 'mirror_lance',
    target_user_id: 'u-2',
  });
  expectEqual(aimed.patternId, 'mirror_lance');
  expectEqual(aimed.targetUserId, 'u-2');
});
