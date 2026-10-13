/**
 * `core/game/stage_visual` — the pure geometry behind the stage background.
 *
 * Every expected value is derived by hand from the tuning constants (e.g.
 * `40 px/s * 250 ms / 1000 = 10 px`, `400 % 256 = 144`), so the test fails if
 * the arithmetic drifts. No Laya sprite is touched.
 */

import { DEFAULT_STAGE_BACKGROUND_TUNING } from '../src/core/game/tna_stage_tuning';
import {
  advanceOffset,
  breatheScale,
  tileCount,
  tileGrid,
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

test('an offset advanced for a while wraps to the hand-computed remainder', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  let offset = 0;
  for (let step = 0; step < 1000; step += 1) {
    offset = advanceOffset(offset, tuning.nearScrollPxPerSecond, 16);
  }
  // 40 px/s * 16 ms * 1000 = 640 px; 640 % 256 = 128. The accumulation is a
  // float sum, so it is compared with a tolerance rather than exactly.
  expectClose(offset, 640, 1e-6, 'the accumulated offset');
  expectClose(wrapOffset(offset, 256), 128, 1e-6, 'the wrapped offset');
});

test('the tile grid covers the stage at the base offset and mid-tile', () => {
  for (const [offsetX, offsetY] of [
    [0, 0],
    [130, 300],
    [255, 255],
  ]) {
    const grid = tileGrid(640, 480, 256, 256, offsetX, offsetY, 1);
    expect(grid.baseX <= 0 && grid.baseX > -256, `baseX in (-256, 0]: ${grid.baseX}`);
    expect(grid.baseY <= 0 && grid.baseY > -256, `baseY in (-256, 0]: ${grid.baseY}`);
    expect(grid.baseX + grid.cols * 256 >= 640, `columns must cover 640 (offsetX=${offsetX})`);
    expect(grid.baseY + grid.rows * 256 >= 480, `rows must cover 480 (offsetY=${offsetY})`);
  }
});

test('tileCount adds one wrapping tile and honours coverage', () => {
  expectEqual(tileCount(640, 256, 1), 4, 'ceil(640/256) + 1 = 3 + 1');
  expectEqual(tileCount(480, 256, 1), 3, 'ceil(480/256) + 1 = 2 + 1');
  expectEqual(tileCount(0, 256, 1), 1, 'a zero span still yields one tile');
  expectEqual(tileCount(256, 0, 1), 1, 'a zero tile size yields one tile');
  // Coverage widens the grid: 5120 / 256 = 20 (+1) becomes 5120/0.9/256 = 22.2 (+1).
  expectEqual(tileCount(5120, 256, 1), 21);
  expectEqual(tileCount(5120, 256, 1 / 0.9), 24);
});

test('coverage keeps the shrunk (scaleMin) layer covering the stage', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  const width = 5120;
  const center = width / 2;
  const coverage = tuning.scaleMin < 1 ? 1 / tuning.scaleMin : 1;
  const grid = tileGrid(width, width, 256, 256, 0, 0, coverage);
  const rightmost = grid.baseX + grid.cols * 256;
  // Scaling about the centre by scaleMin maps `rightmost` to
  // `centre + (rightmost - centre) * scaleMin`; it must still reach the edge.
  const scaledRight = center + (rightmost - center) * tuning.scaleMin;
  expect(scaledRight >= width, `shrunk layer must still cover the stage: ${scaledRight} >= ${width}`);
});

test('breatheScale stays within the configured bounds and hits them on the quarters', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  for (let ms = 0; ms <= tuning.breathePeriodMs * 2; ms += 50) {
    const scale = breatheScale(ms, tuning.breathePeriodMs, tuning.scaleMin, tuning.scaleMax);
    expect(
      scale >= tuning.scaleMin - 1e-9 && scale <= tuning.scaleMax + 1e-9,
      `scale ${scale} escaped [${tuning.scaleMin}, ${tuning.scaleMax}] at ${ms} ms`,
    );
  }
  const period = tuning.breathePeriodMs;
  expectClose(breatheScale(0, period, tuning.scaleMin, tuning.scaleMax), (tuning.scaleMin + tuning.scaleMax) / 2, 1e-9, 'starts at the midpoint');
  expectClose(breatheScale(period / 4, period, tuning.scaleMin, tuning.scaleMax), tuning.scaleMax, 1e-9, 'quarter cycle = max');
  expectClose(breatheScale(period * 3 / 4, period, tuning.scaleMin, tuning.scaleMax), tuning.scaleMin, 1e-9, 'three-quarter cycle = min');
});

test('breatheScale pins to scaleMax without a usable period', () => {
  const tuning = DEFAULT_STAGE_BACKGROUND_TUNING;
  expectEqual(breatheScale(123, 0, tuning.scaleMin, tuning.scaleMax), tuning.scaleMax);
  expectEqual(breatheScale(123, Number.NaN, tuning.scaleMin, tuning.scaleMax), tuning.scaleMax);
});
