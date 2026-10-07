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
import { classifyPattern, knownPatternIds, type BulletVisualClass } from '../src/core/game/bullet_visual';
import { expect, expectClose, expectEqual, suite, test } from './harness';

/** width == full arena width ⇒ scale 1.0, so milli-units map 1:1 to pixels. */
const LAYOUT: PlayfieldLayout = { width: 240000, height: 180000 };

const VALID_CLASSES: readonly BulletVisualClass[] = ['orb', 'arrow', 'capsule', 'stream'];

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
  // scale 1.0 and arena half-width 120000 ⇒ pixel x is milli + 120000.
  expectClose(item.position.x, 120000 + 1500, 1e-6, 'position should be halfway');
});

test('the classifier assigns every simulated pattern id to a known family', () => {
  for (const patternId of BOSS_RACE_PATTERN_IDS) {
    const family = classifyPattern(patternId);
    expect(
      VALID_CLASSES.includes(family),
      `pattern ${patternId} mapped to unexpected family ${family}`,
    );
  }
  // The classifier's own list must cover exactly the simulation's list.
  expectEqual(knownPatternIds().length, BOSS_RACE_PATTERN_IDS.length, 'known pattern count');
  for (const patternId of knownPatternIds()) {
    expect(
      (BOSS_RACE_PATTERN_IDS as readonly string[]).includes(patternId),
      `classifier knows unknown pattern ${patternId}`,
    );
  }
});

test('pattern families are visually distinct (all four families are used)', () => {
  const families = new Set(BOSS_RACE_PATTERN_IDS.map((id) => classifyPattern(id)));
  expectEqual(families.size, VALID_CLASSES.length, 'all visual families should be exercised');
});

test('representative patterns map to their intended families', () => {
  expectEqual(classifyPattern('ring'), 'orb');
  expectEqual(classifyPattern('gap_ring'), 'orb');
  expectEqual(classifyPattern('n_way'), 'orb');
  expectEqual(classifyPattern('blossom'), 'orb');
  expectEqual(classifyPattern('aimed'), 'arrow');
  expectEqual(classifyPattern('homing'), 'arrow');
  expectEqual(classifyPattern('laser_curtain'), 'capsule');
  expectEqual(classifyPattern('spiral'), 'stream');
  expectEqual(classifyPattern('sine_stream'), 'stream');
  expectEqual(classifyPattern('seeded_arc'), 'stream');
});

test('unknown pattern ids fall back to the neutral orb family', () => {
  expectEqual(classifyPattern('does_not_exist'), 'orb');
  expectEqual(classifyPattern(''), 'orb');
});
