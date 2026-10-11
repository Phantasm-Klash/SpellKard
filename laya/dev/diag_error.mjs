/**
 * Diagnostic: boot the client and dump the first uncaught page error's full
 * stack, plus which scene switch triggers it. Used to chase the
 * "Maximum call stack size exceeded" seen during portrait shots.
 */
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const PORT = process.env.PORT ?? '8123';
const BASE = `http://127.0.0.1:${PORT}/index.html?debug=1`;

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });

page.on('pageerror', (e) => {
  console.log('=== PAGEERROR ===');
  console.log(e.stack ?? e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error' && !String(m.text()).includes('404')) console.log('[console]', m.text());
});

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(500);

console.log('scenes keys:', await page.evaluate(() => Object.keys(window.__PK_SCENES__ ?? {})));
console.log('app keys:', await page.evaluate(() => Object.keys(window.__PK_APP__ ?? {})));

for (const n of ['lobby', 'checkin', 'shop', 'inventory', 'battle']) {
  console.log(`--- switching to ${n} ---`);
  const r = await page.evaluate((name) => {
    try {
      window.__PK_SCENES__.switchTo(name);
      return 'ok';
    } catch (err) {
      return String(err && err.stack ? err.stack : err);
    }
  }, n);
  console.log('  ->', r);
  await page.waitForTimeout(300);
}

await browser.close();
