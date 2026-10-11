/**
 * Diagnostic: which approach makes a TNA atlas frame render?
 *
 * (A) engine path — `Laya.loader.load(atlasUrl, type:'atlas')` then probe the
 *     candidate cache keys the engine may have registered.
 * (B) self-sliced path — load the atlas JSON + its texture, build the
 *     sub-texture with `Laya.Texture.create(...)` ourselves, and blit it.
 *
 * Whichever renders decides the fix.
 *
 * Usage: node dev/diag_atlas_render.mjs
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

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(500);

const out = await page.evaluate(async () => {
  const ROOT = 'layaide/assets/resources/tna';
  const ATLAS = `${ROOT}/enemylist01.atlas`;
  const FRAME = 'stage_boss_01_11.png';

  // ---- (A) engine atlas loader + candidate cache keys -------------------
  try {
    await Laya.loader.load(ATLAS, null, null, 'atlas');
  } catch (e) {
    /* reported below via keys */
  }
  const candidateKeys = [
    ATLAS,
    `${ATLAS}#${FRAME}`,
    `${ROOT}/enemylist01/${FRAME}`,
    FRAME,
  ];
  const engineKeys = {};
  for (const k of candidateKeys) {
    try {
      const r = Laya.loader.getRes(k);
      engineKeys[k] = r ? `${r.width}x${r.height}` : null;
    } catch (e) {
      engineKeys[k] = `ERR:${e.message}`;
    }
  }

  // ---- (B) self-sliced --------------------------------------------------
  let selfSliced = null;
  let jsonViaLoader = null;
  try {
    const json = await Laya.loader.load(ATLAS, null, null, 'json');
    jsonViaLoader = json && json.frames ? `frames=${Object.keys(json.frames).length}` : String(json);
    const tex = await Laya.loader.load(`${ROOT}/${json.meta.image}`, null, null, 'image');
    const obj = json.frames[FRAME];
    const tt = Laya.Texture.create(
      tex,
      obj.frame.x, obj.frame.y, obj.frame.w, obj.frame.h,
      obj.spriteSourceSize ? obj.spriteSourceSize.x : 0,
      obj.spriteSourceSize ? obj.spriteSourceSize.y : 0,
      obj.sourceSize.w, obj.sourceSize.h,
    );
    selfSliced = tt ? `${tt.width}x${tt.height}` : null;
    if (tt) {
      // Render it so we can screenshot the result.
      const sp = new Laya.Sprite();
      sp.texture = tt;
      sp.pivot(tt.sourceWidth / 2, tt.sourceHeight / 2);
      sp.pos(220, 300);
      sp.scaleX = 3;
      sp.scaleY = 3;
      Laya.stage.addChild(sp);
    }
  } catch (e) {
    selfSliced = `ERR:${e.message}`;
  }

  return { engineKeys, jsonViaLoader, selfSliced };
});

console.log(JSON.stringify(out, null, 2));
await page.waitForTimeout(400);
const { mkdirSync } = await import('node:fs');
mkdirSync('dev/shots-fix', { recursive: true });
await page.screenshot({ path: 'dev/shots-fix/atlas-probe.png' });
await browser.close();
