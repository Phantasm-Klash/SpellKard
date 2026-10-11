/**
 * Battle layout regression tests.
 *
 * `battleLayout` tiles a stage into a 2:3 portrait playfield plus the status
 * panel on the right. The panel is capped at `MAX_HUD_WIDTH`, so on a wide
 * stage the two panes no longer fill the stage edge to edge — instead the block
 * is centred and the leftover space becomes margins. When `stageWidth -
 * contentWidth` is odd the block cannot be centred exactly; the extra pixel is
 * deliberately given to the right margin, so the invariants these tests pin are
 * the ones that hold for *every* stage size:
 *
 *   playfieldX >= 0
 *   playfieldX + playfieldWidth + hudWidth <= stageWidth
 *   hudX === playfieldX + playfieldWidth
 *   rightGutter === stageWidth - playfieldX - playfieldWidth - hudWidth
 *   rightGutter >= playfieldX
 *   rightGutter - playfieldX <= 1
 *
 * `rightGutter` is the actual empty strip on the right of the stage, so it
 * equals `playfieldX` on even stages and `playfieldX + 1` on odd ones.
 * Degenerate inputs must never yield negative sizes.
 */

import {
  battleLayout,
  MAX_HUD_WIDTH,
  MIN_HUD_WIDTH,
  PLAYFIELD_ASPECT,
  type BattleLayout,
} from '../src/core/game/battle_layout';
import { expect, expectEqual, suite, test } from './harness';

suite('battle layout');

/**
 * Assert the invariants that hold for every stage size, including odd gutters.
 * `rightGutter` is the actual empty strip on the right of the stage, so it is
 * `playfieldX` or `playfieldX + 1` — the left margin never exceeds it and the
 * two margins differ by at most one pixel.
 */
function assertInvariants(layout: BattleLayout, stageWidth: number): void {
  const contentWidth = layout.playfield.width + layout.hudWidth;
  expect(layout.playfieldX >= 0, 'the left margin is non-negative');
  expect(
    layout.playfieldX + contentWidth <= stageWidth,
    'the content block never overflows the stage',
  );
  expectEqual(layout.hudX, layout.playfieldX + layout.playfield.width, 'the panel sits flush after the playfield');
  expectEqual(
    layout.rightGutter,
    stageWidth - layout.playfieldX - layout.playfield.width - layout.hudWidth,
    'rightGutter is the empty strip right of the HUD',
  );
  expect(layout.rightGutter >= layout.playfieldX, 'the right margin is at least the left margin');
  expect(
    layout.rightGutter - layout.playfieldX <= 1,
    'the left and right margins differ by at most one pixel',
  );
}

test('portrait 900x1200 clamps the playfield to keep the panel at its minimum width', () => {
  // idealPlayfieldWidth = round(1200 / 1.5) = 800, but that would leave the
  // panel only 100px, so `MIN_HUD_WIDTH` clamps the playfield to 900 - 240 = 660.
  const layout = battleLayout(900, 1200);
  expectEqual(layout.playfield.width, 660);
  expectEqual(layout.playfield.height, 990);
  expectEqual(layout.hudWidth, 240);
  expectEqual(layout.playfieldX, 0);
  expectEqual(layout.playfieldY, 105);
  expectEqual(layout.hudX, 660);
  expectEqual(layout.hudHeight, 1200);
  assertInvariants(layout, 900);
});

test('landscape 960x720 caps the panel and centres the content', () => {
  // playfield = 480 (full height), leftover = 480 which is over the 420 cap, so
  // the panel stops at 420 and the 60px remainder is split into 30px margins.
  const layout = battleLayout(960, 720);
  expectEqual(layout.playfield.width, 480);
  expectEqual(layout.playfield.height, 720);
  expectEqual(layout.hudWidth, 420);
  expectEqual(layout.playfieldX, 30);
  expectEqual(layout.hudX, 510);
  expectEqual(layout.playfieldY, 0);
  assertInvariants(layout, 960);
});

test('square 800x800 tiles without a vertical gap', () => {
  const layout = battleLayout(800, 800);
  expectEqual(layout.playfield.width, 533);
  expectEqual(layout.hudWidth, 267);
  expectEqual(layout.playfieldX, 0);
  expectEqual(layout.playfieldY, 0);
  assertInvariants(layout, 800);
});

test('a stage narrower than the panel yields the playfield entirely', () => {
  const layout = battleLayout(200, 1200);
  expectEqual(layout.playfield.width, 0, 'the playfield is clamped, never negative');
  expectEqual(layout.playfield.height, 0);
  expectEqual(layout.hudWidth, 200);
  expectEqual(layout.playfieldX, 0);
  expect(layout.playfieldY >= 0, 'the vertical offset stays non-negative');
  assertInvariants(layout, 200);
});

test('a wide stage caps the panel at MAX_HUD_WIDTH and keeps margins symmetric', () => {
  // 1920x1080 (16:9): playfield 720x1080, leftover 1200 is capped to 420, so
  // 390px is left on each side.
  const layout = battleLayout(1920, 1080);
  expectEqual(layout.playfield.width, 720);
  expectEqual(layout.playfield.height, 1080);
  expectEqual(layout.hudWidth, MAX_HUD_WIDTH);
  expectEqual(layout.hudWidth, 420);
  expectEqual(layout.playfieldX, 390);
  expectEqual(layout.hudX, 1110);
  expectEqual(layout.playfieldY, 0);
  assertInvariants(layout, 1920);
});

test('the 1333x750 reference case matches the documented geometry', () => {
  // Odd remainder (1333 - 920 = 413) so the centre floors the left margin to
  // 206 and the actual empty strip on the right is 207 (playfieldX + 1). The
  // block is flush-left first, so it never overhangs the stage.
  const layout = battleLayout(1333, 750);
  expectEqual(layout.playfield.width, 500);
  expectEqual(layout.playfield.height, 750);
  expectEqual(layout.hudWidth, MAX_HUD_WIDTH);
  expectEqual(layout.playfieldX, 206);
  expectEqual(layout.hudX, 706);
  expectEqual(layout.playfieldY, 0);
  expectEqual(layout.rightGutter, 207);
  assertInvariants(layout, 1333);
});

test('degenerate stages never produce negative sizes', () => {
  const stages: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [-100, -100],
    [-1, 1200],
    [900, -1],
  ];
  for (const [width, height] of stages) {
    const layout = battleLayout(width, height);
    const label = `${width}x${height}`;
    expect(layout.playfield.width >= 0, `playfield width >= 0 for ${label}`);
    expect(layout.playfield.height >= 0, `playfield height >= 0 for ${label}`);
    expect(layout.hudWidth >= 0, `hud width >= 0 for ${label}`);
    expect(layout.hudHeight >= 0, `hud height >= 0 for ${label}`);
    expect(layout.playfieldY >= 0, `playfieldY >= 0 for ${label}`);
  }
});

test('the playfield keeps its 2:3 aspect at every stage size', () => {
  const stages: ReadonlyArray<readonly [number, number]> = [
    [900, 1200],
    [960, 720],
    [800, 800],
    [200, 1200],
    [1920, 1080],
    [1333, 750],
  ];
  for (const [width, height] of stages) {
    const layout = battleLayout(width, height);
    expectEqual(
      layout.playfield.height,
      Math.round(layout.playfield.width * PLAYFIELD_ASPECT),
      `aspect for ${width}x${height}`,
    );
  }
  expectEqual(PLAYFIELD_ASPECT, 1.5);
  expectEqual(MIN_HUD_WIDTH, 240);
  expectEqual(MAX_HUD_WIDTH, 420);
});
