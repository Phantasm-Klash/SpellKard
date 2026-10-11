/**
 * Diagnostic: does the TNA atlas actually resolve frames at runtime?
 *
 * Loads a fresh `LayaAtlasFrameSource` in the page and reports which root won,
 * whether standalone images resolve, and whether the specific Boss / player /
 * bullet frames the renderers ask for come back non-null.
 *
 * Usage: node dev/diag_tna.mjs
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
page.on('console', (m) => {
  const t = String(m.text());
  if (/tna|atlas|404|fail/i.test(t)) console.log(`[console:${m.type()}]`, t);
});
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
page.on('response', (r) => {
  if (r.status() >= 400) console.log('[http]', r.status(), r.url());
});

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(1500);

const report = await page.evaluate(async () => {
  const mod = await import('/dist/platform/laya/view/bullet_atlas.js');
  const actors = await import('/dist/core/game/tna_actor_frames.js');
  const src = new mod.LayaAtlasFrameSource();
  await src.load();
  const probe = (atlas, frame) => {
    try {
      const t = src.frame(atlas, frame);
      return t ? `${t.width}x${t.height}` : null;
    } catch (e) {
      return `ERR:${e.message}`;
    }
  };
  const img = (() => {
    try {
      const t = src.image(actors.TNA_BACKGROUND_IMAGE);
      return t ? `${t.width}x${t.height}` : null;
    } catch (e) {
      return `ERR:${e.message}`;
    }
  })();
  const rawAtlas = (() => {
    try {
      const r = Laya.loader.getRes(`${src.resolvedRoot}/enemylist01.atlas`);
      return r ? Object.prototype.toString.call(r) : null;
    } catch (e) {
      return `ERR:${e.message}`;
    }
  })();
  return {
    loaded: src.isLoaded,
    resolvedRoot: src.resolvedRoot,
    candidates: [...src.candidateRoots],
    background: img,
    rawAtlasResource: rawAtlas,
    frames: {
      bossLocal: probe('enemylist01', 'stage_boss_01_11.png'),
      bossRival: probe('enemylist02', 'stage_boss_04_11.png'),
      playerLocal: probe('ply_shot_01', 'player_01.png'),
      playerRival: probe('ply_shot_02', 'player_02.png'),
      bullet: probe('bulletlist01', 'beam_01.png'),
    },
  };
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
