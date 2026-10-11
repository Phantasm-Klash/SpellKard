/**
 * Verification: do the actor / bullet renderers actually blit real TNA art?
 *
 * Builds the real `AtlasActorRenderer` / `AtlasBulletRenderer` against the
 * shared frame source, draws a Boss, a player and a real bullet kind into
 * sprites, and reports whether each sprite ended up with a texture (real art)
 * or empty graphics (vector fallback). Also composes them into one image.
 *
 * Usage: node dev/verify_art.mjs
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
const page = await browser.newPage({ viewport: { width: 640, height: 420 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(2500); // let the atlas settle

const report = await page.evaluate(async () => {
  const atlasMod = await import('/dist/platform/laya/view/bullet_atlas.js');
  const actorsMod = await import('/dist/platform/laya/view/actors.js');
  const bulletsMod = await import('/dist/platform/laya/view/bullets.js');
  const visualMod = await import('/dist/core/game/bullet_visual.js');

  const src = atlasMod.sharedTnaFrameSource();
  await src.load();

  const describe = (sp) => {
    const t = sp.texture;
    if (t) return `texture ${t.width}x${t.height}`;
    const cmds = sp.graphics && sp.graphics.cmds ? sp.graphics.cmds.length : -1;
    return `vector (graphics cmds=${cmds})`;
  };

  const stage = new Laya.Sprite();
  stage.pos(0, 0);
  Laya.stage.addChild(stage);

  // Hide the app's own scenes so the composite shows only the art under test.
  for (const key of ['lobby', 'room', 'battle', 'result', 'checkin', 'shop', 'inventory']) {
    const scene = window.__PK_SCENES__[key];
    if (scene && scene.root) scene.root.visible = false;
  }

  const actorRenderer = new actorsMod.AtlasActorRenderer(src);

  const boss = new Laya.Sprite();
  boss.pos(110, 150);
  actorRenderer.drawBoss(boss, 22, 0.8, false, true, 0);
  stage.addChild(boss);

  const rival = new Laya.Sprite();
  rival.pos(110, 300);
  actorRenderer.drawBoss(rival, 16, 0.5, false, false, 0);
  stage.addChild(rival);

  const ship = new Laya.Sprite();
  ship.pos(320, 150);
  actorRenderer.drawPlayer(ship, 6, true, false, 0);
  stage.addChild(ship);

  // Real bullet kinds, drawn by the atlas bullet renderer.
  const kinds = visualMod.knownBulletKinds();
  const bulletRenderer = new bulletsMod.AtlasBulletRenderer(src, 1);
  const bulletResults = [];
  const picked = kinds.slice(0, 4);
  picked.forEach((kind, i) => {
    const sp = new Laya.Sprite();
    sp.pos(320 + i * 70, 300);
    bulletRenderer.draw(sp, {
      bulletKind: kind,
      patternId: '',
      radius: 8,
      ownerIsLocal: true,
      angleRad: 0,
      angleDeg: 0,
      motionFamily: 'linear',
      tick: 0,
      animate: false,
    });
    stage.addChild(sp);
    bulletResults.push({ kind, drawn: describe(sp) });
  });

  return {
    root: src.resolvedRoot,
    boss: describe(boss),
    rival: describe(rival),
    ship: describe(ship),
    bullets: bulletResults,
  };
});

console.log(JSON.stringify(report, null, 2));
await page.waitForTimeout(300);
const { mkdirSync } = await import('node:fs');
mkdirSync('dev/shots-fix', { recursive: true });
await page.screenshot({ path: 'dev/shots-fix/art-verify.png' });
await browser.close();
