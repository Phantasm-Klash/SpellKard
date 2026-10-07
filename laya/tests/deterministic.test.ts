/**
 * Deterministic math parity tests.
 *
 * Expected values were produced by the upstream implementations themselves:
 *  - `det_u32` / `fnv1a32` mirror `godot/scripts/bullet_math.gd`.
 *  - `boss_u32` mirrors `PhK-BattleServer/src/boss_race.cpp`.
 *  - `conv` mirrors `PhK-BattleServer/src/handshake.cpp` (`DeriveDevKcpConv`).
 * Any drift here means client prediction will diverge from the server.
 */

import {
  bossRaceDeterministicU32,
  bossRaceDeterministicUnit,
  canonicalHashPair,
  deterministicRange,
  deterministicU32,
  deterministicUnit,
  fnv1a32,
  mix32,
} from '../src/core/math/deterministic';
import { deriveDevKcpConv, fnv1a64, fnv1a64Hex } from '../src/core/math/hash64';
import { expectEqual, suite, test } from './harness';

suite('deterministic math');

test('fnv1a32 matches the Godot/C++ 32-bit FNV-1a', () => {
  expectEqual(fnv1a32('ring'), 4149934955);
  expectEqual(fnv1a32('boss_race'), 193329620);
  expectEqual(fnv1a32(''), 2166136261);
});

test('mix32 is a stable 32-bit finalizer', () => {
  expectEqual(mix32(0), 0);
  expectEqual(mix32(1), 1753845952);
  expectEqual(mix32(2719486880), 1038280614);
});

test('deterministicU32 matches bullet_math.gd vectors', () => {
  expectEqual(deterministicU32(20260625, 0, 'ring', 0, 0), 3561139816);
  expectEqual(deterministicU32(20260625, 45, 'ring', 7, 1), 3337751894);
  expectEqual(deterministicU32(1, 2, 'n_way', 3, 2), 2486199690);
});

test('deterministicUnit/Range stay inside their ranges', () => {
  const unit = deterministicUnit(7, 11, 'seeded_arc', 3, 1);
  expectEqual(unit >= 0 && unit < 1, true);
  const range = deterministicRange(7, 11, 'seeded_arc', 3, 1, -5, 5);
  expectEqual(range >= -5 && range <= 5, true);
});

test('bossRaceDeterministicU32 matches boss_race.cpp vectors', () => {
  expectEqual(bossRaceDeterministicU32(0x00010203, 45, 4, 0), 2719486880);
  expectEqual(bossRaceDeterministicU32(0x00010203, 90, 4, 0), 679604649);
  expectEqual(bossRaceDeterministicU32(123456789, 180, 4, 0), 155141612);
});

test('bossRaceDeterministicUnit is the u32 modulo-10000 unit value', () => {
  const unit = bossRaceDeterministicUnit(0x00010203, 45, 4, 0);
  expectEqual(unit, (2719486880 % 10000) / 10000);
});

test('fnv1a64 matches the C++ 64-bit FNV-1a and its offset basis', () => {
  expectEqual(fnv1a64Hex('match-mvp-001:p1'), '8fe19989fc58d457');
  expectEqual(fnv1a64('').toString(16), (1469598103934665603n).toString(16));
});

test('deriveDevKcpConv matches the battle server conv derivation', () => {
  expectEqual(deriveDevKcpConv('match-mvp-001', 'p1'), 4233679959);
  expectEqual(deriveDevKcpConv('match-mvp-001', 'p2'), 4233680394);
});

test('canonicalHashPair emits the 16-hex-char C++ state hash shape', () => {
  const hash = canonicalHashPair('match|1|2|1||0|p:p1:0:0:6000:0|b:0');
  expectEqual(hash.length, 16);
  expectEqual(/^[0-9a-f]{16}$/.test(hash), true);
});
