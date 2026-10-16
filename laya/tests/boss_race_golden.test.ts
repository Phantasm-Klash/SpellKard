/**
 * Boss 弹幕黄金向量（线程A A6）—— C++ 服务端为权威，TS 镜像逐位断言。
 *
 * 生成方向：**C++ 导出、TS 断言**。fixture 由
 * `PhK-BattleServer/tests/boss_race_tests.cpp::WriteGoldenFixture` 生成：
 *
 *   PHK_BOSS_RACE_FIXTURE=<path> ./phk_boss_race_tests
 *
 * 固定输入（见 C++ 生成器）：match_seed=987654321，boss=`tian`，ruleset
 * `tna-1.40`，pattern_period=45；player_a 在 (-20000,60000) 用 ReimuA1/Reimu
 * 自机、tick>=10 起每 tick 射击；player_b 在 (20000,60000) 默认自机、从不射击；
 * 共 240 tick。断言每 tick 的：玩家坐标/HP/伤害、每颗子弹的 id/位置/速度（milli）。
 */

import { BossRaceSimulation, type BossRaceInput } from '../src/core/sim/boss_race';
import { normalizeBossRaceSeed } from '../src/core/math/boss_race_seed';
import { expectEqual, suite, test } from './harness';

interface NodeFs {
  readFileSync(path: string, encoding: string): string;
}
declare const require: (id: string) => NodeFs;
declare const __dirname: string;

interface GoldenPlayer {
  playerId: string;
  xMilli: number;
  yMilli: number;
  bossCurrentHp: number;
  damageDealt: number;
}
interface GoldenBullet {
  id: string;
  xMilli: number;
  yMilli: number;
  vxMilli: number;
  vyMilli: number;
}
interface GoldenTick {
  tick: number;
  stateHash: string;
  players: GoldenPlayer[];
  bullets: GoldenBullet[];
}
interface GoldenFixture {
  matchId: string;
  matchSeed: number;
  bossId: string;
  rulesetVersion: string;
  tickRateHz: number;
  patternPeriodTicks: number;
  tickCount: number;
  players: Array<{ playerId: string; xMilli: number; yMilli: number; shotType: string; bombType: string }>;
  ticks: GoldenTick[];
}

function loadFixture(): GoldenFixture {
  const fs = require('node:fs');
  const path = `${__dirname}/../../tests/fixtures/boss_race_golden.json`;
  return JSON.parse(fs.readFileSync(path, 'utf8')) as GoldenFixture;
}

function makeInput(playerId: string, tick: number, seq: number, shoot: boolean): BossRaceInput {
  return {
    playerId,
    tick,
    seq,
    directionBits: 0,
    slow: false,
    shoot,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  };
}

suite('boss race golden vector (C++ ↔ TS)');

test('TS reproduces the C++ boss+loadout bullet stream bit-for-bit', () => {
  const fixture = loadFixture();

  const sim = new BossRaceSimulation({
    matchId: fixture.matchId,
    modeId: 'mvp_boss_race',
    rulesetVersion: fixture.rulesetVersion,
    matchSeed: normalizeBossRaceSeed(fixture.matchSeed),
    bossMaxHp: 0,
    tickRateHz: fixture.tickRateHz,
    patternPeriodTicks: fixture.patternPeriodTicks,
    bossId: fixture.bossId,
    loadouts: fixture.players.map((player) => ({
      playerId: player.playerId,
      characterId: '',
      shotType: player.shotType,
      bombType: player.bombType,
    })),
  });
  for (const player of fixture.players) {
    sim.addPlayer(player.playerId, player.xMilli, player.yMilli);
  }

  const seqByPlayer = new Map<string, number>();
  for (const expected of fixture.ticks) {
    for (const player of fixture.players) {
      const seq = (seqByPlayer.get(player.playerId) ?? 0) + 1;
      seqByPlayer.set(player.playerId, seq);
      // player_a 从 tick 10 起射击；player_b 从不射击（与 C++ 生成器一致）。
      const shoot = player.playerId === 'player_a' && expected.tick >= 10;
      expectEqual(
        sim.submitInput(makeInput(player.playerId, expected.tick, seq, shoot)),
        true,
        `submit input ${player.playerId}@${expected.tick}`,
      );
    }
    const snapshot = sim.tick();

    expectEqual(snapshot.tick, expected.tick, `tick ${expected.tick} counter`);
    // 玩家状态逐位一致。
    expectEqual(snapshot.players.length, expected.players.length, `tick ${expected.tick} player count`);
    for (let i = 0; i < expected.players.length; i += 1) {
      const got = snapshot.players[i];
      const want = expected.players[i];
      expectEqual(got.playerId, want.playerId, `tick ${expected.tick} player[${i}] id`);
      expectEqual(got.xMilli, want.xMilli, `tick ${expected.tick} player[${i}] x`);
      expectEqual(got.yMilli, want.yMilli, `tick ${expected.tick} player[${i}] y`);
      expectEqual(got.bossCurrentHp, want.bossCurrentHp, `tick ${expected.tick} player[${i}] hp`);
      expectEqual(got.damageDealt, want.damageDealt, `tick ${expected.tick} player[${i}] damage`);
    }
    // 子弹流逐位一致（id/位置/速度，milli）。
    expectEqual(
      snapshot.bullets.length,
      expected.bullets.length,
      `tick ${expected.tick} bullet count`,
    );
    for (let i = 0; i < expected.bullets.length; i += 1) {
      const got = snapshot.bullets[i];
      const want = expected.bullets[i];
      expectEqual(got.bulletId, want.id, `tick ${expected.tick} bullet[${i}] id`);
      expectEqual(got.xMilli, want.xMilli, `tick ${expected.tick} bullet[${i}] x`);
      expectEqual(got.yMilli, want.yMilli, `tick ${expected.tick} bullet[${i}] y`);
      expectEqual(got.vxMilli, want.vxMilli, `tick ${expected.tick} bullet[${i}] vx`);
      expectEqual(got.vyMilli, want.vyMilli, `tick ${expected.tick} bullet[${i}] vy`);
    }
    expectEqual(snapshot.stateHash, expected.stateHash, `tick ${expected.tick} state hash`);
  }
});
