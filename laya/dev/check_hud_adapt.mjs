/**
 * HUD adaptivity regression check.
 *
 * Proves the battle scene re-tiles from the *live* stage size instead of the
 * boot-time config: it reads the view's geometry, recomputes the expected
 * geometry with the same pure `battleLayout(stage.width, stage.height)`, and
 * asserts they agree — then resizes the viewport and asserts the geometry
 * actually changed and still tiles the stage.
 *
 * Usage: node dev/check_hud_adapt.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const PORT = process.env.PORT ?? '8123';

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(300);

async function readGeometry() {
  return page.evaluate(async () => {
    const scenes = window.__PK_SCENES__;
    scenes.switchTo('battle');
    const view = scenes.battle.__debugView;
    const mod = await import('/dist/core/game/battle_layout.js');
    const stage = { width: Laya.stage.width, height: Laya.stage.height };
    const expected = mod.battleLayout(stage.width, stage.height);
    return {
      stage,
      expected,
      actual: {
        playfield: { width: view.layout.width, height: view.layout.height },
        playfieldX: view.playfieldX,
        playfieldY: view.playfieldY,
        hudX: view.hudX,
        hudWidth: view.hudWidth,
        hudHeight: view.hudHeight,
        stageWidth: view.stageWidth,
        stageHeight: view.stageHeight,
      },
    };
  });
}

function same(a, b) {
  return (
    a.playfield.width === b.playfield.width &&
    a.playfield.height === b.playfield.height &&
    a.playfieldX === b.playfieldX &&
    a.playfieldY === b.playfieldY &&
    a.hudX === b.hudX &&
    a.hudWidth === b.hudWidth &&
    a.hudHeight === b.hudHeight
  );
}

/**
 * The invariants `battleLayout` guarantees for every stage size. When the
 * leftover width is odd the extra pixel goes to the right margin, so the block
 * is flush-left first: `rightGutter` (the actual empty strip on the right of
 * the stage) is `playfieldX` or `playfieldX + 1` and the content never
 * overflows the stage.
 */
function invariant(actual) {
  const contentWidth = actual.playfield.width + actual.hudWidth;
  const rightGutter = actual.stageWidth - actual.playfieldX - contentWidth;
  return (
    actual.playfieldX >= 0 &&
    actual.playfieldX + contentWidth <= actual.stageWidth &&
    actual.hudX === actual.playfieldX + actual.playfield.width &&
    rightGutter >= actual.playfieldX &&
    rightGutter - actual.playfieldX <= 1
  );
}

const before = await readGeometry();
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(600);
const after = await readGeometry();

// Web keeps the logical stage at the 900x1200 design size (scaleMode=showall),
// so the viewport resize alone does not move the logical geometry. Simulate the
// *native* case — a real pixel-sized stage that changes when the window is
// resized — by shadowing the stage's read-only size getters and firing RESIZE.
// This exercises `BattleScene.onStageResize -> relayout` directly.
const resized = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('battle');
  const view = scenes.battle.__debugView;
  Object.defineProperty(Laya.stage, 'width', { value: 960, configurable: true });
  Object.defineProperty(Laya.stage, 'height', { value: 720, configurable: true });
  Laya.stage.event(Laya.Event.RESIZE);
  const mod = await import('/dist/core/game/battle_layout.js');
  return {
    expected: mod.battleLayout(960, 720),
    actual: {
      playfield: { width: view.layout.width, height: view.layout.height },
      playfieldX: view.playfieldX,
      playfieldY: view.playfieldY,
      hudX: view.hudX,
      hudWidth: view.hudWidth,
      hudHeight: view.hudHeight,
      stageWidth: view.stageWidth,
      stageHeight: view.stageHeight,
    },
  };
});

const checks = [
  ['initial geometry matches battleLayout(stage)', same(before.actual, before.expected)],
  ['layout invariants hold (before)', invariant(before.actual)],
  ['geometry matches battleLayout(stage) after resize', same(after.actual, after.expected)],
  ['layout invariants hold (after)', invariant(after.actual)],
  ['playfield keeps 2:3 ratio (after)', after.actual.playfield.height === Math.round(after.actual.playfield.width * 1.5)],
  ['RESIZE re-tiles to battleLayout(960x720)', same(resized.actual, resized.expected)],
  ['RESIZE actually changed the geometry', !same(resized.actual, before.actual)],
  ['layout invariants hold after RESIZE', invariant(resized.actual)],
];

console.log('before:', JSON.stringify(before));
console.log('after :', JSON.stringify(after));
console.log('resize:', JSON.stringify(resized));
console.log('');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\nhud adapt: ${checks.length - failed} passed, ${failed} failed`);

await browser.close();
process.exit(failed === 0 ? 0 : 1);
