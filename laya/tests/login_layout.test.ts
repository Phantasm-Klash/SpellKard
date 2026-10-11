/**
 * Login layout regression tests.
 *
 * `loginLayout` maps a stage size onto the three pieces the login screen draws
 * (backdrop, Reimu portrait, form card). It has to survive both the web stage
 * (900x1200 portrait) and the LayaNative stage (a wide, window-dependent
 * rectangle), so the invariants these tests pin are:
 *
 *  - the card width sits inside its clamp bounds on a normal stage;
 *  - the card never overflows the stage;
 *  - the portrait keeps its 190:279 aspect whenever it has a non-zero width;
 *  - every coordinate/size is a non-negative integer, even for degenerate
 *    stages (0, negative, tiny), which must never yield NaN or negatives.
 */

import {
  LOGIN_CARD_WIDTH_BOUNDS,
  LOGIN_CODE_BUTTON_W,
  LOGIN_PORTRAIT_ASPECT,
  loginEmailRowMetrics,
  loginLayout,
  type LoginLayout,
} from '../src/core/game/login_layout';
import { expect, expectEqual, suite, test } from './harness';

suite('login layout');

/** Every rect the layout returns, flattened so a loop can check them all. */
function rects(layout: LoginLayout): Array<{ x: number; y: number; width: number; height: number }> {
  return [layout.background, layout.portrait, layout.card, layout.halo];
}

/** Asserts every coordinate/size is a finite, non-negative integer. */
function expectIntegralAndNonNegative(layout: LoginLayout, label: string): void {
  for (const rect of rects(layout)) {
    for (const [key, value] of Object.entries(rect)) {
      if (key === 'scale') {
        continue;
      }
      expect(Number.isInteger(value), `${label}: ${key} is an integer (got ${value})`);
      expect(value >= 0, `${label}: ${key} is non-negative (got ${value})`);
    }
  }
  expect(layout.portrait.scale >= 0, `${label}: portrait scale non-negative`);
  expect(layout.background.scale >= 0, `${label}: background scale non-negative`);
}

/** Asserts the card fits inside the stage and its width is inside the clamp. */
function expectCardFits(layout: LoginLayout, stageWidth: number, label: string): void {
  expect(layout.card.x >= 0, `${label}: card.x >= 0`);
  expect(layout.card.x + layout.card.width <= stageWidth, `${label}: card fits horizontally`);
  expect(
    layout.card.width >= LOGIN_CARD_WIDTH_BOUNDS.min && layout.card.width <= LOGIN_CARD_WIDTH_BOUNDS.max,
    `${label}: card width ${layout.card.width} is inside [${LOGIN_CARD_WIDTH_BOUNDS.min}, ${LOGIN_CARD_WIDTH_BOUNDS.max}]`,
  );
}

/** Asserts the portrait keeps the source art's aspect ratio (when it has size). */
function expectPortraitAspect(layout: LoginLayout, label: string): void {
  if (layout.portrait.width > 0) {
    const ratio = layout.portrait.width / layout.portrait.height;
    expect(
      Math.abs(ratio - LOGIN_PORTRAIT_ASPECT) < 0.02,
      `${label}: portrait aspect ${ratio.toFixed(4)} ~ ${LOGIN_PORTRAIT_ASPECT.toFixed(4)}`,
    );
  }
}

/** Asserts the halo disc is square, inside the stage and centred on the portrait. */
function expectHaloInsideStage(layout: LoginLayout, stageWidth: number, stageHeight: number, label: string): void {
  const halo = layout.halo;
  expect(halo.x >= 0, `${label}: halo.x >= 0`);
  expect(halo.x + halo.width <= stageWidth, `${label}: halo fits horizontally`);
  expect(halo.y >= 0, `${label}: halo.y >= 0`);
  expect(halo.y + halo.height <= stageHeight, `${label}: halo fits vertically`);
  expectEqual(halo.width, halo.height, `${label}: halo is square`);
  if (halo.width > 0) {
    const centre = halo.x + halo.width / 2;
    const portraitCentre = layout.portrait.x + layout.portrait.width / 2;
    expect(Math.abs(centre - portraitCentre) <= 1, `${label}: halo is centred on the portrait`);
  }
}

test('web portrait 900x1200 stacks the portrait above a centred card', () => {
  const layout = loginLayout(900, 1200);
  expect(layout.stacked, 'a portrait stage stacks');
  expectEqual(layout.card.width, 420);
  expectEqual(layout.card.x, 240, 'the card is horizontally centred');
  expect(layout.card.x + layout.card.width <= 900, 'card fits');
  expectEqual(layout.portrait.height, 504, 'portrait height is capped at 0.42 * stage height');
  expectCardFits(layout, 900, '900x1200');
  expectPortraitAspect(layout, '900x1200');
  expectIntegralAndNonNegative(layout, '900x1200');
});

test('native wide stage 1333x750 goes two-column with the card on the left', () => {
  const layout = loginLayout(1333, 750);
  expect(!layout.stacked, 'a wide stage does not stack');
  expectEqual(layout.card.width, 420);
  expectEqual(layout.card.x, 24, 'the card hugs the left gutter');
  expect(layout.portrait.x > layout.card.x + layout.card.width, 'the portrait sits right of the card');
  expect(layout.portrait.x + layout.portrait.width <= 1333, 'the portrait fits horizontally');
  expectEqual(layout.portrait.height, 465, 'portrait height is capped at 0.62 * stage height');
  expectCardFits(layout, 1333, '1333x750');
  expectPortraitAspect(layout, '1333x750');
  expectIntegralAndNonNegative(layout, '1333x750');
});

