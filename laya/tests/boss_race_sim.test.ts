/**
 * `mvp_boss_race` simulation parity tests.
 *
 * These lock the client port to the server's observable behaviour: pattern
 * scheduling, bullet counts, damage-per-shot, movement clamping, winner
 * detection and canonical state hashing.
 */

import {
  ARENA_HALF_HEIGHT_MILLI,
  BOSS_RACE_DAMAGE_PER_SHOT_TICK,
  BOSS_RACE_DEFAULT_BOSS_HP,
  BOSS_RACE_PATTERN_PERIOD_TICKS,
  BossRaceSimulation,
  BossRaceState,
  DIR_UP,
  defaultBossRaceConfig,
} from '../src/core/sim/boss_race';
import { expect, expectEqual, suite, test } from './harness';

function makeSim(seed = 0x00010203): BossRaceSimulation {
  const sim = new BossRaceSimulation(defaultBossRaceConfig('match-mvp-001', seed));
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  return sim;
}

/** Submit an input for the next tick, satisfying the server's +/-8 window. */
function step(
  sim: BossRaceSimulation,
  playerId: string,
  seq: number,
  input: { bits?: number; shoot?: boolean } = {},
): void {
  const tick = sim.getCurrentTick() + 1;
  sim.submitInput({
    playerId,
    tick,
    seq,
    directionBits: input.bits ?? 0,
    slow: false,
    shoot: input.shoot ?? false,
    bomb: false,
    cardSlot: -1,
    modeActionId: '',
  });
}

suite('boss race simulation');

test('starts in Waiting and becomes Running with two players', () => {
  const sim = makeSim();
  expectEqual(sim.getState(), BossRaceState.Waiting);
  sim.tick();
  expectEqual(sim.getState(), BossRaceState.Running);
  expectEqual(sim.getPlayerCount(), 2);
});

test('pattern schedule follows (tick / 45) % 10', () => {
  const sim = makeSim();
  expectEqual(sim.patternIdForTick(0), 'ring');
  expectEqual(sim.patternIdForTick(45), 'gap_ring');
  expectEqual(sim.patternIdForTick(90), 'n_way');
  expectEqual(sim.patternIdForTick(405), 'blossom');
  expectEqual(sim.patternIdForTick(450), 'ring');
});

test('gap_ring spawns 12 bullets per player at tick 45', () => {
  const sim = makeSim();
  let seq = 0;
  for (let i = 0; i < BOSS_RACE_PATTERN_PERIOD_TICKS; i += 1) {
    seq += 1;
    step(sim, 'p1', seq);
    seq += 1;
    step(sim, 'p2', seq);
    sim.tick();
  }
  const snapshot = sim.snapshot();
  expectEqual(snapshot.tick, 45);
  expectEqual(snapshot.bullets.length, 24);
  expectEqual(snapshot.bullets[0].patternId, 'gap_ring');
  // Both players' Boss copies fire identical patterns (same seed).
  const p1Bullets = snapshot.bullets.filter((bullet) => bullet.ownerPlayerId === 'p1');
  const p2Bullets = snapshot.bullets.filter((bullet) => bullet.ownerPlayerId === 'p2');
  expectEqual(p1Bullets.length, 12);
  expectEqual(p2Bullets.length, 12);
  expectEqual(p1Bullets[0].vxMilli, p2Bullets[0].vxMilli);
  expectEqual(p1Bullets[0].vyMilli, p2Bullets[0].vyMilli);
});

test('bullets advance by their velocity each tick', () => {
  const sim = makeSim();
  let seq = 0;
  for (let i = 0; i < 46; i += 1) {
    seq += 1;
    step(sim, 'p1', seq);
    seq += 1;
    step(sim, 'p2', seq);
    sim.tick();
  }
  const before = sim.snapshot().bullets[0];
  sim.tick();
  const after = sim.snapshot().bullets.find((bullet) => bullet.bulletId === before.bulletId);
  expect(after !== undefined, 'bullet should still be on the field');
  expectEqual(after!.xMilli - before.xMilli, before.vxMilli);
  expectEqual(after!.yMilli - before.yMilli, before.vyMilli);
});

