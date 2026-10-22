/**
 * Lobby screen screenshots + programmatic assertions.
 *
 * Drives the real `LobbyScene` through the debug harness:
 *   1. main menu on the 900x1200 web stage -> shot + assert the backdrop loaded,
 *      the backdrop rect fully covers the stage, and the five menu buttons read
 *      exactly "Sign in" / "Play" / "Check-in" / "Shop" / "Inventory";
 *   2. a simulated native resize (shadow the stage getters + dispatch RESIZE) ->
 *      assert the backdrop rect STILL covers the (now wide) stage;
 *   3. a second page booted at the LayaNative design size (1333x750) -> shot.
 *
 * Usage:  node dev/shots_lobby.mjs [outDir]
 * Requires the dev server (npm run serve) on PORT or 8123.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots-lobby'));
const PORT = process.env.PORT ?? '8123';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// 3:4 viewport to match the web design stage (900x1200) so `showall` fills it.
const page = await browser.newPage({ viewport: { width: 675, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
// Let the lobby art settle (the loader probes two roots).
await page.waitForTimeout(2000);

// Reads the five main-menu button labels straight off the scene's handles.
const MENU_LABELS = `(function menuLabels(lobby) {
  const keys = ['signInButton', 'playButton', 'checkinButton', 'shopButton', 'inventoryButton'];
  return keys.map((k) => lobby[k].label.text);
})`;

// --- 1. main menu on the web stage -----------------------------------------
const menu = await page.evaluate(async (menuSrc) => {
  const menuLabels = eval(menuSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('lobby');
  await new Promise((r) => setTimeout(r, 400));
  const lobby = scenes.lobby;
  return { state: lobby.debugState(), labels: menuLabels(lobby) };
}, MENU_LABELS);
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(OUT, 'lobby-900x1200.png') });
console.log('lobby menu:', JSON.stringify(menu));

// --- 1b. settings modal ----------------------------------------------------
// Same shared modal as the login screen: the gear in the top-right corner opens
// the six-tab settings card. It starts on Display; the product facts live on
// About, so that tab is read too.
const settings = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('lobby');
  await new Promise((r) => setTimeout(r, 300));
  const lobby = scenes.lobby;
  lobby.settingsButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 200));
  const state = lobby.settings.debugState();
  lobby.settings.selectTabByTitle('About');
  await new Promise((r) => setTimeout(r, 120));
  const about = lobby.settings.debugState();
  lobby.settings.selectTabByTitle('Display');
  await new Promise((r) => setTimeout(r, 120));
  return { state, about };
});
await page.screenshot({ path: resolve(OUT, 'lobby-settings.png') });
console.log('lobby settings modal:', JSON.stringify(settings.state));

const settingsClosed = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  const lobby = scenes.lobby;
  lobby.settings.closeButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 200));
  return { open: lobby.settings.debugState().open, rootVisible: lobby.settings.root.visible };
});

// --- 2. simulated native resize --------------------------------------------
// Shadow the read-only stage getters with data properties, then dispatch the
// same RESIZE event the runtime fires. Good for reading the recomputed numbers.
const resized = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  const stage = Laya.stage;
  Object.defineProperty(stage, 'width', { configurable: true, value: 1333 });
  Object.defineProperty(stage, 'height', { configurable: true, value: 750 });
  stage.event(Laya.Event.RESIZE);
  await new Promise((r) => setTimeout(r, 200));
  return scenes.lobby.debugState();
});
console.log('after resize:', JSON.stringify(resized));

// --- 3. native-wide page (real 1333x750 stage) ------------------------------
// A second page boots the web build at the LayaNative design size (1333x750)
// through the query overrides, so the wide backdrop renders for real.
const widePage = await browser.newPage({ viewport: { width: 1333, height: 750 }, deviceScaleFactor: 1 });
widePage.on('pageerror', (e) => console.log('[wide pageerror]', e.message));
await widePage.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en&stageWidth=1333&stageHeight=750`, { waitUntil: 'load' });
await widePage.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await widePage.waitForTimeout(2000);
const wide = await widePage.evaluate(async (menuSrc) => {
  const menuLabels = eval(menuSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('lobby');
  await new Promise((r) => setTimeout(r, 400));
  const lobby = scenes.lobby;
  return { state: lobby.debugState(), labels: menuLabels(lobby), stage: { width: Laya.stage.width, height: Laya.stage.height } };
}, MENU_LABELS);
await widePage.waitForTimeout(200);
await widePage.screenshot({ path: resolve(OUT, 'lobby-1333x750.png') });
console.log('wide stage:', JSON.stringify(wide));

await browser.close();

// --- assertions ------------------------------------------------------------
const covers = (rect, stage) =>
  rect.x <= 0 && rect.y <= 0 && rect.x + rect.width >= stage.width && rect.y + rect.height >= stage.height;

const EXPECTED_MENU = ['Sign in', 'Play', 'Check-in', 'Shop', 'Inventory'];
const labelsMatch = (labels) =>
  labels.length === EXPECTED_MENU.length && EXPECTED_MENU.every((v, i) => labels[i] === v);

// The gear button is pinned flush with the right screen margin, on the title band.
const settingsButtonTopRight = (state, stageW) =>
  state.settingsButtonRect.x + state.settingsButtonRect.width === stageW - 24 &&
  state.settingsButtonRect.y >= 0 &&
  state.settingsButtonRect.y < 60;

const checks = [
  ['lobby: backdrop texture loaded', menu.state.backgroundLoaded === true],
  ['lobby: backdrop rect covers the 900x1200 stage', covers(menu.state.backgroundRect, menu.state.stage)],
  ['lobby: stage really is 900x1200', menu.state.stage.width === 900 && menu.state.stage.height === 1200],
  ['lobby: backdrop offset is centred (negative y)', menu.state.backgroundOffset.y < 0],
  ['lobby: five menu buttons exist', menu.labels.length === 5],
  ['lobby: menu labels are exact', labelsMatch(menu.labels)],
  ['lobby: header names the game and the screen', menu.state.titleText === '纷争幻想 — Lobby'],
  ['lobby: settings button is in the top-right corner', settingsButtonTopRight(menu.state, 900)],
  ['lobby: settings modal starts closed', menu.state.settings.open === false],
  ['lobby settings: opens from the gear button', settings.state.open === true],
  // Language leads the tab strip: it is the first thing a player looks for when
  // the UI is not in their language (see `SettingsPanel`'s section order).
  ['lobby settings: opens on the Language tab', settings.state.activeTab === 'Language'],
  [
    'lobby settings: exposes the seven tabs in order',
    JSON.stringify(settings.state.tabs) ===
      JSON.stringify(['Language', 'Display', 'Keys', 'Audio', 'HUD', 'Other', 'About']),
  ],
  ['lobby settings: About tab lists both product names', settings.about.labels.includes('纷争幻想 · Phantasm Klash')],
  ['lobby settings: About tab shows the version', settings.about.labels.includes('0.1.0')],
  ['lobby settings: Close hides the modal again', settingsClosed.open === false && settingsClosed.rootVisible === false],
  ['resize: backdrop rect covers the resized 1333x750 stage', covers(resized.backgroundRect, resized.stage)],
  ['resize: stage reads back as 1333x750', resized.stage.width === 1333 && resized.stage.height === 750],
  ['resize: backdrop still loaded', resized.backgroundLoaded === true],
  ['wide: stage really is 1333x750', wide.stage.width === 1333 && wide.stage.height === 750],
  ['wide: backdrop rect covers the stage', covers(wide.state.backgroundRect, wide.state.stage)],
  ['wide: menu labels are exact', labelsMatch(wide.labels)],
  ['wide: settings button is in the top-right corner', settingsButtonTopRight(wide.state, 1333)],
];

console.log('');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\nlobby shots: ${checks.length - failed} passed, ${failed} failed`);
console.log('saved', resolve(OUT, 'lobby-900x1200.png'), resolve(OUT, 'lobby-settings.png'), resolve(OUT, 'lobby-1333x750.png'));
process.exit(failed === 0 ? 0 : 1);
