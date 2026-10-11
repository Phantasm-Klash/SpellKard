/**
 * Portrait screenshot harness.
 *
 * Boots the built client in headless Chrome (SwiftShader so WebGL/Laya works
 * without a GPU), then drives `window.__PK_SCENES__.switchTo(name)` for each
 * scene and writes a PNG per scene at the portrait stage size (720x1280).
 *
 * Usage:  node dev/shots_portrait.mjs [outDir]
 * Requires the dev server to be running (npm run serve) on PORT or 8099.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

// Anchor output next to this script, so cwd never matters.
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots'));
const PORT = process.env.PORT ?? '8099';
const BASE = `http://127.0.0.1:${PORT}/index.html?debug=1`;

// Stage is 720x1280; render at 2x for crisp text.
const VIEWPORT = { width: 720, height: 1280 };
const SCENES = ['lobby', 'room', 'battle', 'result', 'checkin', 'shop', 'inventory'];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(600);

const results = [];
for (const name of SCENES) {
  const ok = await page.evaluate((n) => {
    const scenes = window.__PK_SCENES__;
    if (!scenes || typeof scenes.switchTo !== 'function') return false;
    try {
      scenes.switchTo(n);
      return true;
    } catch (err) {
      return String(err);
    }
  }, name);
  await page.waitForTimeout(400);
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  results.push({ name, ok, file });
  console.log(`${ok === true ? 'OK ' : 'ERR'} ${name} -> ${file}${ok === true ? '' : ` (${ok})`}`);
}

await browser.close();
console.log(`\n${results.filter((r) => r.ok === true).length}/${SCENES.length} scenes captured`);
