/**
 * Bullet visual-differentiation tests.
 *
 * Two things are locked here:
 *
 *  1. `buildBossRaceFrame` must derive a bullet's travel `angleRad` from its
 *     velocity (this is what lets the view draw pointing/streaking shapes), and
 *     interpolation must preserve it.
 *  2. Every pattern id the simulation can emit must map to one of the known
 *     visual families — the classifier lives in `core/game/bullet_visual` so it
 *     can be asserted here without touching LayaAir.
 */

import type { BossRaceBullet, BossRaceSnapshot } from '../src/core/sim/boss_race';
import { BOSS_RACE_PATTERN_IDS, BossRaceState } from '../src/core/sim/boss_race';
import { buildBossRaceFrame, interpolateFrames } from '../src/core/game/boss_race_view_model';
import type { PlayfieldLayout } from '../src/core/game/boss_race_view_model';
import {
  animatedFrameFor,
  classifyPattern,
  describeBulletKind,
  isRotatingSpecies,
  knownBulletKinds,
  knownPatternIds,
  speciesFrames,
  spriteRotationDeg,
  type BulletVisualClass,
} from '../src/core/game/bullet_visual';
import { BULLET_KIND_COUNT } from '../src/core/sim/danmaku/bullet_kind';
import { expect, expectClose, expectEqual, suite, test } from './harness';

/** width == full arena width ⇒ scale 1.0, so milli-units map 1:1 to pixels. */
// E1: the render field is the 640×960 **screen box**, so a 1-px-per-milli
// layout is the screen box in milli (not the player-clamp arena).
const LAYOUT: PlayfieldLayout = { width: 640000, height: 960000 };

const VALID_CLASSES: readonly BulletVisualClass[] = ['linear', 'curve', 'orbit', 'homing', 'spread'];

/** The intended trajectory family for each pattern — the source of truth here. */
const EXPECTED_FAMILIES: ReadonlyArray<readonly [string, BulletVisualClass]> = [
  ['ring', 'linear'],
  ['gap_ring', 'linear'],
  ['n_way', 'linear'],
  ['aimed', 'linear'],
  ['seeded_arc', 'curve'],
  ['sine_stream', 'curve'],
  ['spiral', 'orbit'],
  ['blossom', 'orbit'],
  ['homing', 'homing'],
  ['laser_curtain', 'spread'],
];

function bullet(overrides: Partial<BossRaceBullet>): BossRaceBullet {
  return {
    bulletId: 'b0',
    ownerPlayerId: 'p1',
    xMilli: 0,
    yMilli: 0,
    vxMilli: 0,
    vyMilli: 0,
    radiusMilli: 4000,
    patternId: 'ring',
    ...overrides,
  };
}

function snapshot(bullets: BossRaceBullet[]): BossRaceSnapshot {
  return {
    tick: 0,
    state: BossRaceState.Running,
    winnerPlayerId: '',
    winnerTick: 0,
    players: [
      { playerId: 'p1', xMilli: 0, yMilli: 0, bossCurrentHp: 6000, damageDealt: 0, connected: true },
      { playerId: 'p2', xMilli: 1000, yMilli: 1000, bossCurrentHp: 6000, damageDealt: 0, connected: true },
    ],
    bullets,
    stateHash: '',
  };
}

function frameFor(bullets: BossRaceBullet[]) {
  return buildBossRaceFrame(snapshot(bullets), {
    layout: LAYOUT,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
  });
}

suite('bullet visual differentiation');

