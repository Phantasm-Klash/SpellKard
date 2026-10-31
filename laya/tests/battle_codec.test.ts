/**
 * Battle wire-format tests.
 *
 * The dev battle server uses a hand-rolled little-endian codec rather than
 * protobuf (`PhK-BattleServer/src/match_lifecycle.cpp`). These tests pin the
 * exact byte layout so a client/server drift is caught immediately.
 */

import {
  ByteReader,
  decodeBattleInput,
  decodeBattleResult,
  decodeBossRaceSnapshot,
  encodeBattleInput,
  encodeBattleInputWithTicket,
  peekPayloadType,
} from '../src/core/net/battle_codec';
import { BattlePayloadType, emptyVersionStamp } from '../src/core/protocol/types';
import { BossRaceState } from '../src/core/sim/boss_race';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

// The ticket block is what lets the battle server bind a session to a verified
// account (and fill `players[].user_id` in the .dem). Its field order is frozen
// by the server's `WriteTicketBlock`, so this reads the frame back in that order
// and asserts the values survive the round trip.
test('the signed ticket rides on the input frame in the server field order', () => {
  const raw = {
    signature_alg: 'ED25519',
    key_id: 'lobby-key-1',
    signature: 'aabb',
    public_key_hex: 'ccdd',
    server_authoritative: true,
    ticket: {
      version: { protocol_version: 1, business_api_version: 'v1', battle_api_version: 'b1', ruleset_version: 'ruleset-local-s0' },
      ticket_id: 'tk-1',
      match_id: 'm1',
      user_id: 'u-42',
      player_id: 'p1',
      mode_id: 'mvp_boss_race',
      battle_server_id: 'bs-1',
      endpoint: '10.0.0.1:7400',
      deck_snapshot_hash: 'deck',
      ruleset_version: 'ruleset-local-s0',
      ticket_nonce_hex: 'nonce',
      issued_at_ms: 1700000000000,
      expires_at_ms: 1700003600000,
      business_session_id: 'sess-1',
      hand_card_ids: ['c1', 'c2'],
      deck_card_ids: ['d1'],
      initial_energy: 3,
      server_seed: '12345678901234567890',
    },
  };
  const frame = encodeBattleInputWithTicket(
    {
      version: { ...emptyVersionStamp(), protocolVersion: 1 },
      matchId: 'm1',
      playerId: 'p1',
      tick: 7,
      seq: 3,
      directionBits: 0,
      slow: false,
      shoot: true,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    },
    raw,
  );
  const plain = encodeBattleInput({
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'm1',
    playerId: 'p1',
    tick: 7,
    seq: 3,
    directionBits: 0,
    slow: false,
    shoot: true,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  });
  // The plain input frame comes first, byte for byte, then the present flag.
  for (let index = 0; index < plain.length; index += 1) {
    expectEqual(frame[index], plain[index]);
  }
  const reader = new ByteReader(frame.subarray(plain.length));
  expectEqual(reader.u8(), 1);
  expectEqual(reader.u32(), 1);
  expectEqual(reader.string(), 'v1');
  expectEqual(reader.string(), 'b1');
  expectEqual(reader.string(), 'ruleset-local-s0');
  expectEqual(reader.string(), 'tk-1');
  expectEqual(reader.string(), 'm1');
  expectEqual(reader.string(), 'u-42');
  expectEqual(reader.string(), 'p1');
  expectEqual(reader.string(), 'mvp_boss_race');
  expectEqual(reader.string(), 'bs-1');
  expectEqual(reader.string(), '10.0.0.1:7400');
  expectEqual(reader.string(), 'deck');
  expectEqual(reader.string(), 'ruleset-local-s0');
  expectEqual(reader.string(), 'nonce');
  expectEqual(reader.u64(), 1700000000000);
  expectEqual(reader.u64(), 1700003600000);
  expectEqual(reader.string(), 'sess-1');
  expectEqual(reader.u32(), 2);
  expectEqual(reader.string(), 'c1');
  expectEqual(reader.string(), 'c2');
  expectEqual(reader.u32(), 1);
  expectEqual(reader.string(), 'd1');
  // Doubles travel as decimal text on this wire.
  expectEqual(Number(reader.string()), 3);
  expectEqual(reader.string(), '12345678901234567890');
  expectEqual(reader.string(), 'ED25519');
  expectEqual(reader.string(), 'lobby-key-1');
  expectEqual(reader.string(), 'aabb');
  expectEqual(reader.string(), 'ccdd');
  expectEqual(reader.u8(), 1);
});

suite('battle wire codec');

