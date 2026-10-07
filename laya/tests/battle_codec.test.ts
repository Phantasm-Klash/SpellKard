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
  peekPayloadType,
} from '../src/core/net/battle_codec';
import { BattlePayloadType, emptyVersionStamp } from '../src/core/protocol/types';
import { BossRaceState } from '../src/core/sim/boss_race';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

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
