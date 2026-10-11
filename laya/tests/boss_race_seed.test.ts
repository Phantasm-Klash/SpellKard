/**
 * Battle-seed width tests.
 *
 * The lobby mints the seed as `seedFrom(matchID)` — eight bytes of
 * `sha256("gensoulkyo:" + matchID)` as a signed int64, negated when negative —
 * and publishes `server_seed_hex` as sixteen hex digits. The C++ server keeps it
 * in a `std::uint64_t` and prints it **in full** into both its RNG material and
 * `CanonicalStateHash`.
 *
 * The client used to fold that hex into 32 bits, so above `2 ** 32` the seed the
 * RNG and the hash saw was simply wrong (and above `2 ** 53` it could not even be
 * a JS number). These tests pin the exact conversion.
 */

import {
  ZERO_BOSS_RACE_SEED,
  bossRaceSeedFromHex,
  bossRaceSeedFromU32,
  normalizeBossRaceSeed,
} from '../src/core/math/boss_race_seed';
import { bossRaceDeterministicU32 } from '../src/core/math/deterministic';
import { expect, expectEqual, suite, test } from './harness';

suite('battle seed width');

test('a zero seed is the zero seed', () => {
  expectEqual(bossRaceSeedFromHex('0000000000000000').decimal, '0');
  expectEqual(bossRaceSeedFromHex('0000000000000000').low32, 0);
  expectEqual(bossRaceSeedFromHex('0000000000000000').hi32, 0);
  expectEqual(bossRaceSeedFromHex(''), ZERO_BOSS_RACE_SEED, 'an empty hex string is the zero seed');
});

test('the full 64-bit value survives as decimal text', () => {
  // 2 ** 32: the old 32-bit fold returned 0 here, so the RNG material and the
  // hash material both disagreed with the server.
  const twoPow32 = bossRaceSeedFromHex('0000000100000000');
  expectEqual(twoPow32.decimal, '4294967296');
  expectEqual(twoPow32.low32, 0);
  expectEqual(twoPow32.hi32, 1, 'the high half must survive too — the danmaku RNG feeds all 8 bytes');

  // 2 ** 63 + 1 — far beyond `Number.MAX_SAFE_INTEGER`, so only string
  // arithmetic can keep it exact.
  const wide = bossRaceSeedFromHex('8000000000000001');
  expectEqual(wide.decimal, '9223372036854775809');
  expectEqual(wide.low32, 1);
  expectEqual(wide.hi32, 0x80000000 >>> 0);

  const max = bossRaceSeedFromHex('ffffffffffffffff');
  expectEqual(max.decimal, '18446744073709551615');
  expectEqual(max.low32, 4294967295);
  expectEqual(max.hi32, 4294967295);

  // A real lobby seed: `server_seed_hex=5d4db41532808f4b`.
  const live = bossRaceSeedFromHex('5d4db41532808f4b');
  expectEqual(live.low32, 0x32808f4b >>> 0);
  expectEqual(live.hi32, 0x5d4db415 >>> 0);
});

test('a narrow hex seed matches the plain-number form', () => {
  const fromHex = bossRaceSeedFromHex('00010203');
  expectEqual(fromHex.decimal, '66051');
  expectEqual(fromHex.low32, bossRaceSeedFromU32(0x00010203).low32);
  expectEqual(fromHex.decimal, bossRaceSeedFromU32(0x00010203).decimal);

  // A `0x` prefix and stray separators are tolerated, matching `hexToBytes`.
  expectEqual(bossRaceSeedFromHex('0x0001-0203').decimal, '66051');
});

test('normalizeBossRaceSeed passes objects through and widens numbers', () => {
  const seed = bossRaceSeedFromHex('00000000deadbeef');
  expectEqual(normalizeBossRaceSeed(seed), seed, 'an object is returned unchanged');
  expectEqual(normalizeBossRaceSeed(0xdeadbeef).decimal, '3735928559');
});

test('the RNG material uses the wide seed, not its low 32 bits', () => {
  // Two seeds that share their low 32 bits but differ above them must hash
  // differently — that difference is exactly what the 32-bit fold destroyed.
  const wide = bossRaceSeedFromHex('0000000100000000');
  const narrow = bossRaceSeedFromHex('0000000000000000');
  expectEqual(wide.low32, narrow.low32, 'the two seeds share their low 32 bits');
  expect(
    bossRaceDeterministicU32(wide, 45, 4, 0) !== bossRaceDeterministicU32(narrow, 45, 4, 0),
    'the wide seed produces a different unit value',
  );
  expectEqual(
    bossRaceDeterministicU32(narrow, 45, 4, 0),
    bossRaceDeterministicU32(0, 45, 4, 0),
    'a number argument still behaves like the narrow seed',
  );
});
