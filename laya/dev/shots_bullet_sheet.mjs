/**
 * shots_bullet_sheet.mjs — 全弹种总览：把 kEnemyBullet 9..224（216 种）用
 * **生产图集渲染路径**（LayaAtlasFrameSource + AtlasBulletRenderer）铺成一张
 * 网格图，肉眼核对每种弹是否都有 TNA 美术、尺寸是否一致。
 *
 * 用法：node dev/shots_bullet_sheet.mjs
 * 输出：D:/gotouhou/tmp/smoke/shots/bullet-sheet.png（可用 PK_SHOT_OUT 覆盖）
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = resolve(HERE, '..');
const OUT = process.env.PK_SHOT_OUT ?? 'D:/gotouhou/tmp/smoke/shots/bullet-sheet.png';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.map': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.atlas': 'text/plain', '.fnt': 'text/plain',
};

const COLS = 18;
const CELL = 52;
const KINDS = Array.from({ length: 216 }, (_, i) => i + 9);  // 9..224
const ROWS = Math.ceil(KINDS.length / COLS);
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL + 40;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));

await page.route('**/*', async (route) => {
  const { readFile, stat } = await import('node:fs/promises');
  const { extname } = await import('node:path');
  let url;
  try { url = new URL(route.request().url()); } catch { return route.continue(); }
  const target = resolve(REPO_ROOT, '.' + decodeURIComponent(url.pathname.split('?')[0]));
  try {
    const info = await stat(target);
    const file = info.isDirectory() ? resolve(target, 'index.html') : target;
    const body = await readFile(file);
    return route.fulfill({ status: 200, contentType: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', body });
  } catch {
    return route.fulfill({ status: 404, body: 'nf' });
  }
});

await page.goto('http://127.0.0.1:7350/index.html?debug=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.Laya, { timeout: 60000 });

const info = await page.evaluate(async ({ kinds, cols, cell }) => {
  const atlasMod = await import('/dist/platform/laya/view/bullet_atlas.js');
  const bulletsMod = await import('/dist/platform/laya/view/bullets.js');
  const visualMod = await import('/dist/core/game/bullet_visual.js');

  Laya.stage.removeChildren();
  const source = new atlasMod.LayaAtlasFrameSource();
  await source.load();
  const renderer = new bulletsMod.AtlasBulletRenderer(source, 1);

  const missing = [];
  const drawn = [];
  const sprite = new Laya.Sprite();
  Laya.stage.addChild(sprite);

  for (let i = 0; i < kinds.length; i += 1) {
    const kind = kinds[i];
    const descriptor = visualMod.describeBulletKind(kind);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cell + cell / 2;
    const y = row * cell + cell / 2;
    if (!descriptor) {
      missing.push(kind);
      continue;
    }
    const texture = source.frame(descriptor.atlas, descriptor.frame);
    if (!texture) {
      missing.push(kind);
      continue;
    }
    const item = new Laya.Sprite();
    item.texture = texture;
    item.pivot(texture.sourceWidth / 2 || texture.width / 2, texture.sourceHeight / 2 || texture.height / 2);
    item.pos(x, y);
    item.scaleX = 1;
    item.scaleY = 1;
    Laya.stage.addChild(item);
    drawn.push({ kind, frame: descriptor.frame, w: texture.sourceWidth, h: texture.sourceHeight });
  }
  return {
    total: kinds.length,
    drawn: drawn.length,
    missing,
    resolvedRoot: source.resolvedRoot,
    sizes: drawn.slice(0, 6),
  };
}, { kinds: KINDS, cols: COLS, cell: CELL });

console.log('bullet sheet:', JSON.stringify(info).slice(0, 400));
await page.waitForTimeout(500);
await page.screenshot({ path: OUT });
console.log('screenshot →', OUT);
await browser.close();
