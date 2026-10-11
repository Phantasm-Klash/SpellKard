/**
 * `mvp_boss_race` simulation parity tests.
 *
 * These lock the client port to the server's observable behaviour: pattern
 * scheduling, bullet counts, damage-per-shot, movement clamping, winner
 * detection and canonical state hashing.
 */

import { bossRaceSeedFromHex } from '../src/core/math/boss_race_seed';
import { canonicalHashPair, llround } from '../src/core/math/deterministic';
import {
  ARENA_HALF_HEIGHT_MILLI,
  ARENA_HALF_WIDTH_MILLI,
  BOSS_RACE_DAMAGE_PER_SHOT_TICK,
  BOSS_RACE_DEFAULT_BOSS_HP,
  BOSS_RACE_HARD_SNAP_ERROR_MILLI,
  BOSS_RACE_HASH_HISTORY_TICKS,
  BOSS_RACE_PATTERN_PERIOD_TICKS,
  BULLET_CULL_HALF_HEIGHT_MILLI,
  BULLET_CULL_HALF_WIDTH_MILLI,
  BossRaceSimulation,
  BossRaceState,
  DIR_UP,
  bossRaceConfigForRuleset,
  classifyReconcile,
  defaultBossRaceConfig,
  usesRealDanmaku,
  type BossRacePlayerSnapshot,
  type BossRaceSnapshot,
} from '../src/core/sim/boss_race';
import { expect, expectEqual, suite, test } from './harness';

function makeSim(seed = 0x00010203): BossRaceSimulation {
  const sim = new BossRaceSimulation(defaultBossRaceConfig('match-mvp-001', seed));
  sim.addPlayer('p1');
  sim.addPlayer('p2');
  return sim;
}

/**
 * Rebuilds the material `BossRaceSimulation::CanonicalStateHash` would hash for
 * the given state, from the public snapshot alone.
 *
 * `std::map` iterates in key order, so the players are sorted by id; the bullets
 * keep their spawn order.
 */
