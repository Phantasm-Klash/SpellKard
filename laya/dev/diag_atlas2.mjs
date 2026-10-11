/**
 * Diagnostic (corrected): why does a `.atlas` load resolve to nothing?
 *
 * `Laya.loader.load`'s signature is `load(url, arg1, arg2, arg3, ...)` where the
 * TYPE rides on `arg1` — `load(url, null, null, 'json')` silently drops it.
 * This probe uses the correct forms and also asks the engine directly how it
 * classifies the URL (`Loader.getURLInfo`).
 *
 * Usage: node dev/diag_atlas2.mjs
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
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  const t = String(m.text());
  if (/unsupported|warnFailed|Failed to load|retry|TypeError|undefined/i.test(t)) console.log(`[${m.type()}]`, t.slice(0, 200));
});

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(400);

const out = await page.evaluate(async () => {
  const ROOT = 'layaide/assets/resources/tna';
  const ATLAS = `${ROOT}/enemylist01.atlas`;
  const res = {};

  // How does the engine classify the URL?
  try {
    const info = Laya.Loader.getURLInfo(ATLAS, undefined, undefined);
    res.urlInfo = { ext: info.ext, typeId: info.typeId, loaderType: info.loaderType ? info.loaderType.name || 'fn' : null };
  } catch (e) {
    res.urlInfo = `ERR:${e.message}`;
  }
  res.atlasConstant = Laya.Loader.ATLAS;
  res.extMapAtlas = (() => {
    try {
      const m = Laya.Loader.extMap;
      return m ? Object.keys(m).filter((k) => /atlas|png|json/i.test(k)) : '(no extMap)';
    } catch (e) {
      return `ERR:${e.message}`;
    }
  })();

  const attempt = async (label, fn) => {
    try {
      const v = await fn();
      res[label] = v === null ? 'null' : Object.prototype.toString.call(v);
    } catch (e) {
      res[label] = `THROW:${e && e.message ? e.message : e}`;
    }
  };

  await attempt('loadNoType', () => Laya.loader.load(ATLAS));
  await attempt('loadTypeAtlas', () => Laya.loader.load(ATLAS, 'atlas'));
  await attempt('loadTypeJson', () => Laya.loader.load(ATLAS, 'json'));

  res.getResAtlas = (() => {
    try {
      const r = Laya.loader.getRes(ATLAS);
      return r ? `${r.constructor.name} ${r.width ?? ''}` : null;
    } catch (e) {
      return `ERR:${e.message}`;
    }
  })();

  return res;
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