test('shooting deals exactly 10 damage per tick to the shooter own Boss copy', () => {
  const sim = makeSim();
  let seq = 0;
  for (let i = 0; i < 45; i += 1) {
    seq += 1;
    step(sim, 'p1', seq, { shoot: true });
    seq += 1;
    step(sim, 'p2', seq);
    sim.tick();
  }
  const snapshot = sim.snapshot();
  const p1 = snapshot.players.find((player) => player.playerId === 'p1');
  const p2 = snapshot.players.find((player) => player.playerId === 'p2');
  expectEqual(p1!.bossCurrentHp, BOSS_RACE_DEFAULT_BOSS_HP - 45 * BOSS_RACE_DAMAGE_PER_SHOT_TICK);
  expectEqual(p1!.damageDealt, 45 * BOSS_RACE_DAMAGE_PER_SHOT_TICK);
  expectEqual(p2!.bossCurrentHp, BOSS_RACE_DEFAULT_BOSS_HP);
  expectEqual(p2!.damageDealt, 0);
});

test('movement uses the server bit layout (up=0x1) and clamps to the arena', () => {
  const sim = makeSim();
  let seq = 0;
  for (let i = 0; i < 200; i += 1) {
    seq += 1;
    step(sim, 'p1', seq, { bits: DIR_UP });
    seq += 1;
    step(sim, 'p2', seq);
    sim.tick();
  }
  const p1 = sim.snapshot().players.find((player) => player.playerId === 'p1');
  expectEqual(p1!.yMilli, -ARENA_HALF_HEIGHT_MILLI);
  expectEqual(p1!.xMilli, 0);
});

test('first player to defeat their Boss wins and freezes the match', () => {
  const sim = makeSim();
  let seq = 0;
  let winnerTick = 0;
  for (let i = 0; i < 700; i += 1) {
    seq += 1;
    step(sim, 'p1', seq, { shoot: true });
    seq += 1;
    step(sim, 'p2', seq);
    sim.tick();
    if (sim.getState() === BossRaceState.Finished) {
      winnerTick = sim.getCurrentTick();
      break;
    }
  }
  expectEqual(sim.getState(), BossRaceState.Finished);
  expectEqual(sim.getWinnerPlayerId(), 'p1');
  expectEqual(winnerTick, BOSS_RACE_DEFAULT_BOSS_HP / BOSS_RACE_DAMAGE_PER_SHOT_TICK);
  const frozen = sim.tick();
  expectEqual(frozen.tick, winnerTick);
});

test('identical inputs produce identical state hashes', () => {
  const a = makeSim();
  const b = makeSim();
  let seqA = 0;
  let seqB = 0;
  for (let i = 0; i < 120; i += 1) {
    seqA += 1;
    step(a, 'p1', seqA, { bits: DIR_UP, shoot: i % 3 === 0 });
    seqA += 1;
    step(a, 'p2', seqA, { bits: 0x2, shoot: i % 5 === 0 });
    a.tick();

    seqB += 1;
    step(b, 'p1', seqB, { bits: DIR_UP, shoot: i % 3 === 0 });
    seqB += 1;
    step(b, 'p2', seqB, { bits: 0x2, shoot: i % 5 === 0 });
    b.tick();
  }
  expectEqual(a.canonicalStateHash(), b.canonicalStateHash());
  expectEqual(a.canonicalStateHash().length, 16);
});

test('rejects inputs outside the +/-8 tick window and non-monotonic seq', () => {
  const sim = makeSim();
  sim.tick();
  expectEqual(
    sim.submitInput({
      playerId: 'p1',
      tick: 1,
      seq: 1,
      directionBits: 0,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    false,
  );
  expectEqual(
    sim.submitInput({
      playerId: 'p1',
      tick: 99,
      seq: 1,
      directionBits: 0,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    false,
  );
  expectEqual(
    sim.submitInput({
      playerId: 'p1',
      tick: 2,
      seq: 1,
      directionBits: 0xff,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    false,
  );
});
