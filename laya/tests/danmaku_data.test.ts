/**
 * Real-danmaku data-table tests (千夜追忆 port).
 *
 * Locks the client mirrors to the shared contract:
 *  1. `BulletKind` — 216 values 9..224, unique, each mapped to an atlas frame,
 *     43 species covering every kind exactly once.
 *  2. `BulletMotion` — 79 funcs, unique, every one classified into a family.
 *  3. `PlayerLoadout` — 52 shots + 13 bombs with sane fields.
 *
 * NOTE: `src/core/sim/danmaku/*` are generated from
 * `PhK-Protocol/data/tna_contract.json` by `tools/gen_danmaku_ts.py`; these
 * tests are the client-side guard that the generated data is complete.
 */

import {
  BULLET_KIND_COUNT,
  BULLET_KIND_MAX,
  BULLET_KIND_MIN,
  BULLET_KINDS,
  BULLET_SPECIES,
  bulletKindInfo,
  isBulletKind,
} from '../src/core/sim/danmaku/bullet_kind';
import {
  BULLET_MOTION_COUNT,
  BULLET_MOTIONS,
  bulletMotionFamily,
  bulletMotionInfo,
  knownBulletMotionFuncs,
} from '../src/core/sim/danmaku/bullet_motion';
import {
  PLAYER_BOMB_COUNT,
  PLAYER_BOMBS,
  PLAYER_SHOT_COUNT,
  PLAYER_SHOTS,
} from '../src/core/sim/danmaku/player_loadout';
import { expect, expectEqual, suite, test } from './harness';

suite('danmaku bullet kinds');

test('there are exactly 216 kinds spanning the original enum range', () => {
  expectEqual(BULLET_KIND_COUNT, 216);
  expectEqual(BULLET_KINDS.length, 216);
  expectEqual(BULLET_KIND_MIN, 9);
  expectEqual(BULLET_KIND_MAX, 224);
});

test('kind values are unique and contiguous from 9 to 224', () => {
  const seen = new Set<number>();
  for (const kind of BULLET_KINDS) {
    expect(!seen.has(kind.type), `duplicate kind ${kind.type}`);
    seen.add(kind.type);
  }
  expectEqual(seen.size, 216);
  for (let type = BULLET_KIND_MIN; type <= BULLET_KIND_MAX; type += 1) {
    expect(seen.has(type), `missing kind ${type}`);
  }
});

test('every kind carries an atlas and a frame name', () => {
  for (const kind of BULLET_KINDS) {
    expect(kind.atlas !== '', `kind ${kind.type} has no atlas`);
    expect(/\.png$/.test(kind.frame), `kind ${kind.type} frame not a .png: ${kind.frame}`);
  }
});

test('lookups return the same data and reject out-of-range values', () => {
  const info = bulletKindInfo(9);
  expect(info !== undefined, 'kind 9 should exist');
  expectEqual(info!.frame, 'kusabi_01.png');
  expectEqual(info!.atlas, 'bulletlist01');
  expectEqual(bulletKindInfo(224)?.frame, 'unzan_01.png');
  expectEqual(bulletKindInfo(8), undefined);
  expectEqual(bulletKindInfo(225), undefined);
  expect(isBulletKind(9), '9 is valid');
  expect(!isBulletKind(0), '0 is not a kEnemyBullet value');
  expect(!isBulletKind(300), '300 is not a kEnemyBullet value');
});

test('the 43 species partition every kind exactly once', () => {
  expectEqual(BULLET_SPECIES.length, 43);
  const covered = new Set<number>();
  for (const species of BULLET_SPECIES) {
    expect(species.types.length >= 1, `species ${species.species} is empty`);
    for (const type of species.types) {
      expect(!covered.has(type), `type ${type} belongs to two species`);
      covered.add(type);
      expect(isBulletKind(type), `species lists invalid type ${type}`);
    }
  }
  expectEqual(covered.size, 216);
});

suite('danmaku bullet motions');

