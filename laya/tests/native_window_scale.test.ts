/**
 * 窗口尺寸档位（1× / 1.5× / 2× / 自动）的纯逻辑。
 *
 * 分辨率换算本身与原生窗口无关：给定档位和屏幕就能算出窗口该多大，所以这里全部可测。
 * 真正的 resize 门（原生扩展）缺失时只是不改窗口，计算部分不受影响 —— 这也是把它做成
 * 纯函数的理由。
 *
 * 语义：
 *  - 固定档是**绝对尺寸**：1× = 800×600，1.5× = 1200×900，2× = 1600×1200（都是 4:3）。
 *  - 「自动」保持 4:3，在屏幕内把长和宽中**任意一边扩到最大**后截止：
 *    2560×1440 的屏幕 → 1920×1440（高度撑满，宽度是剩下的）。
 */

import { expect, expectClose, expectEqual, suite, test } from './harness';
import {
  WINDOW_ASPECT,
  WINDOW_SIZES,
  windowSizeForScale,
  type NativeScreenGeometry,
} from '../src/platform/native/native_window';

/** A 2560x1440 display. */
const SCREEN: NativeScreenGeometry = {
  desktop: { width: 2560, height: 1440 },
  workArea: { width: 2560, height: 1392 },
};

suite('window scale: the fixed sizes are absolute');

test('1x is 600x800 — portrait, like the stage', () => {
  const size = windowSizeForScale(1, SCREEN);
  expectEqual(size.width, 600, '1x width');
  expectEqual(size.height, 800, '1x height');
});

test('2x is 1200x1600', () => {
  const size = windowSizeForScale(2, SCREEN);
  expectEqual(size.width, 1200, '2x width');
  expectEqual(size.height, 1600, '2x height');
});

test('every fixed size keeps the stage 3:4 shape', () => {
  for (const scale of [1, 1.5, 2] as const) {
    const size = windowSizeForScale(scale, SCREEN);
    expectClose(size.width / size.height, WINDOW_ASPECT, 1e-9, `${scale}x is 4:3`);
  }
});

test('the sizes do not depend on the screen', () => {
  // The setting says "make the window this big" - not "some multiple of the
  // display", so a bigger monitor must not change what 1x means.
  const small: NativeScreenGeometry = {
    desktop: { width: 1280, height: 720 },
    workArea: { width: 1280, height: 672 },
  };
  expectEqual(windowSizeForScale(1, small).width, 600, '1x on a small screen');
  expectEqual(windowSizeForScale(1, small).height, 800, '1x on a small screen');
  expectEqual(windowSizeForScale(2, small).width, 1200, '2x on a small screen');
});

test('the size table is the one the setting offers', () => {
  expectEqual(WINDOW_SIZES['1'].width, 600, '1x width');
  expectEqual(WINDOW_SIZES['1'].height, 800, '1x height');
  // 1.5x is exactly the design stage.
  expectEqual(WINDOW_SIZES['1.5'].width, 900, '1.5x width');
  expectEqual(WINDOW_SIZES['1.5'].height, 1200, '1.5x height');
  expectEqual(WINDOW_SIZES['2'].width, 1200, '2x width');
  expectEqual(WINDOW_SIZES['2'].height, 1600, '2x height');
});

suite('window scale: auto fills the work area in the stage 3:4 shape');

test('auto fills the work area, not the whole screen', () => {
  // The taskbar is not usable space, so auto works against the work area
  // (2560x1392 here), not the screen (2560x1440). The window's own frame
  // comes out of it as well - that part is done natively, because only the
  // window knows how tall its frame is.
  const auto = windowSizeForScale('auto', SCREEN);
  expectEqual(auto.width, 1044, 'the width');
  expectEqual(auto.height, 1392, 'the height');
  expect(auto.height <= SCREEN.workArea.height, 'and it stays inside the work area');
  expect(auto.height < SCREEN.desktop.height, 'the taskbar band is left alone');
});

test('auto keeps the 4:3 shape and never overflows the screen', () => {
  for (const screen of [
    { width: 2560, height: 1440 },
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
  ]) {
    const auto = windowSizeForScale('auto', {
      desktop: screen,
      workArea: screen,
    });

    expect(auto.width <= screen.width, `${screen.width}x${screen.height}: the width fits`);
    expect(auto.height <= screen.height, `${screen.width}x${screen.height}: the height fits`);
    expectClose(auto.width / auto.height, WINDOW_ASPECT, 1e-9, 'and it is 3:4');
  }
});

test('auto reaches the screen on at least one axis', () => {
  // "Grow until one side is full" - that is what makes it fill rather than
  // merely fit.
  for (const screen of [
    { width: 2560, height: 1440 },
    { width: 1920, height: 1080 },
    { width: 1280, height: 1024 },
  ]) {
    const auto = windowSizeForScale('auto', { desktop: screen, workArea: screen });
    expect(
      auto.width === screen.width || auto.height === screen.height,
      `${screen.width}x${screen.height}: one axis is exactly full`,
    );
  }
});

test('auto without a screen falls back to the smallest fixed size', () => {
  const auto = windowSizeForScale('auto', null);
  expectEqual(auto.width, WINDOW_SIZES['1'].width, 'the 1x width');
  expectEqual(auto.height, WINDOW_SIZES['1'].height, 'the 1x height');
});
