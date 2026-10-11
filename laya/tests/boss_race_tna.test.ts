/**
 * TNA (千夜追忆) danmaku simulation-path tests.
 *
 * The client simulation keeps the legacy 10-pattern timeline for the
 * un-migrated server ruleset (`mvp-boss-race-s0`) and runs the **real-danmaku**
 * path (`tna-1.40-phase`) for everything else — which is what the lobby actually
 * signs.
 *
 * The real-danmaku path is now the server's own library
 * (`core/sim/danmaku/pattern_timeline.ts` mirrors `pattern_timeline.cpp` +
 * `emitter.cpp`), so `hashComparable()` is `true` in production and these tests
 * can assert the concrete bullet sets the server would produce.
 */

import {
  BOSS_RACE_TNA_PATTERN_IDS,
  BOSS_RACE_TNA_PATTERNS,
  BossRaceSimulation,
  BossRaceState,
  defaultBossRaceConfig,
  defaultTnaBossRaceConfig,
  isTnaRuleset,
} from '../src/core/sim/boss_race';
import { TNA_RULESET_VERSION, TNA_TIMELINE_IS_PRODUCTION } from '../src/core/sim/danmaku/pattern_timeline';
import { expect, expectEqual, suite, test } from './harness';

function makeTnaSim(matchId = 'match-tna-001', seed = 0x01020304): BossRaceSimulation {
  const sim = new BossRaceSimulation(defaultTnaBossRaceConfig(matchId, seed));
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  return sim;
}

/** Run `n` ticks with no player input. */
function run(sim: BossRaceSimulation, n: number): void {
  for (let i = 0; i < n; i += 1) {
    sim.tick();
  }
}

suite('tna danmaku simulation');

test('the ruleset flag distinguishes the real-danmaku path', () => {
  expect(isTnaRuleset(TNA_RULESET_VERSION), 'TNA version is the TNA ruleset');
  expect(!isTnaRuleset('mvp-boss-race-s0'), 'legacy version is not TNA');
  expect(makeTnaSim().isTnaRuleset(), 'the TNA sim reports the TNA ruleset');
});

test('the real-danmaku timeline is production, so its bullet set is comparable', () => {
  expectEqual(TNA_TIMELINE_IS_PRODUCTION, true, 'the library IS the server port');
  const sim = makeTnaSim();
  expectEqual(sim.usesRealDanmaku(), true);
  expectEqual(sim.hashComparable(), true, 'so the client models the bullet set and can compare');
});

test('the shipped library is the server\'s ten patterns', () => {
  expectEqual(BOSS_RACE_TNA_PATTERNS.length, 10);
  expectEqual(BOSS_RACE_TNA_PATTERN_IDS.length, 10);
  expectEqual(BOSS_RACE_TNA_PATTERN_IDS[0], 'kome_ring');
  expectEqual(BOSS_RACE_TNA_PATTERN_IDS[9], 'chou_four_dir');
});

test('at tick 45 the TNA path spawns the kusabi ring for both players', () => {
  const sim = makeTnaSim();
  run(sim, 45);
  const snapshot = sim.snapshot();
  expectEqual(snapshot.tick, 45);

  // `kusabi_gap_ring` = two waves of 12, one per player ⇒ 48 bullets.
  expectEqual(snapshot.bullets.length, 48);
  for (const bullet of snapshot.bullets) {
    expectEqual(bullet.bulletKind, 9, 'kusabi_01');
    expectEqual(bullet.motionFunc, 0, 'straight-line family');
    expectEqual(bullet.patternId, 'kusabi_gap_ring');
  }

  // Bullet ids are allocated globally, in `std::map` (sorted player id) order.
  expectEqual(snapshot.bullets[0].bulletId, 'b1');
  expectEqual(snapshot.bullets[23].bulletId, 'b24');
  expectEqual(snapshot.bullets[24].bulletId, 'b25');
  expectEqual(snapshot.bullets[47].bulletId, 'b48');
  expectEqual(snapshot.bullets[0].ownerPlayerId, 'p1');
  expectEqual(snapshot.bullets[47].ownerPlayerId, 'p2');

  // Both Boss copies fire the same pattern from the same origin.
  expectEqual(snapshot.bullets[0].xMilli, snapshot.bullets[24].xMilli);
  expectEqual(snapshot.bullets[0].yMilli, snapshot.bullets[24].yMilli);
});