test('BattleInput payload starts with the INPUT type byte and a u32 version', () => {
  const payload = encodeBattleInput({
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'm1',
    playerId: 'p1',
    tick: 7,
    seq: 3,
    directionBits: 0x5,
    slow: true,
    shoot: false,
    bomb: true,
    cardSlot: -1,
    modeActionId: '',
  });
  expectEqual(payload[0], BattlePayloadType.INPUT);
  const reader = new ByteReader(payload);
  expectEqual(reader.u8(), 3);
  expectEqual(reader.u32(), 1);
  expectEqual(reader.string(), 'm1');
  expectEqual(reader.string(), 'p1');
  expectEqual(reader.u64(), 7);
  expectEqual(reader.u64(), 3);
  expectEqual(reader.u32(), 0x5);
  // flags: slow(0x01) + bomb(0x04)
  expectEqual(reader.u8(), 0x05);
  expectEqual(reader.i8(), -1);
  expectEqual(reader.string(), '');
});

test('BattleInput round-trips through the server codec', () => {
  const input = {
    version: { ...emptyVersionStamp(), protocolVersion: 1 },
    matchId: 'match-mvp-001',
    playerId: 'p2',
    tick: 5400,
    seq: 9001,
    directionBits: 0x0a,
    slow: false,
    shoot: true,
    bomb: false,
    cardSlot: 3,
    modeActionId: 'act-9',
  };
  const decoded = decodeBattleInput(encodeBattleInput(input));
  expect(decoded !== null, 'payload should decode');
  expectEqual(decoded!.matchId, 'match-mvp-001');
  expectEqual(decoded!.playerId, 'p2');
  expectEqual(decoded!.tick, 5400);
  expectEqual(decoded!.seq, 9001);
  expectEqual(decoded!.directionBits, 0x0a);
  expectEqual(decoded!.slow, false);
  expectEqual(decoded!.shoot, true);
  expectEqual(decoded!.bomb, false);
  expectEqual(decoded!.cardSlot, 3);
  expectEqual(decoded!.modeActionId, 'act-9');
});

test('decodeBattleInput rejects non-INPUT payloads', () => {
  const payload = new Uint8Array([BattlePayloadType.SNAPSHOT, 0x7b, 0x7d]);
  expectEqual(decodeBattleInput(payload), null);
});

test('decodeBossRaceSnapshot parses the server JSON snapshot payload', () => {
  const json = JSON.stringify({
    tick: 45,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: 'deadbeefdeadbeef',
    players: [
      {
        player_id: 'p1',
        x_milli: 3000,
        y_milli: -6000,
        boss_current_hp: 5900,
        damage_dealt: 100,
        connected: true,
      },
    ],
    bullets: [
      {
        bullet_id: 'b1',
        owner_player_id: 'p1',
        x_milli: 0,
        y_milli: -60000,
        vx_milli: 3000,
        vy_milli: 0,
        radius_milli: 4000,
        pattern_id: 'gap_ring',
      },
    ],
  });
  const payload = concat(new Uint8Array([BattlePayloadType.SNAPSHOT]), utf8(json));
  expectEqual(peekPayloadType(payload), BattlePayloadType.SNAPSHOT);
  const snapshot = decodeBossRaceSnapshot(payload);
  expect(snapshot !== null, 'snapshot should decode');
  expectEqual(snapshot!.tick, 45);
  expectEqual(snapshot!.state, BossRaceState.Running);
  expectEqual(snapshot!.stateHash, 'deadbeefdeadbeef');
  expectEqual(snapshot!.players.length, 1);
  expectEqual(snapshot!.players[0].bossCurrentHp, 5900);
  expectEqual(snapshot!.bullets.length, 1);
  expectEqual(snapshot!.bullets[0].patternId, 'gap_ring');
  expectEqual(snapshot!.bullets[0].vyMilli, 0);
  // A server that predates the real-danmaku extensions sends no kind at all;
  // "absent" must stay distinguishable from "kind 0" so the renderer falls back
  // to the generic bullet instead of inventing a sprite.
  expectEqual(snapshot!.bullets[0].bulletKind, undefined);
  expectEqual(snapshot!.bullets[0].motionFunc, undefined);
});

test('decodeBossRaceSnapshot carries the real-danmaku bullet kind and motion func', () => {
  const json = JSON.stringify({
    tick: 90,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: 'cafebabecafebabe',
    players: [],
    bullets: [
      {
        bullet_id: 'b7',
        owner_player_id: 'p1',
        x_milli: 0,
        y_milli: -60000,
        vx_milli: 3000,
        vy_milli: 0,
        radius_milli: 4000,
        bullet_kind: 9,
        motion_func: 1,
        pattern_id: 'kusabi_gap_ring',
      },
      {
        bullet_id: 'b8',
        owner_player_id: 'p1',
        x_milli: 0,
        y_milli: -60000,
        vx_milli: 0,
        vy_milli: 3000,
        radius_milli: 4000,
        bullet_kind: 174,
        motion_func: 25,
        pattern_id: 'heart_sine_speed',
      },
    ],
  });
  const payload = concat(new Uint8Array([BattlePayloadType.SNAPSHOT]), utf8(json));
  const snapshot = decodeBossRaceSnapshot(payload);
  expect(snapshot !== null, 'snapshot should decode');
  expectEqual(snapshot!.bullets.length, 2);
  expectEqual(snapshot!.bullets[0].bulletKind, 9);
  expectEqual(snapshot!.bullets[0].motionFunc, 1);
  expectEqual(snapshot!.bullets[1].bulletKind, 174);
  expectEqual(snapshot!.bullets[1].motionFunc, 25);
  expectEqual(snapshot!.bullets[1].patternId, 'heart_sine_speed');
});

