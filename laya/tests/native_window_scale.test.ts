/**
 * 窗口倍率（1× / 2× / 4× / 自动）的纯逻辑。
 *
 * 分辨率换算本身与原生窗口无关：给定倍率和显示器尺寸就能算出窗口该多大，
 * 所以这里全部可测。真正的 resize 门（原生扩展）缺失时只是不改窗口，
 * 计算部分不受影响 —— 这也是把它做成纯函数的理由。
 */

import { expect, expectClose, expectEqual, suite, test } from './harness';
import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  fitWindowScale,
  windowSizeForScale,
  type NativeDesktopSize,
} from '../src/platform/native/native_window';

const FHD: NativeDesktopSize = { width: 1920, height: 1080 };
const QHD: NativeDesktopSize = { width: 2560, height: 1440 };
const TALL: NativeDesktopSize = { width: 3840, height: 2400 };

suite('window scale: design size and fixed multiples');

test('the fixed multiples are integer multiples of the design stage', () => {
  expectEqual(DESIGN_WIDTH, 900, 'design width');
  expectEqual(DESIGN_HEIGHT, 1200, 'design height');
  expectEqual(windowSizeForScale(1, null).width, 900, '1x width');
  expectEqual(windowSizeForScale(1, null).height, 1200, '1x height');
  expectEqual(windowSizeForScale(2, null).width, 1800, '2x width');
  expectEqual(windowSizeForScale(2, null).height, 2400, '2x height');
  expectEqual(windowSizeForScale(4, null).width, 3600, '4x width');
  expectEqual(windowSizeForScale(4, null).height, 4800, '4x height');
});

test('the resolved size reports the multiple it used', () => {
  expectEqual(windowSizeForScale(2, null).scale, 2, 'fixed 2x reports 2');
  expectEqual(windowSizeForScale(1, null).scale, 1, 'fixed 1x reports 1');
});

suite('window scale: auto fills the monitor');

test('auto fills the axis that runs out first, keeping the 3:4 shape', () => {
  // 900x1200 is portrait, so a landscape monitor runs out of height first:
  // the window fills the height and the width follows the aspect ratio.
  // 1080 / 1200 = 0.9 -> 810x1080.
  const fhd = windowSizeForScale('auto', FHD);
  expectEqual(fhd.height, 1080, '1080p fills the height exactly');
  expectEqual(fhd.width, 810, 'and the width follows 3:4');
  expectClose(fhd.scale, 0.9, 1e-9, 'the factor is 0.9');

  // 1440p: 1440 / 1200 = 1.2 -> 1080x1440.
  const qhd = windowSizeForScale('auto', QHD);
  expectEqual(qhd.height, 1440, '1440p fills the height exactly');
  expectEqual(qhd.width, 1080, 'and the width follows 3:4');

  // A tall monitor: the width runs out first instead.
  const tall = windowSizeForScale('auto', TALL);
  expectEqual(tall.height, 2400, '3840x2400 fills the height (width would overflow)');
  expectEqual(tall.width, 1800, 'and the width follows 3:4');
});

test('auto fills whichever axis allows it, never overflowing the other', () => {
  // A very wide, short monitor: the height is the limit.
  const wide: NativeDesktopSize = { width: 3440, height: 1440 };
  const fitted = windowSizeForScale('auto', wide);
  expect(fitted.height <= wide.height, 'the height fits');
  expect(fitted.width <= wide.width, 'the width fits');
  expect(
    fitted.height === wide.height || fitted.width === wide.width,
    'and one axis is exactly full',
  );
});

test('auto is allowed to land on a fraction', () => {
  // Rounding the factor to a whole multiple would either leave a band of
  // unused screen (0.9 -> 1) or overflow it (0.9 -> 0.5 would be 450x600,
  // wasting half the display).
  expectClose(fitWindowScale(FHD), 0.9, 1e-9, '1080p fits at 0.9');
  expectClose(fitWindowScale(QHD), 1.2, 1e-9, '1440p fits at 1.2');
  expectClose(fitWindowScale(TALL), 2, 1e-9, '2400p fits at 2');
});

test('a monitor smaller than the design stage still gets a usable window', () => {
  const tiny: NativeDesktopSize = { width: 800, height: 600 };
  const fitted = windowSizeForScale('auto', tiny);
  expect(fitted.width <= 800, 'the width fits');
  expect(fitted.height <= 600, 'the height fits');
  expect(fitted.width > 0 && fitted.height > 0, 'and it is not degenerate');
});

test('a degenerate monitor size is treated as unknown', () => {
  expectEqual(fitWindowScale({ width: 0, height: 0 }), 1, 'zero desktop -> 1x');
});

test('auto needs the desktop, and falls back to the design size without it', () => {
  // An unknown monitor should not leave the window at whatever size it started
  // at; the design size is a defined, predictable one.
  const withoutDesktop = windowSizeForScale('auto', null);
  expectEqual(withoutDesktop.scale, 1, 'unknown monitor -> the design size');
  expectEqual(withoutDesktop.width, DESIGN_WIDTH, 'at design width');
  expectEqual(withoutDesktop.height, DESIGN_HEIGHT, 'at design height');
});
