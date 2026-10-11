/**
 * Diagnostic: which `Laya.loader.load` form makes a TNA `.atlas` resolve?
 *
 * Tries, in order: (a) the array form the renderer uses, (b) an explicit
 * `type: 'atlas'`, (c) a single URL with no type. For each, reports whether the
 * atlas resource and a named sub-texture come back non-null.
 *
 * Usage: node dev/diag_atlas_load.mjs
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
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(500);

const out = await page.evaluate(async () => {
  const ROOT = 'layaide/assets/resources/tna';
  const ATLAS = `${ROOT}/enemylist01.atlas`;
  const FRAME = `${ATLAS}#stage_boss_01_11.png`;

  const describe = (v) => {
    if (v === null || v === undefined) return null;
    const tag = Object.prototype.toString.call(v);
    const w = v.width ?? v.sourceWidth ?? '';
    const h = v.height ?? v.sourceHeight ?? '';
    return `${tag}${w !== '' ? ` ${w}x${h}` : ''}`;
  };
  const getRes = (u) => {
    try {
      return describe(Laya.loader.getRes(u));
    } catch (e) {
      return `ERR:${e.message}`;
    }
  };
  const tryLoad = async (label, fn) => {
    try {
      await fn();
      return { label, ok: true };
    } catch (e) {
      return { label, ok: false, error: String(e && e.message ? e.message : e) };
    }
  };

  const results = [];

  // (a) array form, exactly as `LayaAtlasFrameSource.tryLoadRoot` does it.
  results.push(await tryLoad('array-no-type', () => new Promise((res) => {
    const r = Laya.loader.load([ATLAS], Laya.Handler.create(null, () => res()));
    if (r && typeof r.then === 'function') r.then(() => res(), () => res());
  })));
  results[0].atlasRes = getRes(ATLAS);
  results[0].frameRes = getRes(FRAME);

  // (b) explicit type 'atlas'.
  results.push(await tryLoad('single-type-atlas', () => Laya.loader.load(ATLAS, null, null, 'atlas')));
  results[1].atlasRes = getRes(ATLAS);
  results[1].frameRes = getRes(FRAME);

  // (c) single URL, no type.
  results.push(await tryLoad('single-no-type', () => Laya.loader.load(ATLAS)));
  results[2].atlasRes = getRes(ATLAS);
  results[2].frameRes = getRes(FRAME);

  return { results, loaderATLAS: Laya.Loader ? Laya.Loader.ATLAS : '(no Loader)' };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