function hashMaterial(
  sim: BossRaceSimulation,
  snapshot: BossRaceSnapshot,
  options: { bulletKindFunc?: boolean } = {},
): string {
  let material =
    `${sim.config.matchId}|${sim.config.matchSeed.decimal}|${snapshot.tick}|` +
    `${snapshot.state as number}|${snapshot.winnerPlayerId}|${snapshot.winnerTick}`;
  for (const player of [...snapshot.players].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
    material += `|p:${player.playerId}:${player.xMilli}:${player.yMilli}:${player.bossCurrentHp}:${player.damageDealt}`;
  }
  material += `|b:${snapshot.bullets.length}`;
  for (const bullet of snapshot.bullets) {
    material += `|${bullet.bulletId}:${bullet.xMilli}:${bullet.yMilli}`;
    if (options.bulletKindFunc !== false) {
      material += `:${bullet.bulletKind ?? 0}:${bullet.motionFunc ?? 0}`;
    }
  }
  return material;
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

test('a synthetic bullet integrates in pixel space, like the server', () => {
  // `gap_ring` fires at tick 45 with 16 slots at `2*pi*i/16`; slot 0 is skipped
  // (`i % 5 == 0`), so the first bullet is slot 1, speed 3000 milli, radius
  // 4000, from the Boss origin at (0, -60000).
  //
  // `AdvanceBullets` accumulates `motion.x += motion.vx` in **pixels** and only
  // converts once per tick (`ToMilli(pos - kScreenCenterX)`). Accumulating
  // rounded milli deltas instead — which this client used to do — drifts by a
  // milli or two per tick.
  const sim = makeSim();
  let seq = 0;
  for (let i = 0; i < 45; i += 1) {
    seq += 1;
    step(sim, 'p1', seq);
    seq += 1;
    step(sim, 'p2', seq);
    sim.tick();
  }
  const spawned = sim.snapshot().bullets[0];
  expect(spawned !== undefined, 'the ring pattern fired at tick 45');
  expectEqual(spawned.patternId, 'gap_ring');
  expectEqual(spawned.vxMilli, 2772, 'the rounded milli velocity the snapshot reports');

  // The spawn tick already integrated once, so `steps` ticks means `steps - 1`
  // further advances.
  const steps = 12;
  for (let i = 0; i < steps - 1; i += 1) {
    sim.tick();
  }
  const after = sim.snapshot().bullets.find((bullet) => bullet.bulletId === spawned.bulletId);
  expect(after !== undefined, 'the bullet is still on the field');

  // Independent restatement of the C++ spawn + integration, in pixel space.
  const angleRad = (2 * Math.PI) / 16;
  const angleDeg = angleRad * (180 / Math.PI);
  const speedPx = 3000 / 1000;
  const vxPx = speedPx * Math.cos(angleDeg * (Math.PI / 180));
  const vyPx = speedPx * Math.sin(angleDeg * (Math.PI / 180));
  const xPx = 320 + 0 / 1000 + 0 / 1000 + steps * vxPx;
  const yPx = 480 + -60000 / 1000 + 0 / 1000 + steps * vyPx;
  expectEqual(after!.xMilli, llround((xPx - 320) * 1000), 'x follows the server integration');
  expectEqual(after!.yMilli, llround((yPx - 480) * 1000), 'y follows the server integration');

  // And the naive accumulation really would have disagreed.
  expect(
    spawned.xMilli + steps * spawned.vxMilli !== after!.xMilli,
    'accumulating rounded milli deltas would have drifted',
  );
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

suite('authoritative adoption');

/**
 * A minimal server snapshot. `BossRaceSimulation` only *classified* its error
 * against the server before this existed — nothing ever fed the server state
 * back in — so the local prediction stayed on `addPlayer`'s `(0, 0)` spawn and
 * its own tick 0 forever.
 */
function snapshotFor(
  tick: number,
  players: Array<Partial<Omit<BossRacePlayerSnapshot, 'playerId'>> & { playerId: string }>,
): BossRaceSnapshot {
  return {
    tick,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    players: players.map((player) => ({
      playerId: player.playerId,
      xMilli: player.xMilli ?? 0,
      yMilli: player.yMilli ?? 0,
      bossCurrentHp: player.bossCurrentHp ?? BOSS_RACE_DEFAULT_BOSS_HP,
      damageDealt: player.damageDealt ?? 0,
      connected: player.connected ?? true,
    })),
    bullets: [],
    stateHash: '',
  };
}

test('adopting a snapshot seeds the tick and the server spawn points', () => {
  const sim = makeSim();
  // The local prediction starts on `addPlayer`'s default spawn.
  const before = sim.snapshot().players.find((player) => player.playerId === 'p1');
  expectEqual(before?.xMilli, 0, 'the prediction starts at x = 0');
  expectEqual(before?.yMilli, 0, 'the prediction starts at y = 0');

  sim.adoptAuthoritativeSnapshot(
    snapshotFor(600, [
      { playerId: 'p1', xMilli: -20000, yMilli: 60000, bossCurrentHp: 4200, damageDealt: 1800 },
      { playerId: 'p2', xMilli: 20000, yMilli: 60000 },
    ]),
    { alignTick: true },
  );

  expectEqual(sim.getCurrentTick(), 600, 'the local tick is raised to the server tick');
  const p1 = sim.snapshot().players.find((player) => player.playerId === 'p1');
  expectEqual(p1?.xMilli, -20000, 'the server spawn x is adopted');
  expectEqual(p1?.yMilli, 60000, 'the server spawn y is adopted');
  expectEqual(p1?.bossCurrentHp, 4200, 'the Boss HP is adopted');
  expectEqual(p1?.damageDealt, 1800, 'the damage total is adopted');
});

test('adopting a snapshot never rewinds the local tick', () => {
  const sim = makeSim();
  for (let i = 0; i < 10; i += 1) {
    sim.tick();
  }
  expectEqual(sim.getCurrentTick(), 10);

  // A stale snapshot (the server is behind the prediction) must not rewind:
  // the server rejects `tick <= current_tick`, so rewinding would invalidate
  // every input already sent.
  sim.adoptAuthoritativeSnapshot(snapshotFor(3, [{ playerId: 'p1' }]), { alignTick: true });
  expectEqual(sim.getCurrentTick(), 10, 'a stale snapshot leaves the tick alone');
});

test('adopting a snapshot drops inputs buffered for ticks the server has passed', () => {
  const sim = makeSim();
  // Tick 3 is inside the +/-8 window while the simulation is at tick 0.
  expectEqual(
    sim.submitInput({
      playerId: 'p1',
      tick: 3,
      seq: 1,
      directionBits: DIR_UP,
      slow: false,
      shoot: false,
      bomb: false,
      cardSlot: -1,
      modeActionId: '',
    }),
    true,
    'the tick-3 input is accepted before the adoption',
  );

  sim.adoptAuthoritativeSnapshot(snapshotFor(12, [{ playerId: 'p1' }]), { alignTick: true });
  for (let i = 0; i < 4; i += 1) {
    sim.tick();
  }

  const p1 = sim.snapshot().players.find((player) => player.playerId === 'p1');
  expectEqual(p1?.yMilli, 0, 'the stale tick-3 input is never replayed');
});

test('adopting without alignTick corrects the state but leaves the tick', () => {
  const sim = makeSim();
  for (let i = 0; i < 5; i += 1) {
    sim.tick();
  }

  sim.adoptAuthoritativeSnapshot(snapshotFor(500, [{ playerId: 'p1', xMilli: 1234, yMilli: -4321 }]));
  expectEqual(sim.getCurrentTick(), 5, 'the tick is untouched without alignTick');
  const p1 = sim.snapshot().players.find((player) => player.playerId === 'p1');
  expectEqual(p1?.xMilli, 1234, 'positions are still corrected');
  expectEqual(p1?.yMilli, -4321);
});

test('adopting a snapshot registers roster players and clamps their position', () => {
  const sim = new BossRaceSimulation(defaultBossRaceConfig('match-adopt', 7));
  sim.addPlayer('p1');

  sim.adoptAuthoritativeSnapshot(
    snapshotFor(1, [
      { playerId: 'p1', xMilli: 999999 },
      { playerId: 'p2', xMilli: 20000, yMilli: 60000 },
    ]),
  );

  const players = sim.snapshot().players;
  expectEqual(players.length, 2, 'the roster player the prediction never saw is added');
  expectEqual(
    players.find((player) => player.playerId === 'p1')?.xMilli,
    ARENA_HALF_WIDTH_MILLI,
    'an out-of-arena position is clamped like `addPlayer` does',
  );
  expectEqual(players.find((player) => player.playerId === 'p2')?.yMilli, 60000);
});

suite('per-tick hash history');

test('each tick keeps the canonical hash it had at the time', () => {
  const sim = makeSim();
  expectEqual(sim.hashAtTick(0), null, 'nothing is recorded before the first tick');

  sim.tick();
  expectEqual(sim.hashAtTick(1), sim.canonicalStateHash(), 'the tick just applied is recorded');

  sim.tick();
  const atTwo = sim.hashAtTick(2);
  expect(atTwo !== null, 'tick 2 is recorded');
  sim.tick();

  expectEqual(sim.hashAtTick(2), atTwo, 'an older tick keeps the hash it had back then');
  expect(sim.hashAtTick(2) !== sim.canonicalStateHash(), 'the live hash has moved on');
});

test('the history is bounded so a long match cannot grow it without limit', () => {
  const sim = makeSim();
  const ticks = BOSS_RACE_HASH_HISTORY_TICKS + 10;
  for (let i = 0; i < ticks; i += 1) {
    sim.tick();
  }

  expectEqual(sim.getCurrentTick(), ticks);
  expectEqual(sim.hashAtTick(5), null, 'ticks older than the window are evicted');
  expect(sim.hashAtTick(ticks) !== null, 'the newest tick is retained');
});

test('replaying from tick 0 reproduces the server bullet set exactly', () => {
  const seed = 0x0badf00d;
  const server = makeSim(seed);
  for (let i = 0; i < BOSS_RACE_PATTERN_PERIOD_TICKS; i += 1) {
    server.tick();
  }
  const serverSnapshot = server.snapshot();
  expect(serverSnapshot.bullets.length > 0, 'the server really did spawn bullets by tick 45');

  // Jumping straight to the server's tick leaves the prediction with none of the
  // bullets the server already spawned, so its hash can never match — this is
  // what a mid-match join used to look like.
  const skipped = makeSim(seed);
  skipped.adoptAuthoritativeSnapshot(serverSnapshot, { alignTick: true });
  expectEqual(skipped.snapshot().bullets.length, 0, 'adopting the tick alone loses the bullets');
  expect(skipped.canonicalStateHash() !== serverSnapshot.stateHash, 'and therefore cannot match');

  // Replaying every tick from 0 does reproduce them, ids included. Bullets are a
  // pure function of (seed, tick), so the replay needs no player input.
  const replayed = makeSim(seed);
  while (replayed.getCurrentTick() < serverSnapshot.tick) {
    replayed.tick();
  }
  expectEqual(replayed.snapshot().bullets.length, serverSnapshot.bullets.length);
  expectEqual(replayed.snapshot().bullets[0]?.bulletId, serverSnapshot.bullets[0]?.bulletId);
  expectEqual(
    replayed.hashAtTick(serverSnapshot.tick),
    serverSnapshot.stateHash,
    'replaying from tick 0 reproduces the server state byte for byte',
  );
});

test('the canonical hash material matches the server format exactly', () => {
  // Rebuild the material the way `BossRaceSimulation::CanonicalStateHash` does
  // and check the simulation agrees. This pins the parts that are easy to drop:
  // the seed printed in full (`std::to_string(uint64_t)`) and each bullet's
  // `bullet_kind` / `bullet_func_no` suffix.
  const sim = makeSim();
  for (let i = 0; i < BOSS_RACE_PATTERN_PERIOD_TICKS; i += 1) {
    sim.tick();
  }
  const snapshot = sim.snapshot();
  expect(snapshot.bullets.length > 0, 'the pattern period really does spawn bullets');

  const material = hashMaterial(sim, snapshot);
  expectEqual(sim.canonicalStateHash(), canonicalHashPair(material));

  // Omitting the kind/func suffix — which the client used to do — changes the
  // hash, so it cannot be dropped without breaking parity.
  const withoutSuffix = hashMaterial(sim, snapshot, { bulletKindFunc: false });
  expect(withoutSuffix !== material, 'the material really does carry the suffix');
  expect(
    canonicalHashPair(withoutSuffix) !== sim.canonicalStateHash(),
    'dropping the bullet kind/func suffix changes the hash',
  );
});

test('a wide seed reaches the hashed material', () => {
  const narrow = new BossRaceSimulation(defaultBossRaceConfig('m', bossRaceSeedFromHex('0000000000000000')));
  const wide = new BossRaceSimulation(defaultBossRaceConfig('m', bossRaceSeedFromHex('0000000100000000')));
  for (const sim of [narrow, wide]) {
    sim.addPlayer('p1');
    sim.tick();
  }
  expect(
    narrow.canonicalStateHash() !== wide.canonicalStateHash(),
    'two seeds sharing their low 32 bits must not hash alike',
  );
});

test('the simulation follows the ticket ruleset, not a hard-coded one', () => {
  const fromTicket = new BossRaceSimulation(bossRaceConfigForRuleset('m', 1, 'ruleset-local-s0'));
  expectEqual(
    fromTicket.usesRealDanmaku(),
    true,
    'the lobby signs tickets with ruleset-local-s0, which is not the legacy ruleset',
  );
  expectEqual(
    fromTicket.hashComparable(),
    true,
    'and the real-danmaku library is the server port, so its bullet set is comparable',
  );

  const legacy = new BossRaceSimulation(bossRaceConfigForRuleset('m', 1, 'mvp-boss-race-s0'));
  expectEqual(legacy.usesRealDanmaku(), false);
  expectEqual(legacy.hashComparable(), true, 'the legacy synthetic scheduler is a faithful port');

  expectEqual(usesRealDanmaku(''), true, 'an empty ruleset is not the legacy one, matching the C++ branch');
  expectEqual(usesRealDanmaku('tna-1.40-phase'), true);
});

test('only a position error hard-snaps; a hash mismatch alone does not', () => {
  expectEqual(classifyReconcile(0, true).hardSnap, false, 'agreement is not a snap');

  const hashOnly = classifyReconcile(0, false);
  expectEqual(hashOnly.hashMatch, false, 'the mismatch is still reported');
  expectEqual(
    hashOnly.hardSnap,
    false,
    'a differing bullet set is not something resyncing players can repair',
  );

  expectEqual(
    classifyReconcile(BOSS_RACE_HARD_SNAP_ERROR_MILLI + 1, true).hardSnap,
    true,
    'a genuine position error still snaps',
  );
});

test('bullets are culled on the screen box, not the arena box', () => {
  const sim = makeSim();
  for (let i = 0; i < BOSS_RACE_PATTERN_PERIOD_TICKS * 12; i += 1) {
    sim.tick();
  }
  const bullets = sim.snapshot().bullets;
  expect(bullets.length > 0, 'bullets are still alive well into the match');
  expect(
    bullets.some((bullet) => Math.abs(bullet.yMilli) > ARENA_HALF_HEIGHT_MILLI),
    'bullets survive outside the arena box the players are clamped to',
  );
  expect(
    bullets.every(
      (bullet) =>
        Math.abs(bullet.xMilli) <= BULLET_CULL_HALF_WIDTH_MILLI &&
        Math.abs(bullet.yMilli) <= BULLET_CULL_HALF_HEIGHT_MILLI,
    ),
    'nothing survives outside the 640x960 screen box',
  );
});