test('ultra-wide 1920x1080 keeps the card capped and the portrait in the right 40%', () => {
  const layout = loginLayout(1920, 1080);
  expect(!layout.stacked, 'a wide stage does not stack');
  expectEqual(layout.card.width, LOGIN_CARD_WIDTH_BOUNDS.max);
  expect(layout.portrait.width <= 1920 * 0.4 + 1, 'the portrait stays inside the right 40%');
  expectCardFits(layout, 1920, '1920x1080');
  expectPortraitAspect(layout, '1920x1080');
  expectIntegralAndNonNegative(layout, '1920x1080');
});

test('the halo disc stays inside the stage on every aspect', () => {
  const stages: ReadonlyArray<readonly [number, number]> = [
    [900, 1200],
    [1333, 750],
    [480, 1280],
    [1920, 750],
    [2560, 750],
  ];
  for (const [width, height] of stages) {
    expectHaloInsideStage(loginLayout(width, height), width, height, `${width}x${height}`);
  }
});

test('the 1333x750 halo is clamped inside the stage instead of clipped', () => {
  const layout = loginLayout(1333, 750);
  // side = min(round(465 * 1.35) = 628, 2 * min(1150.5 - 16, 1333 - 16 - 1150.5)) = 333,
  // so the disc is trimmed to the room left of the right edge rather than clipped.
  expectEqual(layout.halo.width, 333, 'halo width is clamped to the room beside the portrait');
  expectEqual(layout.halo.height, 333);
  expectEqual(layout.halo.x, 984);
  expectEqual(layout.halo.y, 232);
  expect(layout.halo.x + layout.halo.width <= 1333, 'halo right edge is inside the stage');
});

test('narrow 400x900 stacks and still fits the card', () => {
  const layout = loginLayout(400, 900);
  expect(layout.stacked, 'a narrow stage stacks');
  expectEqual(layout.card.width, 352, 'card width = stage - 2 * margin');
  expectCardFits(layout, 400, '400x900');
  expectPortraitAspect(layout, '400x900');
  expectIntegralAndNonNegative(layout, '400x900');
});

test('square 800x800 stacks (just under the wide threshold)', () => {
  const layout = loginLayout(800, 800);
  expect(layout.stacked, '800/800 = 1.0 < 1.2 so it stacks');
  expectEqual(layout.card.width, 420);
  expectCardFits(layout, 800, '800x800');
  expectPortraitAspect(layout, '800x800');
  expectIntegralAndNonNegative(layout, '800x800');
});

test('degenerate stages never produce NaN or negative geometry', () => {
  const stages: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [-100, -100],
    [-1, 1200],
    [900, -1],
    [1, 1],
  ];
  for (const [width, height] of stages) {
    const layout = loginLayout(width, height);
    const label = `${width}x${height}`;
    expectIntegralAndNonNegative(layout, label);
    if (width <= 0) {
      expectEqual(layout.card.width, 0, `${label}: a zero-width stage collapses the card`);
    }
    expect(layout.card.x + layout.card.width <= Math.max(0, width), `${label}: card does not overflow`);
  }
});

test('the backdrop always covers the whole stage', () => {
  const stages: ReadonlyArray<readonly [number, number]> = [
    [900, 1200],
    [1333, 750],
    [1920, 1080],
    [400, 900],
  ];
  for (const [width, height] of stages) {
    const layout = loginLayout(width, height);
    expect(layout.background.width >= width, `backdrop covers width for ${width}x${height}`);
    expect(layout.background.height >= height, `backdrop covers height for ${width}x${height}`);
    expect(layout.background.scale > 0, `backdrop has a positive scale for ${width}x${height}`);
  }
});

suite('login e-mail row metrics');

test('the e-mail input and the send-code button add back up to the row width', () => {
  for (const innerWidth of [380, 300, 240, 180, 120, 60, 0]) {
    const metrics = loginEmailRowMetrics(innerWidth);
    const label = `innerWidth=${innerWidth}`;
    expectEqual(
      metrics.inputWidth + metrics.buttonWidth + metrics.gap,
      Math.round(innerWidth),
      `${label}: the split must account for the whole row`,
    );
    expect(metrics.inputWidth >= 0, `${label}: input width must not go negative`);
    expect(metrics.buttonWidth >= 0, `${label}: button width must not go negative`);
  }
});

test('a normal card gives the input the larger share and the button its preferred width', () => {
  const metrics = loginEmailRowMetrics(380);
  expect(metrics.inputWidth > metrics.buttonWidth, 'the address needs more room than the button');
  expect(metrics.buttonWidth <= LOGIN_CODE_BUTTON_W, 'the button is capped');
  expect(metrics.buttonWidth >= 100, 'the button stays wide enough to read "Send code"');
});

test('a narrow card shrinks the button before it starves the input', () => {
  const wide = loginEmailRowMetrics(380);
  const narrow = loginEmailRowMetrics(240);
  expect(narrow.buttonWidth < wide.buttonWidth, 'the button gives ground first');
  expect(narrow.inputWidth > 0, 'the input never collapses while the row has room');
});

test('degenerate widths collapse to zero instead of NaN', () => {
  for (const innerWidth of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    const metrics = loginEmailRowMetrics(innerWidth);
    expectEqual(metrics.inputWidth, 0, `innerWidth=${innerWidth}`);
    expectEqual(metrics.buttonWidth, 0, `innerWidth=${innerWidth}`);
  }
});
