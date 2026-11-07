/**
 * 「全开」后的权威标量同步 + state-hash 可比性回归。
 *
 * 背景：全开后服务端的 Boss 伤害来自自机弹管线（`SpawnMyBulletsForPlayer`
 * → `JudgeMyBullets` → `ApplyBossDamage`）并伴随符卡阶段清屏；客户端
 * `BossRaceSimulation` 不镜像这两者，而 `hp`/`dmg` 与子弹几何都在
 * `canonicalStateHash` 里 ⇒ hash 必然分叉，且分叉不产生位置误差、永远
 * 触发不了 hard snap。修法拆成两半：
 *  1. `adoptAuthoritativeProgress()` 每帧只同步权威标量，让
 *     `simulationRef.snapshot()` 的 Boss HP 不再持久滞后；
 *  2. 独立的 `stateHashComparable()` 声明「本局 hash 不可比」，避免
 *     `hashMismatches` 被永久假红污染。
 *
 * ★ 关键不变量：`hashComparable()` 同时是**本地弹幕集生成门控**
 * （`spawnBulletsForTick` :1539），绝不能因为修 F1 而变成 false。
 */

import {
  BossRaceSimulation,
  BossRaceState,
  defaultBossRaceConfig,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { expect, expectEqual, suite, test } from './harness';

/** 线上票据下发的 ruleset：改动前机制全关，现在默认全开。 */
const LIVE_RULESET = 'ruleset-local-s0';

function makeSim(allFeaturesEnabled?: boolean): BossRaceSimulation {
  const sim = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
    ...(allFeaturesEnabled === undefined ? {} : { allFeaturesEnabled }),
  });
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  return sim;
}

function authoritative(tick: number, hp: number, dmg: number): BossRaceSnapshot {
  return {
    tick,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    stateHash: 'server-side-hash',
    players: [
      {
        playerId: 'p1',
        xMilli: 9999,
        yMilli: -8888,
        bossCurrentHp: hp,
        damageDealt: dmg,
        connected: true,
        score: 777,
        hitCount: 2,
        spellGet: 1,
        spellTotal: 3,
        lives: 2,
        bombs: 1,
        graze: 9,
        invulnerableUntilTick: 42,
      },
      {
        playerId: 'p2',
        xMilli: -1000,
        yMilli: -2000,
        bossCurrentHp: 6000,
        damageDealt: 0,
        connected: true,
      },
    ],
    bullets: [],
  };
}

function p1(snapshot: BossRaceSnapshot): BossRaceSnapshot['players'][number] {
  const player = snapshot.players.find((entry) => entry.playerId === 'p1');
  expect(player !== undefined, 'snapshot carries p1');
  return player!;
}

// ---------------------------------------------------------------------------
// 1. stateHashComparable 与 hashComparable 的语义必须分开
// ---------------------------------------------------------------------------

suite('state-hash comparability is separate from the bullet-set gate');

test('the live all-features ruleset is not state-hash comparable', () => {
  const sim = makeSim();
  expect(sim.usesDanmakuMechanics(), 'allFeaturesEnabled defaults to true');
  expectEqual(
    sim.stateHashComparable(),
    false,
    'the client does not mirror player bullets / spell-phase clears, so a mismatch is expected',
  );
  expectEqual(
    sim.hashComparable(),
    true,
    '★ the bullet-set gate must stay true or client-side danmaku would switch off',
  );
});

test('an explicit legacy fallback stays fully comparable', () => {
  const legacy = makeSim(false);
  expect(!legacy.usesDanmakuMechanics(), 'legacy has no judgment mechanics');
  expectEqual(legacy.stateHashComparable(), true, 'legacy still reproduces the whole canonical state');
  expectEqual(legacy.hashComparable(), true, 'legacy still builds its bullet set');
});