test('the bullet set keeps growing as the schedule advances', () => {
  const sim = makeTnaSim();
  run(sim, 45);
  const at45 = sim.snapshot().bullets.length;
  run(sim, 45);
  const at90 = sim.snapshot().bullets.length;
  expect(at90 > at45, 'tick 90 adds the arrow fan on top of whatever survived');
  // Tick 90 = `arrow_aimed_fan`: 7 per player.
  expectEqual(at90 - at45, 14, '14 new bullets at tick 90');
});

test('TNA bullets advance along their ported kinematics', () => {
  const sim = makeTnaSim();
  run(sim, 45);
  const before = sim.snapshot().bullets[0];
  sim.tick();
  const after = sim.snapshot().bullets.find((bullet) => bullet.bulletId === before.bulletId);
  expect(after !== undefined, 'bullet should still be alive one tick later');
  const moved = after!.xMilli !== before.xMilli || after!.yMilli !== before.yMilli;
  expect(moved, 'bullet position should change each tick');
  expect(after!.angleDeg !== undefined, 'heading should be tracked for rendering');
});

test('the TNA phase schedule repeats with the period', () => {
  const sim = makeTnaSim();
  expectEqual(sim.patternIdForTick(0), 'kome_ring');
  expectEqual(sim.patternIdForTick(45), 'kusabi_gap_ring');
  expectEqual(sim.patternIdForTick(90), 'arrow_aimed_fan');
  expectEqual(sim.patternIdForTick(135), 'ring_spiral');
  expectEqual(sim.patternIdForTick(450), 'kome_ring', 'the tenth pattern wraps back to the first');
});

test('the legacy ruleset still follows the synthetic pattern schedule', () => {
  const sim = new BossRaceSimulation(defaultBossRaceConfig('match-mvp-001', 1));
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  expectEqual(sim.patternIdForTick(0), 'ring');
  expectEqual(sim.patternIdForTick(45), 'gap_ring');
  expectEqual(sim.patternIdForTick(90), 'n_way');
  // Legacy bullets carry no real-danmaku fields.
  run(sim, 45);
  const bullets = sim.snapshot().bullets;
  expect(bullets.length > 0, 'legacy path still spawns bullets');
  expectEqual(bullets[0].bulletKind, undefined);
  expectEqual(bullets[0].motionFunc, undefined);
});

test('a provisional timeline drops the bullet set instead of reporting a fake one', () => {
  // The escape hatch still works: if a future build ships a sample schedule
  // again, the simulation must not model (or compare) a bullet set it knows is
  // wrong.
  const sim = new BossRaceSimulation({
    ...defaultTnaBossRaceConfig('match-tna-001', 0x01020304),
    realDanmakuIsProduction: false,
  });
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  expectEqual(sim.usesRealDanmaku(), true, 'the ruleset still selects the real-danmaku path');
  expectEqual(sim.hashComparable(), false, 'but the timeline is provisional');
  run(sim, 90);
  expectEqual(sim.snapshot().bullets.length, 0, 'so no local bullets are built');
  expectEqual(sim.patternIdForTick(45), 'kusabi_gap_ring', 'the schedule is still reported for the HUD');
});

test('a TNA match still starts, runs and hashes deterministically', () => {
  const a = makeTnaSim();
  const b = makeTnaSim();
  run(a, 120);
  run(b, 120);
  expectEqual(a.getState(), BossRaceState.Running);
  expectEqual(a.snapshot().bullets.length, b.snapshot().bullets.length);
  expectEqual(a.canonicalStateHash(), b.canonicalStateHash());
});

test('a different seed changes the hashed state', () => {
  const a = makeTnaSim('m', 0x00000001);
  const b = makeTnaSim('m', 0x00000002);
  run(a, 200);
  run(b, 200);
  expect(
    a.canonicalStateHash() !== b.canonicalStateHash(),
    'the seed reaches the RNG and therefore the bullet state',
  );
});