test('angleRad is derived from velocity direction', () => {
  const frame = frameFor([
    bullet({ bulletId: 'east', vxMilli: 3000, vyMilli: 0 }),
    bullet({ bulletId: 'south', vxMilli: 0, vyMilli: 1500 }),
    bullet({ bulletId: 'west', vxMilli: -3000, vyMilli: 0 }),
    bullet({ bulletId: 'north', vxMilli: 0, vyMilli: -1500 }),
    bullet({ bulletId: 'se', vxMilli: 1000, vyMilli: 1000 }),
  ]);
  const byId = new Map(frame.bullets.map((b) => [b.bulletId, b]));
  expectClose(byId.get('east')!.angleRad, 0, 1e-9, 'east should be 0');
  expectClose(byId.get('south')!.angleRad, Math.PI / 2, 1e-9, 'south should be +pi/2 (screen +y down)');
  expectClose(byId.get('west')!.angleRad, Math.PI, 1e-9, 'west should be pi');
  expectClose(byId.get('north')!.angleRad, -Math.PI / 2, 1e-9, 'north should be -pi/2');
  expectClose(byId.get('se')!.angleRad, Math.PI / 4, 1e-9, 'south-east should be pi/4');
});

test('every bullet in a mixed curtain carries a finite angleRad', () => {
  const frame = frameFor([
    bullet({ bulletId: 'a', vxMilli: 2000, vyMilli: 2000 }),
    bullet({ bulletId: 'b', vxMilli: -800, vyMilli: 2600, patternId: 'laser_curtain' }),
    bullet({ bulletId: 'c', vxMilli: 500, vyMilli: -500, patternId: 'homing' }),
  ]);
  for (const b of frame.bullets) {
    expect(Number.isFinite(b.angleRad), `angleRad for ${b.bulletId} should be finite`);
  }
});

test('interpolateFrames preserves angleRad while lerping position', () => {
  const previous = frameFor([bullet({ bulletId: 'x', xMilli: 0, yMilli: 0, vxMilli: 3000, vyMilli: 0 })]);
  const current = frameFor([bullet({ bulletId: 'x', xMilli: 3000, yMilli: 0, vxMilli: 3000, vyMilli: 0 })]);
  const blended = interpolateFrames(previous, current, 0.5);
  const item = blended.bullets[0];
  expectClose(item.angleRad, 0, 1e-9, 'angleRad must survive interpolation');
  // scale 1.0 and screen half-width 320000 ⇒ pixel x is milli + 320000.
  expectClose(item.position.x, 320000 + 1500, 1e-6, 'position should be halfway');
});

test('the classifier assigns every simulated pattern id to a trajectory family', () => {
  const families = new Set<BulletVisualClass>();
  for (const patternId of BOSS_RACE_PATTERN_IDS) {
    const family = classifyPattern(patternId);
    expect(
      VALID_CLASSES.includes(family),
      `pattern ${patternId} mapped to unexpected trajectory family ${family}`,
    );
    families.add(family);
  }
  // Every family must be used, so no branch of the renderer is dead code.
  expectEqual(families.size, VALID_CLASSES.length, 'all trajectory families should be exercised');
  // The classifier's own list must cover exactly the simulation's list.
  expectEqual(knownPatternIds().length, BOSS_RACE_PATTERN_IDS.length, 'known pattern count');
  for (const patternId of knownPatternIds()) {
    expect(
      (BOSS_RACE_PATTERN_IDS as readonly string[]).includes(patternId),
      `classifier knows unknown pattern ${patternId}`,
    );
  }
});

test('every pattern maps to its intended family (none falls through to the default)', () => {
  // Asserted per-pattern: a missing key would fall back to 'linear' and, for the
  // non-linear patterns, be caught here rather than masked by a count check.
  for (const [patternId, expected] of EXPECTED_FAMILIES) {
    expectEqual(classifyPattern(patternId), expected, `family for ${patternId}`);
  }
  // Belt and braces: the expected table covers exactly the simulated ids.
  expectEqual(EXPECTED_FAMILIES.length, BOSS_RACE_PATTERN_IDS.length, 'expected-family table size');
});

test('no simulated pattern relies on the classification fallback', () => {
  // A pattern whose id is unknown to the map silently becomes 'linear'. Guard
  // against a real linear pattern hiding a typo in the map by checking the
  // non-linear ones explicitly resolve to their family.
  for (const [patternId, expected] of EXPECTED_FAMILIES) {
    if (expected === 'linear') {
      continue;
    }
    expectEqual(classifyPattern(patternId), expected, `${patternId} must not fall back`);
  }
});

