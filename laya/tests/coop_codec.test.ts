/**
 * 合作模式快照编解码回归（COOP_MODE_CONTRACT.md §2.4 / §4）。
 *
 * 载荷 = 类型字节 12 + UTF-8 JSON；字段名必须与服务端
 * `EncodeCoopBossSnapshotPayload` 逐字对应。畸形输入返回 null，不抛。
 */

import { decodeCoopBossSnapshot } from '../src/core/net/battle_codec';
import { BattlePayloadType } from '../src/core/protocol/types';
import { CoopBossState } from '../src/core/sim/coop_boss';
import { expect, expectEqual, suite, test } from './harness';

function encode(payload: unknown, typeByte = BattlePayloadType.COOP_SNAPSHOT): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const out = new Uint8Array(json.length + 1);
  out[0] = typeByte;
  out.set(json, 1);
  return out;
}

const SAMPLE = {
  tick: 480,
  state: 'running',
  boss_hp: 7300,
  boss_max_hp: 10000,
  seat_count: 4,
  shield_dir_mask: 0b1010,
  lock_dir: 2,
  lock_until_tick: 600,
  spiral_active: true,
  state_hash: '0123abcd',
  players: [
    {
      player_id: 'p0',
      seat: 0,
      x_milli: 0,
      y_milli: 70200,
      facing_millideg: 0,
      damage_dealt: 1200,
      connected: true,
      locked: false,
      shielded: false,
    },
    {
      player_id: 'p2',
      seat: 2,
      x_milli: 0,
      y_milli: -70200,
      facing_millideg: 18000,
      damage_dealt: 900,
      connected: true,
      locked: true,
      shielded: true,
    },
  ],
  bullets: [
    {
      bullet_id: 'c1',
      owner_player_id: 'p2',
      x_milli: 12000,
      y_milli: -3000,
      vx_milli: -3000,
      vy_milli: 0,
      radius_milli: 12000,
      kind: 1,
      pattern_id: 'coop_cannon',
    },
    {
      bullet_id: 'c2',
      owner_player_id: 'boss',
      x_milli: 0,
      y_milli: 20000,
      vx_milli: 0,
      vy_milli: 2600,
      radius_milli: 4200,
      kind: 2,
      pattern_id: 'coop_spiral',
    },
  ],
};

suite('coop snapshot codec');

test('decodes the server JSON shape into the camelCase mirror', () => {
  const snapshot = decodeCoopBossSnapshot(encode(SAMPLE));
  expect(snapshot !== null, 'decode returned null');
  const decoded = snapshot!;
  expectEqual(decoded.tick, 480, 'tick');
  expectEqual(decoded.state, CoopBossState.Running, 'state');
  expectEqual(decoded.bossHp, 7300, 'boss hp');
  expectEqual(decoded.bossMaxHp, 10000, 'boss max hp');
  expectEqual(decoded.seatCount, 4, 'seat count');
  expectEqual(decoded.shieldDirMask, 0b1010, 'shield mask');
  expectEqual(decoded.lockDir, 2, 'lock dir');
  expectEqual(decoded.lockUntilTick, 600, 'lock until');
  expectEqual(decoded.spiralActive, true, 'spiral');
  expectEqual(decoded.stateHash, '0123abcd', 'state hash');
  expectEqual(decoded.players.length, 2, 'player count');
  expectEqual(decoded.players[1].locked, true, 'locked flag');
  expectEqual(decoded.players[1].shielded, true, 'shielded flag');
  expectEqual(decoded.players[1].facingMilliDeg, 18000, 'facing');
  expectEqual(decoded.bullets.length, 2, 'bullet count');
  expectEqual(decoded.bullets[0].kind, 1, 'cannon kind');
  expectEqual(decoded.bullets[0].radiusMilli, 12000, 'cannon radius');
  expectEqual(decoded.bullets[1].ownerPlayerId, 'boss', 'public bullet owner');
});

test('rejects wrong payload type and malformed bodies', () => {
  expectEqual(decodeCoopBossSnapshot(encode(SAMPLE, BattlePayloadType.SNAPSHOT)), null, 'wrong type byte');
  expectEqual(decodeCoopBossSnapshot(new Uint8Array([12])), null, 'truncated payload');
  const broken = new Uint8Array([12, 0x7b, 0x7b]); // "{{"
  expectEqual(decodeCoopBossSnapshot(broken), null, 'invalid json');
});

test('tolerates missing optional collections and unknown states', () => {
  const snapshot = decodeCoopBossSnapshot(
    encode({ tick: 1, state: 'weird', boss_hp: 0, boss_max_hp: 0, seat_count: 2 }),
  );
  expect(snapshot !== null, 'decode returned null');
  expectEqual(snapshot!.state, CoopBossState.Waiting, 'unknown state -> waiting');
  expectEqual(snapshot!.players.length, 0, 'empty players');
  expectEqual(snapshot!.bullets.length, 0, 'empty bullets');
  expectEqual(snapshot!.spiralActive, false, 'spiral default false');
});
