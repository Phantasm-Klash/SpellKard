/**
 * 窗口倍率（1× / 2× / 4× / 自动）的纯逻辑。
 *
 * 分辨率换算本身与原生窗口无关：给定倍率和显示器尺寸就能算出窗口该多大，
 * 所以这里全部可测。真正的 resize 门（原生扩展）缺失时只是不改窗口，
 * 计算部分不受影响 —— 这也是把它做成纯函数的理由。
 */

import { expect, expectEqual, suite, test } from './harness';
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

suite('window scale: auto fits the monitor');

test('a portrait window runs out of height first', () => {
  // 900x1200 at 2x needs 2400px of height; 1080p and 1440p do not have it, so
  // the height — not the width — is what decides.
  expectEqual(fitWindowScale(FHD), 1, '1080p only fits 1x');
  expectEqual(fitWindowScale(QHD), 1, '1440p only fits 1x');
});

test('a tall monitor takes the largest multiple that fits', () => {
  expectEqual(fitWindowScale(TALL), 2, '3840x2400 fits 2x (2400 needed)');
  const huge: NativeDesktopSize = { width: 7680, height: 4800 };
  expectEqual(fitWindowScale(huge), 4, '7680x4800 fits 4x');
});

test('a monitor smaller than the design stage still gets 1x', () => {
  // Falling back to the smallest multiple, rather than to nothing: a window
  // slightly larger than the monitor is worse than one slightly smaller,
  // because the former puts the edges off-screen.
  const tiny: NativeDesktopSize = { width: 800, height: 600 };
  expectEqual(fitWindowScale(tiny), 1, 'never below 1x');
});

test('a degenerate monitor size is treated as unknown', () => {
  expectEqual(fitWindowScale({ width: 0, height: 0 }), 1, 'zero desktop -> 1x');
});

test('auto needs the desktop, and falls back to 1x without it', () => {
  // An unknown monitor should not leave the window at whatever size it started
  // at; 1x is a defined, predictable size.
  const withoutDesktop = windowSizeForScale('auto', null);
  expectEqual(withoutDesktop.scale, 1, 'unknown monitor -> 1x');
  expectEqual(withoutDesktop.width, DESIGN_WIDTH, 'at design width');

  const withDesktop = windowSizeForScale('auto', TALL);
  expectEqual(withDesktop.scale, 2, 'known monitor -> fitted multiple');
  expectEqual(withDesktop.height, DESIGN_HEIGHT * 2, 'and the fitted height');
});

test('auto never exceeds the monitor', () => {
  for (const desktop of [FHD, QHD, TALL, { width: 800, height: 600 }]) {
    const size = windowSizeForScale('auto', desktop);
    expect(
      size.width <= desktop.width || size.scale === 1,
      `auto width ${size.width} fits ${desktop.width} (or is the 1x fallback)`,
    );
  }
});