test('unknown pattern ids fall back to the neutral linear family', () => {
  expectEqual(classifyPattern('does_not_exist'), 'linear');
  expectEqual(classifyPattern(''), 'linear');
});

// --- real-danmaku (kEnemyBullet) descriptor --------------------------------

suite('real danmaku visual descriptor');

test('the classifier knows exactly the 216 kEnemyBullet values', () => {
  expectEqual(knownBulletKinds().length, BULLET_KIND_COUNT);
  expectEqual(knownBulletKinds()[0], 9);
  expectEqual(knownBulletKinds()[knownBulletKinds().length - 1], 224);
});

test('a kind resolves to its atlas frame and species', () => {
  const descriptor = describeBulletKind(9);
  expect(descriptor !== null, 'kind 9 should resolve');
  expectEqual(descriptor!.atlas, 'bulletlist01');
  expectEqual(descriptor!.frame, 'kusabi_01.png');
  expectEqual(descriptor!.species, 'kusabi');
  expectEqual(descriptor!.motionFamily, 'unknown', 'no motion func ⇒ unknown family');
});

test('a motion func refines the descriptor family', () => {
  expectEqual(describeBulletKind(36, 0)!.motionFamily, 'init_linear');
  expectEqual(describeBulletKind(36, 25)!.motionFamily, 'sine');
  expectEqual(describeBulletKind(36, 2)!.motionFamily, 'homing');
});

test('out-of-range kinds do not resolve', () => {
  expectEqual(describeBulletKind(8), null);
  expectEqual(describeBulletKind(0), null);
  expectEqual(describeBulletKind(999), null);
});

test('species frame lists are contiguous and complete', () => {
  const kusabi = speciesFrames('kusabi');
  expectEqual(kusabi.length, 9);
  expectEqual(kusabi[0], 'kusabi_01.png');
  expectEqual(kusabi[8], 'kusabi_09.png');
  // The multi-word species prefix must survive the frame-prefix parser.
  expectEqual(describeBulletKind(206)!.species, 'en_01');
});

test('animatedFrameFor cycles within a species and is a no-op for singletons', () => {
  // kusabi has 9 frames; at 8 fps the frame advances every 60/8 = 7.5 ticks.
  expectEqual(animatedFrameFor(9, 0), 'kusabi_01.png');
  expectEqual(animatedFrameFor(9, 7), 'kusabi_01.png');
  expectEqual(animatedFrameFor(9, 8), 'kusabi_02.png');
  expectEqual(animatedFrameFor(9, 60), 'kusabi_09.png');
  // 9 frames at 8 fps ⇒ the cycle wraps after 9 * 7.5 = 67.5 ticks.
  expectEqual(animatedFrameFor(9, 68), 'kusabi_01.png');
  // unzan (224) has a single frame, so the frame never changes.
  expectEqual(animatedFrameFor(224, 100), 'unzan_01.png');
});

test('directional species rotate; round species do not', () => {
  expect(isRotatingSpecies('arrow'), 'arrow should rotate');
  expect(isRotatingSpecies('knife'), 'knife should rotate');
  expect(!isRotatingSpecies('ring'), 'ring should stay upright');
  expect(!isRotatingSpecies('stama'), 'stama should stay upright');
  expectEqual(spriteRotationDeg(90), 360);
});

test('buildBossRaceFrame carries the real-danmaku fields through', () => {
  const frame = frameFor([
    bullet({ bulletId: 'tna', bulletKind: 36, motionFunc: 25, angleDeg: 90, vxMilli: 0, vyMilli: 1000 }),
    bullet({ bulletId: 'legacy', patternId: 'ring' }),
  ]);
  const byId = new Map(frame.bullets.map((b) => [b.bulletId, b]));
  const tna = byId.get('tna')!;
  expectEqual(tna.bulletKind, 36);
  expectEqual(tna.motionFamily, 'sine');
  expectClose(tna.angleDeg, 90, 1e-9, 'server heading preserved');
  const legacy = byId.get('legacy')!;
  expectEqual(legacy.bulletKind, -1);
  expectEqual(legacy.motionFamily, 'unknown');
});
