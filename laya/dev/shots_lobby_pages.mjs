/**
 * Lobby two-level screenshots.
 *
 * Captures the lobby main menu and the Play sub-page in one run: it switches to
 * the lobby, shoots the menu, dispatches a real CLICK on the Play button (the
 * same handler the user hits), then shoots the Play page. The button labels
 * visible on each page are printed so the run is self-verifying.
 *
 * Usage:  node dev/shots_lobby_pages.mjs [outDir]
 * Requires the dev server (npm run serve) on PORT or 8123.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots-fix'));
const PORT = process.env.PORT ?? '8123';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(400);

// Recursively collect label text under visible sprites only.
const COLLECT = `(function collect(node, acc) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (!child.visible) continue;
    if (typeof child.text === 'string' && child.text !== '') acc.push(child.text);
    if (child.numChildren) collect(child, acc);
  }
  return acc;
})`;

const menu = await page.evaluate(async (collectSrc) => {
  const collect = eval(collectSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('lobby');
  await new Promise((r) => setTimeout(r, 300));
  const lobby = scenes.lobby;
  return { page: lobby.page, labels: collect(lobby.root, []) };
}, COLLECT);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, 'lobby-menu.png') });
console.log('menu page:', menu.page, JSON.stringify(menu.labels));

const play = await page.evaluate(async (collectSrc) => {
  const collect = eval(collectSrc);
  const lobby = window.__PK_SCENES__.lobby;
  // Drive the actual Play button handler, exactly like a user click.
  lobby.playButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 300));
  return { page: lobby.page, labels: collect(lobby.root, []) };
}, COLLECT);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(OUT, 'lobby-play.png') });
console.log('play page:', play.page, JSON.stringify(play.labels));

await browser.close();
console.log('saved', resolve(OUT, 'lobby-menu.png'), resolve(OUT, 'lobby-play.png'));
