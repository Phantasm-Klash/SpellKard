/**
 * Match countdown tests.
 *
 * The HUD countdown is the one place the client shows a *derived* time from a
 * server-owned number, so the interesting cases are the edges: an unknown tick
 * limit must render nothing at all (never a plausible `0:00`), the clock must
 * round up so it only reads `0:00` once the match is genuinely over, and a tick
 * past the limit must clamp rather than go negative.
 */

import { BOSS_RACE_DEFAULT_MAX_TICKS, BOSS_RACE_TICK_RATE_HZ } from '../src/core/sim/boss_race';
import { formatMatchCountdown } from '../src/core/game/match_clock';
import { expectEqual, suite, test } from './harness';

suite('match clock');

test('an unknown tick limit renders nothing', () => {
  expectEqual(formatMatchCountdown(0, 0), '', 'tickLimit 0 must mean unknown');
  expectEqual(formatMatchCountdown(120, -1), '', 'a negative limit must also mean unknown');
});

test('the default limit counts down from two minutes', () => {
  expectEqual(BOSS_RACE_TICK_RATE_HZ, 60, 'countdown maths assumes a known tick rate');
  expectEqual(formatMatchCountdown(0, BOSS_RACE_DEFAULT_MAX_TICKS), '2:00');
  expectEqual(formatMatchCountdown(BOSS_RACE_TICK_RATE_HZ * 60, BOSS_RACE_DEFAULT_MAX_TICKS), '1:00');
  expectEqual(formatMatchCountdown(BOSS_RACE_TICK_RATE_HZ * 119, BOSS_RACE_DEFAULT_MAX_TICKS), '0:01');
});

test('seconds are zero-padded so the clock width does not jump', () => {
  expectEqual(formatMatchCountdown(0, 60 * 65), '1:05');
  expectEqual(formatMatchCountdown(0, 60 * 5), '0:05');
});

test('the clock rounds up, so it reads 0:00 only when the match is over', () => {
  // One tick left is still a tick of match time: ceil(1/60) == 1 second.
  expectEqual(formatMatchCountdown(59, 60), '0:01');
  expectEqual(formatMatchCountdown(60, 60), '0:00');
});

test('a tick past the limit clamps to zero instead of going negative', () => {
  expectEqual(formatMatchCountdown(9999, 60), '0:00');
  // A negative tick means "before the start"; it must clamp to a full clock,
  // never extend past the limit.
  expectEqual(formatMatchCountdown(-10, 60), '0:01', 'a negative tick counts as tick 0');
});

test('a non-positive tick rate falls back to the simulation default', () => {
  expectEqual(formatMatchCountdown(0, 120, 0), '0:02');
  expectEqual(formatMatchCountdown(0, 120, -30), '0:02');
});
