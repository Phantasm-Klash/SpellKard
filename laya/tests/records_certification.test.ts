/**
 * 战绩里的考证信息。
 *
 * 服务端 `CertificationProfile` 一直有考证关卡与晋级资格，但 `Records()` 以前
 * 只回评级代号——玩家看不到"该考哪关""能不能晋级"。现在这些字段会发过来，
 * 这里钉住客户端确实读到了。
 */

import { expectEqual, suite, test } from './harness';
import {
  LobbyClient,
  type LobbyRpcRequest,
  type LobbyRpcResponse,
  type LobbyTransport,
} from '../src/core/net/lobby_client';

/** Answers every RPC with one scripted response. */
class ScriptedTransport implements LobbyTransport {
  constructor(private readonly handler: (request: LobbyRpcRequest) => LobbyRpcResponse) {}

  async call(request: LobbyRpcRequest): Promise<LobbyRpcResponse> {
    return this.handler(request);
  }

  close(): void {
    // nothing to release
  }
}

function recordsPayload(): Record<string, unknown> {
  return {
    ok: true,
    user_id: 'u-1',
    display_name: 'Alice',
    gold: 10,
    tickets: 2,
    points: 1200,
    rating_code: 'adept',
    season_id: 's-1',
    // The certification fields, as the server now sends them.
    challenge_stage_id: 'lunar_maze',
    rank_score_floor: 1000,
    percentile: 0.12,
    top_30_qualified: true,
    next_certification_unlocked: true,
    matches_played: 4,
    wins: 3,
    losses: 1,
    draws: 0,
    win_rate: 0.75,
    best_score: 9000,
    average_score: 5000,
    total_graze: 10,
    total_hits: 2,
    total_damage_dealt: 100,
    total_card_plays: 5,
    deck_count: 1,
    card_count: 20,
    recent: [],
  };
}

suite('records: the certification the player is sitting');

test('the exam stage and promotion state come through', async () => {
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: true, status: 200, payload: recordsPayload() })),
  });
  const view = await client.fetchRecords();
  expectEqual(view?.ratingCode, 'adept', 'the rating is still read');
  expectEqual(view?.challengeStageId, 'lunar_maze', 'which stage the exam runs on');
  expectEqual(view?.rankScoreFloor, 1000, 'the floor of this rating');
  expectEqual(view?.top30Qualified, true, 'whether the top 30% was reached');
  expectEqual(view?.nextCertificationUnlocked, true, 'whether the next exam is open');
});

test('an older server that omits them yields empty values, not errors', async () => {
  const payload = recordsPayload();
  delete payload.challenge_stage_id;
  delete payload.top_30_qualified;
  delete payload.next_certification_unlocked;
  const client = new LobbyClient({
    transport: new ScriptedTransport(() => ({ ok: true, status: 200, payload })),
  });
  const view = await client.fetchRecords();
  expectEqual(view?.challengeStageId, '', 'the stage is simply unknown');
  expectEqual(view?.top30Qualified, false, 'and the player is not shown as qualified');
  expectEqual(view?.ratingCode, 'adept', 'while the rating still reads');
});
