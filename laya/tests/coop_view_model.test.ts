/**
 * 合作模式视角数学回归（COOP_MODE_CONTRACT.md §3.2）。
 *
 * 锁定的不变量：
 *  - 视野旋转把**本地座位**旋到屏幕底部朝上（2 人 0/180°，4 人 0/90/180/270°）；
 *  - 其他玩家 alpha 0.45、他弹 0.40、本地/公共弹幕 1.0；
 *  - 视图 8 向 bitmask → 战场 bitmask 的旋转映射，且与渲染旋转互逆。
 */

import {
  buildCoopFrame,
  COOP_ALLY_ALPHA,
  COOP_ALLY_BULLET_ALPHA,
  coopArenaDirectionBits,
  coopLocalSeat,
  coopRotatePoint,
  coopViewRotationRad,
} from '../src/core/game/coop_view_model';
import { CoopBossState, coopSeatSpawnMilli, type CoopBossSnapshot } from '../src/core/sim/coop_boss';
import { expect, expectClose, expectEqual, suite, test } from './harness';

const LAYOUT = { width: 400, height: 400 };

function makeSnapshot(seatCount: number): CoopBossSnapshot {
  const players = [];
  for (let seat = 0; seat < seatCount; seat += 1) {
    const spawn = coopSeatSpawnMilli(seatCount, seat);
    players.push({
      playerId: `p${seat}`,
      seat,
      xMilli: spawn.xMilli,
      yMilli: spawn.yMilli,
      facingMilliDeg: seatCount <= 2 ? (seat === 0 ? 0 : 18000) : [0, 27000, 18000, 9000][seat],
      damageDealt: seat * 10,
      connected: true,
      locked: false,
      shielded: false,
    });
  }
  return {
    tick: 120,
    state: CoopBossState.Running,
    bossHp: 8000,
    bossMaxHp: 10000,
    seatCount,
    shieldDirMask: 0,
    lockDir: -1,
    lockUntilTick: 0,
    spiralActive: false,
    players,
    bullets: [
      {
        bulletId: 'b1',
        ownerPlayerId: 'p1',
        xMilli: 0,
        yMilli: 0,
        vxMilli: 1000,
        vyMilli: 0,
        radiusMilli: 4000,
        kind: 0,
        patternId: 'coop_fan',
      },
      {
        bulletId: 'b2',
        ownerPlayerId: 'boss',
        xMilli: 1000,
        yMilli: 1000,
        vxMilli: 0,
        vyMilli: 1000,
        radiusMilli: 4200,
        kind: 2,
        patternId: 'coop_spiral',
      },
    ],
    stateHash: 'deadbeef',
  };
}

suite('coop view model');

test('rotation per seat: 2p 0/180, 4p 0/90/180/270', () => {
  expectClose(coopViewRotationRad(0, 2), 0, 1e-9);
  expectClose(coopViewRotationRad(1, 2), Math.PI, 1e-9);
  for (let seat = 0; seat < 4; seat += 1) {
    expectClose(coopViewRotationRad(seat, 4), (seat * Math.PI) / 2, 1e-9);
  }
});

test('rotatePoint maps the local seat bearing to the bottom of the screen', () => {
  // 4 人房 seat1 在右侧 (+x)，顺时针转 90° 后应落到下方 (+y)。
  const point = coopRotatePoint(1, 0, Math.PI / 2);
  expectClose(point.x, 0, 1e-9);
  expectClose(point.y, 1, 1e-9);
});

test('local player is always bottom-most and faces up in its own view', () => {
  for (const seatCount of [2, 4]) {
    for (let seat = 0; seat < seatCount; seat += 1) {
      const snapshot = makeSnapshot(seatCount);
      const frame = buildCoopFrame(snapshot, {
        layout: LAYOUT,
        localPlayerId: `p${seat}`,
      });
      const local = frame.players.find((player) => player.isLocal);
      expect(local !== undefined, `local player missing for seat ${seat}`);
      const maxY = Math.max(...frame.players.map((player) => player.y));
      expectClose(local!.y, maxY, 1e-6);
      // 朝向朝上：facingRad mod 2π ≈ 0
      const normalized = ((local!.facingRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      expect(normalized < 1e-6 || Math.abs(normalized - Math.PI * 2) < 1e-6, `seat ${seat} facing ${normalized}`);
      expectEqual(frame.localSeat, seat, 'local seat');
    }
  }
});

test('translucent allies and their bullets; local and public bullets opaque', () => {
  const snapshot = makeSnapshot(4);
  const frame = buildCoopFrame(snapshot, { layout: LAYOUT, localPlayerId: 'p0' });
  for (const player of frame.players) {
    expectClose(player.alpha, player.isLocal ? 1 : COOP_ALLY_ALPHA, 1e-9);
  }
  const otherBullet = frame.bullets.find((bullet) => bullet.bulletId === 'b1');
  const publicBullet = frame.bullets.find((bullet) => bullet.bulletId === 'b2');
  expectClose(otherBullet!.alpha, COOP_ALLY_BULLET_ALPHA, 1e-9);
  expectClose(publicBullet!.alpha, 1, 1e-9);
  expect(publicBullet!.isPublic, 'spiral bullet is public');
});

test('view direction bits rotate back into arena space', () => {
  // 2 人房 seat1：视图“上” = 战场“下”(bit2)。
  expectEqual(coopArenaDirectionBits(0b0001, 1, 2), 0b0100, '2p seat1 up -> down');
  // 4 人房 seat1：视图“上” = 战场“左”(bit3)。
  expectEqual(coopArenaDirectionBits(0b0001, 1, 4), 0b1000, '4p seat1 up -> left');
  // 4 人房 seat2：视图“上” = 战场“下”(bit2)。
  expectEqual(coopArenaDirectionBits(0b0001, 2, 4), 0b0100, '4p seat2 up -> down');
  // 4 人房 seat3：视图“上” = 战场“右”(bit1)。
  expectEqual(coopArenaDirectionBits(0b0001, 3, 4), 0b0010, '4p seat3 up -> right');
  // 4 人房 seat3：视图“右” = 战场“下”(bit2)。
  expectEqual(coopArenaDirectionBits(0b0010, 3, 4), 0b0100, '4p seat3 right -> down');
});

test('direction mapping is a bijection (round-trip all bits)', () => {
  for (const seatCount of [2, 4]) {
    for (let seat = 0; seat < seatCount; seat += 1) {
      for (let bits = 0; bits < 16; bits += 1) {
        const arena = coopArenaDirectionBits(bits, seat, seatCount);
        expectEqual(arena & 0x0f, arena, 'masked to 4 bits');
      }
      // 4 个单 bit 的映射必须互异（旋转 = 双射）
      const mapped = new Set<number>();
      for (let bit = 0; bit < 4; bit += 1) {
        mapped.add(coopArenaDirectionBits(1 << bit, seat, seatCount));
      }
      expectEqual(mapped.size, 4, `seat ${seat}/${seatCount} mapping not a bijection`);
    }
  }
});

test('coopLocalSeat falls back to 0 without a snapshot', () => {
  expectEqual(coopLocalSeat(null, 'p9'), 0);
  expectEqual(coopLocalSeat(makeSnapshot(4), 'p2'), 2);
});
