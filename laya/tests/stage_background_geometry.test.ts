/**
 * `core/game/stage_visual` — the pure geometry behind the four-sprite stage
 * background.
 *
 * Every expected value is derived by hand from the tuning constants and the
 * spec figures (e.g. `1 px/frame * 60 fps * 1 s = 60 px`, `0.25°/frame * 60 =
 * 15°/s`, `512 % 512 = 0`), so the test fails if the arithmetic drifts. No Laya
 * sprite is touched.
 */

import { DEFAULT_STAGE_BACKGROUND_TUNING } from '../src/core/game/tna_stage_tuning';
import {
  advanceOffset,
  backgroundScale,
  frameCounter,
  layer1ScrollOffset,
  layer2RotationDeg,
  layerTileOffsets,
  wrapOffset,
} from '../src/core/game/stage_visual';
import { expect, expectClose, expectEqual, suite, test } from './harness';

suite('stage background geometry');

test('wrapOffset lands in [0, tileSize) for positive and negative offsets', () => {
  expectEqual(wrapOffset(0, 256), 0);
  expectEqual(wrapOffset(10, 256), 10);
  expectEqual(wrapOffset(256, 256), 0, 'a whole tile wraps to zero');
  expectEqual(wrapOffset(400, 256), 144, '400 - 256 = 144');
  expectEqual(wrapOffset(-10, 256), 246, 'a negative offset wraps forward');
  expectEqual(wrapOffset(5, 0), 0, 'a zero tile size has no wrap');
});

test('advanceOffset moves by pxPerSecond * dt / 1000', () => {
  expectEqual(advanceOffset(0, 40, 250), 10, '40 px/s over 250 ms = 10 px');
  expectEqual(advanceOffset(0, 12, 1000), 12, '12 px/s over 1 s = 12 px');
  expectEqual(advanceOffset(100, 40, 10000), 500, '400 px added to an existing offset');
  expectEqual(advanceOffset(7, Number.NaN, 100), 7, 'a garbage speed leaves the offset alone');
  expectEqual(advanceOffset(7, 40, Number.NaN), 7, 'a garbage delta leaves the offset alone');
});

test('backgroundScale maps the 480 px reference stage onto the covered height', () => {
  expectEqual(backgroundScale(480, 480), 1, 'the reference height is 1:1');
  expectEqual(backgroundScale(960, 480), 2, 'twice the height scales by 2');
  expectEqual(backgroundScale(0, 480), 1, 'a degenerate height falls back to 1, not 0');
  expectEqual(backgroundScale(Number.NaN, 480), 1);
  expectEqual(backgroundScale(480, 0), 1, 'a degenerate reference height falls back to 1');
});

test('frameCounter advances one per frame at the reference rate', () => {
  expectEqual(frameCounter(0, 60), 0);
  expectClose(frameCounter(1000, 60), 60, 1e-9, '1 s at 60 fps = 60 frames');
  expectClose(frameCounter(500, 60), 30, 1e-9);
  expectEqual(frameCounter(-100, 60), 0, 'negative elapsed time clamps to 0');
  expectEqual(frameCounter(100, 0), 0, 'a zero frame rate yields no frames');
});

test('layer1ScrollOffset is pxPerFrame * frames (60 px/s at the spec rate)', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  expectEqual(
    layer1ScrollOffset(1000, tuning.layer1ScrollPxPerFrame, tuning.framesPerSecond),
    60,
    '1 px/frame at 60 fps for 1 s = 60 px',
  );
  expectEqual(layer1ScrollOffset(500, tuning.layer1ScrollPxPerFrame, tuning.framesPerSecond), 30);
  expectEqual(layer1ScrollOffset(0, tuning.layer1ScrollPxPerFrame, tuning.framesPerSecond), 0);
});

test('layerTileOffsets returns two tiles one spacing apart, scrolling down', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  const spacing = tuning.layer1SpacingPx;
  const speed = tuning.layer1ScrollPxPerFrame;
  const fps = tuning.framesPerSecond;

  const [a0, b0] = layerTileOffsets(0, spacing, speed, fps);
  expectEqual(a0, -spacing, 'at t=0 the first tile sits one spacing above the centre');
  expectEqual(b0, 0, 'and the second sits exactly on the centre');

  // 1 s → 60 px scrolled down, wrapped into [0, 512).
  const [a1, b1] = layerTileOffsets(1000, spacing, speed, fps);
  expectClose(a1, 60 - spacing, 1e-6, 'first tile: 60 - 512');
  expectClose(b1, 60, 1e-6, 'second tile: 60');
  expectClose(b1 - a1, spacing, 1e-6, 'the pair is always one spacing apart');

  // One full spacing of scroll wraps the pattern back to its start. A spacing
  // of 60 px makes 1 s of scroll land exactly on the wrap boundary.
  const [aW, bW] = layerTileOffsets(1000, 60, 1, 60);
  expectEqual(aW, -60, 'a whole spacing wraps the first tile back');
  expectEqual(bW, 0, 'and the second back onto the centre');
});

test('the layer-1 tile pair always covers a stage of the covered height', () => {
  // Two tiles of displayed height `spacing` centred on the layer centre cover
  // `2 * spacing` around it; the invariant is that this reaches both edges.
  for (const height of [480, 720, 1080, 1440]) {
    const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
    const factor = backgroundScale(height, tuning.referenceStageHeight);
    const spacing = tuning.layer1SpacingPx * factor;
    expect(spacing >= height, `spacing ${spacing} must reach a ${height}px stage`);
  }
});

test('layerTileOffsets degrades to a zero pair without a usable spacing', () => {
  expectEqual(layerTileOffsets(1000, 0, 1, 60)[0], 0);
  expectEqual(layerTileOffsets(1000, 0, 1, 60)[1], 0);
  expectEqual(layerTileOffsets(1000, Number.NaN, 1, 60)[1], 0);
});

test('layer2RotationDeg turns ±0.25 deg/frame (±15 deg/s) with the sign', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  const deg = tuning.layer2RotationDegPerFrame;
  const fps = tuning.framesPerSecond;
  expectClose(layer2RotationDeg(1000, deg, fps, 1), 15, 1e-9, '+0.25 * 60 frames = +15 deg');
  expectClose(layer2RotationDeg(1000, deg, fps, -1), -15, 1e-9, 'the second tile mirrors it');
  expectClose(layer2RotationDeg(2000, deg, fps, -1), -30, 1e-9);
  expectEqual(layer2RotationDeg(0, deg, fps, 1), 0, 'no rotation before the first frame');
});
