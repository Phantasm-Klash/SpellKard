/**
 * Caret placement tests.
 *
 * The maths is pure, so a deterministic measurer makes every expectation exact:
 * `measure` below reports 10 units per UTF-16 code unit, which turns the
 * boundary search into simple arithmetic. The cases pin the three properties
 * the platform layer relies on:
 *  - a caret never lands inside a surrogate pair;
 *  - a pointer offset snaps to the nearer boundary, ties going left;
 *  - a non-finite offset is treated as "no position", not "the end".
 */

import { caretBoundaries, caretIndexAtX, textOriginX } from '../src/core/text/caret';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

/** Deterministic measurer: every UTF-16 code unit is 10 units wide. */
const measure = (text: string): number => text.length * 10;

suite('caret: boundaries');

test('caretBoundaries lists every code-point boundary', () => {
  expectDeepEqual(caretBoundaries(''), [0], 'the empty string still has one slot');
  expectDeepEqual(caretBoundaries('abc'), [0, 1, 2, 3]);
  // 😀 is one code point but two UTF-16 units, so the pair is a single step.
  expectDeepEqual(caretBoundaries('a😀b'), [0, 1, 3, 4]);
});

suite('caret: index from x');

test('a pointer offset snaps to the nearer boundary (ties left)', () => {
  expectEqual(caretIndexAtX('abcdef', 0, measure), 0);
  // 5 is exactly midway between the boundaries at 0 and 10, and the snap test
  // is `<=`, so it stays on the left boundary.
  expectEqual(caretIndexAtX('abcdef', 5, measure), 0);
  expectEqual(caretIndexAtX('abcdef', 15, measure), 1);
  expectEqual(caretIndexAtX('abcdef', 25, measure), 2);
  expectEqual(caretIndexAtX('abcdef', 60, measure), 6, 'exactly at the end');
  expectEqual(caretIndexAtX('abcdef', 999, measure), 6, 'past the end clamps to the end');
});

test('negative, NaN and Infinity x mean "before the first character"', () => {
  expectEqual(caretIndexAtX('abcdef', -5, measure), 0);
  expectEqual(caretIndexAtX('abcdef', Number.NaN, measure), 0);
  // The implementation rejects every non-finite offset up front, so Infinity
  // is treated like NaN and yields 0 — NOT the text length.
  expectEqual(caretIndexAtX('abcdef', Number.POSITIVE_INFINITY, measure), 0);
});

test('empty text always reports index 0', () => {
  for (const x of [-10, 0, 42, Number.POSITIVE_INFINITY]) {
    expectEqual(caretIndexAtX('', x, measure), 0, `x=${x}`);
  }
});

test('a per-code-point measurer keeps CJK indices correct', () => {
  // Each of the four BMP characters is one code point wide, 20 units each.
  const cjk = (text: string): number => Array.from(text).length * 20;
  expectEqual(caretIndexAtX('纷争幻想', 45, cjk), 2);
  expectEqual(caretIndexAtX('纷争幻想', 41, cjk), 2);
});

suite('caret: text origin');

test('textOriginX aligns the text inside the box', () => {
  expectEqual(textOriginX('left', 100, 40), 0, 'left with no padding starts at 0');
  expectEqual(textOriginX('center', 100, 40), 30, 'center takes half the slack');
  expectEqual(textOriginX('right', 100, 40), 60, 'right takes all the slack');
});

test('textOriginX honours paddingLeft and never goes negative', () => {
  expectEqual(textOriginX('left', 100, 40, 7), 7, 'padding shifts a left-aligned box');
  expectEqual(textOriginX('center', 100, 40, 10), 35, 'center adds the padding back');
  // Text wider than the box leaves no slack, so the origin is the padding.
  expectEqual(textOriginX('right', 50, 90), 0);
  const origin = textOriginX('center', 50, 90, 4);
  expect(origin >= 0, 'the origin must never be negative');
});

test('textOriginX falls back to left for an unknown alignment', () => {
  expectEqual(textOriginX('weird', 100, 40, 3), 3);
});
