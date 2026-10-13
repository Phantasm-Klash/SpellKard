/**
 * `core/game/sfx_throttle` — the per-category SE rate limiter used by
 * `platform/laya/audio_manager`.
 *
 * The clock is passed in explicitly, so the window behaviour is pinned without
 * a wall clock: two events inside the window collapse to one play, a later
 * event passes, and the categories never interfere.
 */

import { SFX_THROTTLE_MS, SfxThrottle } from '../src/core/game/sfx_throttle';
import { expect, expectEqual, suite, test } from './harness';

suite('sfx throttle');

test('the default window is 100 ms', () => {
  expectEqual(SFX_THROTTLE_MS, 100);
});

test('two events in the same window collapse to one play', () => {
  const throttle = new SfxThrottle(SFX_THROTTLE_MS);
  expect(throttle.allow('graze', 1000), 'the first play passes');
  expect(!throttle.allow('graze', 1050), 'a second play 50 ms later is throttled');
  expect(!throttle.allow('graze', 1099), 'still inside the 100 ms window');
});

test('a play exactly one window later passes', () => {
  const throttle = new SfxThrottle(SFX_THROTTLE_MS);
  expect(throttle.allow('graze', 1000), 'the first play passes');
  expect(throttle.allow('graze', 1100), '1100 - 1000 = 100 ms is not "less than" the window');
  expect(!throttle.allow('graze', 1150), 'the window restarts from the last play');
  expect(throttle.allow('graze', 1200), 'a further window later passes again');
});

test('categories are throttled independently', () => {
  const throttle = new SfxThrottle(100);
  expect(throttle.allow('graze', 1000), 'graze plays');
  expect(throttle.allow('skill', 1000), 'skill plays in the same instant');
  expect(throttle.allow('playerShot', 1000), 'playerShot plays in the same instant');
  expect(!throttle.allow('graze', 1001), 'graze is now throttled');
  expect(!throttle.allow('skill', 1001), 'skill is now throttled');
  expect(!throttle.allow('playerShot', 1001), 'playerShot is now throttled');
  expect(throttle.allow('graze', 1100), 'graze plays again a window later');
});

test('reset clears one category or all of them', () => {
  const throttle = new SfxThrottle(100);
  expect(throttle.allow('graze', 1000), 'graze plays');
  expect(throttle.allow('skill', 1000), 'skill plays');
  throttle.reset('graze');
  expect(throttle.allow('graze', 1001), 'the reset category may play again immediately');
  expect(!throttle.allow('skill', 1001), 'the other category is untouched');
  throttle.reset();
  expect(throttle.allow('skill', 1002), 'reset() clears every category');
});

test('a non-finite clock fails open and is not recorded', () => {
  const throttle = new SfxThrottle(100);
  expect(throttle.allow('graze', Number.NaN), 'a NaN clock cannot be rate-limited');
  expect(throttle.allow('graze', Number.NaN), 'a second NaN call also passes');
  expect(throttle.allow('graze', 1000), 'a real clock after a NaN call still starts fresh');
  expect(!throttle.allow('graze', 1001), 'and then throttles normally');
});

test('a non-positive window disables throttling', () => {
  const throttle = new SfxThrottle(0);
  expect(throttle.allow('graze', 1000), 'zero window passes');
  expect(throttle.allow('graze', 1000), 'zero window passes again at the same instant');
  expect(throttle.allow('graze', 1000), 'zero window always passes');
});