test('there are exactly 79 motions with unique func numbers', () => {
  expectEqual(BULLET_MOTION_COUNT, 79);
  expectEqual(BULLET_MOTIONS.length, 79);
  const funcs = new Set(knownBulletMotionFuncs());
  expectEqual(funcs.size, 79);
  for (const func of funcs) {
    expect(func >= 0 && func <= 85, `func ${func} out of the 0..85 range`);
  }
});

test('every motion resolves to a known family', () => {
  const valid = new Set([
    'init_linear',
    'accelerate',
    'sine',
    'homing',
    'aimed',
    'bounce',
    'proximity',
    'split',
    'reskin',
    'parametric',
    'state_machine',
    'auxiliary',
    'unknown',
  ]);
  for (const motion of BULLET_MOTIONS) {
    const family = bulletMotionFamily(motion.func);
    expect(valid.has(family), `func ${motion.func} → unexpected family ${family}`);
    expect(bulletMotionInfo(motion.func) !== undefined, `func ${motion.func} missing metadata`);
  }
});

test('the well-understood families are not misclassified as unknown', () => {
  // Spot-check funcs whose family is unambiguous in the reverse-engineering doc.
  expectEqual(bulletMotionFamily(0), 'init_linear');
  expectEqual(bulletMotionFamily(2), 'homing');
  expectEqual(bulletMotionFamily(5), 'accelerate');
  expectEqual(bulletMotionFamily(25), 'sine');
  expectEqual(bulletMotionFamily(31), 'split');
  expectEqual(bulletMotionFamily(1), 'bounce');
  expectEqual(bulletMotionFamily(13), 'aimed');
  expectEqual(bulletMotionFamily(37), 'sine');
  expectEqual(bulletMotionFamily(46), 'bounce');
});

test('unknown func numbers fall back to unknown', () => {
  expectEqual(bulletMotionFamily(999), 'unknown');
  expectEqual(bulletMotionInfo(999), undefined);
});

suite('player loadout');

test('the 52 shots and 13 bombs are all present', () => {
  expectEqual(PLAYER_SHOT_COUNT, 52);
  expectEqual(PLAYER_SHOTS.length, 52);
  expectEqual(PLAYER_BOMB_COUNT, 13);
  expectEqual(PLAYER_BOMBS.length, 13);
});

test('shot specs have sane volley/angle/speed data', () => {
  const names = new Set<string>();
  for (const shot of PLAYER_SHOTS) {
    expect(!names.has(shot.name), `duplicate shot ${shot.name}`);
    names.add(shot.name);
    expect(shot.volleyN >= 0, `${shot.name} negative volley`);
    expect(shot.speedN >= 0, `${shot.name} negative speed`);
    expect(shot.chara !== '', `${shot.name} missing character`);
    for (const angle of shot.anglesDeg) {
      expect(angle >= 0 && angle <= 360, `${shot.name} angle ${angle} out of range`);
    }
  }
});

test('bomb specs cover 13 characters with valid durations', () => {
  const chars = new Set<string>();
  for (const bomb of PLAYER_BOMBS) {
    expect(!chars.has(bomb.chara), `duplicate bomb character ${bomb.chara}`);
    chars.add(bomb.chara);
    expect(bomb.parts.length >= 1, `${bomb.chara} bomb has no parts`);
    expect(bomb.totalFrames > 0, `${bomb.chara} bomb totalFrames must be positive`);
    expect(
      bomb.invulnFrames >= bomb.totalFrames,
      `${bomb.chara} invuln (${bomb.invulnFrames}) should cover the whole bomb (${bomb.totalFrames})`,
    );
    for (const part of bomb.parts) {
      expect(part.type >= 62 && part.type <= 82, `${bomb.chara} bomb type ${part.type} out of 62..82`);
      expect(part.texture.startsWith('mybomb_'), `${bomb.chara} bomb texture ${part.texture}`);
    }
  }
  expectEqual(chars.size, 13);
});