test('decodeBattleResult parses the server JSON result payload', () => {
  const json = JSON.stringify({
    match_id: 'match-mvp-001',
    mode_id: 'mvp_boss_race',
    ruleset_version: 'ruleset-local-s0',
    match_seed: 66051,
    winner_player_id: 'p1',
    winner_tick: 600,
    state_hash: '0011223344556677',
    players: [
      { player_id: 'p1', damage_dealt: 6000, boss_current_hp: 0 },
      { player_id: 'p2', damage_dealt: 3000, boss_current_hp: 3000 },
    ],
  });
  const payload = concat(new Uint8Array([BattlePayloadType.RESULT]), utf8(json));
  const result = decodeBattleResult(payload);
  expect(result !== null, 'result should decode');
  expectEqual(result!.winnerPlayerId, 'p1');
  expectEqual(result!.winnerTick, 600);
  expectEqual(result!.players.length, 2);
  expectEqual(result!.players[1].bossCurrentHp, 3000);
});

test('malformed payloads are rejected instead of throwing', () => {
  expectEqual(decodeBossRaceSnapshot(new Uint8Array([4, 0x7b])), null);
  expectEqual(decodeBattleResult(new Uint8Array([8, 0x7b])), null);
  expectEqual(decodeBossRaceSnapshot(new Uint8Array(0)), null);
  expectDeepEqual(decodeBattleInput(new Uint8Array([3, 1])), null);
});

function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(out);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// §2.3 局内手牌：快照是**单份广播**（服务端 `BroadcastSnapshotPayload` 把同一个
// payload 发给所有会话），所以顶层的 `hand` 只能表示「某一个人的手牌」。权威在
// `players[].hand`，客户端必须取本地玩家自己那一份，否则多人局会显示别人的牌。
test('decodeBossRaceSnapshot reads the hand per player and keeps the top-level one as a fallback', () => {
  const perPlayer = JSON.stringify({
    tick: 12,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: 'aabb',
    players: [
      {
        player_id: 'p1',
        x_milli: 0,
        y_milli: 0,
        boss_current_hp: 100,
        damage_dealt: 0,
        hand: [{ card_id: 'focus_lens', slot: 0, selected: true }],
        energy: 6.5,
      },
      {
        player_id: 'p2',
        x_milli: 0,
        y_milli: 0,
        boss_current_hp: 100,
        damage_dealt: 0,
        hand: [{ card_id: 'purge_bell', slot: 0, selected: false }],
      },
    ],
    bullets: [],
  });
  const decoded = decodeBossRaceSnapshot(
    concat(new Uint8Array([BattlePayloadType.SNAPSHOT]), utf8(perPlayer)),
  );
  expect(decoded !== null, 'snapshot should decode');
  expectEqual(decoded!.players[0].hand?.length, 1);
  expectEqual(decoded!.players[0].hand![0].cardId, 'focus_lens');
  expectEqual(decoded!.players[0].hand![0].selected, true);
  expectEqual(decoded!.players[0].energy, 6.5);
  expectEqual(decoded!.players[1].hand![0].cardId, 'purge_bell');
  // 服务端没发能量 → `undefined`，不能伪装成 0（0 是「能量耗尽」的合法读数）。
  expectEqual(decoded!.players[1].energy, undefined);
  // 顶层那份在多玩家局里是空的（服务端只在单人局填别名）。
  expectEqual(decoded!.hand, undefined);

  // 单人局兼容别名：只有顶层 `hand` 的老形状仍然要能读出来。
  const legacy = JSON.stringify({
    tick: 3,
    state: 'running',
    winner_player_id: '',
    winner_tick: 0,
    state_hash: 'ccdd',
    players: [{ player_id: 'p1', x_milli: 0, y_milli: 0, boss_current_hp: 9, damage_dealt: 0 }],
    hand: [{ card_id: 'aegis_ward', slot: 0, selected: false }],
    deck_remaining: 15,
    bullets: [],
  });
  const old = decodeBossRaceSnapshot(
    concat(new Uint8Array([BattlePayloadType.SNAPSHOT]), utf8(legacy)),
  );
  expect(old !== null, 'legacy snapshot should decode');
  expectEqual(old!.hand?.[0].cardId, 'aegis_ward');
  expectEqual(old!.deckRemaining, 15);
  // 老形状没有每玩家手牌 → 保持 `undefined`，调用方回落顶层 `hand`。
  expectEqual(old!.players[0].hand, undefined);
});