test('a provisional timeline is not comparable even with mechanics off', () => {
  const sim = new BossRaceSimulation({
    ...defaultBossRaceConfig('m', 1),
    rulesetVersion: LIVE_RULESET,
    allFeaturesEnabled: false,
    realDanmakuIsProduction: false,
  });
  expectEqual(sim.hashComparable(), false, 'provisional timeline');
  expectEqual(sim.stateHashComparable(), false, 'and therefore not state-hash comparable');
});

// ---------------------------------------------------------------------------
// 2. adoptAuthoritativeProgress：只动标量，不动预测状态
// ---------------------------------------------------------------------------

suite('authoritative scalar adoption leaves prediction state intact');

test('only the authoritative scalar readouts move', () => {
  const sim = makeSim();
  const before = sim.snapshot();
  const tickBefore = sim.getCurrentTick();
  const bulletsBefore = before.bullets.length;
  const xBefore = p1(before).xMilli;
  const yBefore = p1(before).yMilli;

  // A pending input must survive the adoption (the replay still consumes it).
  expect(
    sim.submitInput({
      playerId: 'p1',
      tick: 1,
      seq: 1,
      directionBits: 2,
      slow: false,
      shoot: true,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    'pending input accepted',
  );

  sim.adoptAuthoritativeProgress(authoritative(0, 5950, 50));
  const after = sim.snapshot();

  expectEqual(p1(after).bossCurrentHp, 5950, 'Boss HP follows the server');
  expectEqual(p1(after).damageDealt, 50, 'damage follows the server');
  expectEqual(p1(after).score, 777, 'score follows the server');
  expectEqual(p1(after).hitCount, 2, 'hit count follows the server');
  expectEqual(p1(after).spellGet, 1, 'spellGet follows the server');
  expectEqual(p1(after).spellTotal, 3, 'spellTotal follows the server');
  expectEqual(p1(after).lives, 2, 'lives follows the server');
  expectEqual(p1(after).bombs, 1, 'bombs follows the server');
  expectEqual(p1(after).graze, 9, 'graze follows the server');
  expectEqual(p1(after).invulnerableUntilTick, 42, 'invulnerable window follows the server');

  expectEqual(p1(after).xMilli, xBefore, '★ position is NOT adopted by the lightweight path');
  expectEqual(p1(after).yMilli, yBefore, '★ position is NOT adopted by the lightweight path');
  expectEqual(after.bullets.length, bulletsBefore, '★ bullet set is NOT reset');
  expectEqual(sim.getCurrentTick(), tickBefore, '★ tick counter is NOT touched');
  expectEqual(sim.hashAtTick(0), null, '★ hash history is NOT rewritten');

  // The buffered input still drives the next tick (no input-buffer reset).
  const moved = p1(sim.tick());
  expect(moved.xMilli !== xBefore, 'the pending input survived adoption');
});

test('per-snapshot adoption keeps local Boss HP on the authoritative track', () => {
  const sim = makeSim();
  // Emulates BattleClient.applySnapshot: adopt scalars, then replay to the tick.
  for (let tick = 1; tick <= 6; tick += 1) {
    const hp = 6000 - tick * 7;
    const dmg = tick * 7;
    sim.adoptAuthoritativeProgress(authoritative(tick, hp, dmg));
    while (sim.getCurrentTick() < tick) {
      sim.tick();
    }
    // The mechanics path has no local Boss damage source, so the adopted HP
    // survives the replay — no position-driven hard snap is needed.
    expectEqual(p1(sim.snapshot()).bossCurrentHp, hp, `tick ${tick}: local HP matches the server`);
    expectEqual(p1(sim.snapshot()).damageDealt, dmg, `tick ${tick}: local damage matches the server`);
  }
});

test('never creates players the local roster does not have', () => {
  const sim = makeSim();
  sim.adoptAuthoritativeProgress({
    ...authoritative(1, 6000, 0),
    players: [{ playerId: 'p-new', xMilli: 0, yMilli: 0, bossCurrentHp: 6000, damageDealt: 0, connected: true }],
  });
  expectEqual(sim.snapshot().players.length, 2, 'roster unchanged (hard snap owns player creation)');
});
