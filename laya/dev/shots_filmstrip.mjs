/**
 * shots_filmstrip.mjs — 把一条服务端 trace 按时间抽帧，拼成一张胶片图，
 * 用生产渲染路径（buildBossRaceFrame + BossRaceView）逐帧画，核对弹幕
 * 随时间的形状变化（不是单帧快照）。
 *
 * 用法：node dev/shots_filmstrip.mjs --trace path.jsonl [--frames 8]
 * 输出：D:/gotouhou/tmp/smoke/shots/filmstrip.png
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = resolve(HERE, '..');
const OUT = process.env.PK_SHOT_OUT ?? 'D:/gotouhou/tmp/smoke/shots/filmstrip.png';

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const TRACE = argOf('--trace', '');
const FRAMES = Number(argOf('--frames', '8'));
if (TRACE === '') {
  console.error('need --trace <jsonl>');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.map': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.atlas': 'text/plain', '.fnt': 'text/plain',
};

// 抽帧：均匀取 FRAMES 帧（跳过 tick 0）。
const all = (await import('node:fs')).readFileSync(TRACE, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const usable = all.filter((row) => (row.bullets || []).length > 0);
const step = Math.max(1, Math.floor(usable.length / FRAMES));
const picks = [];
for (let i = 0; i < usable.length && picks.length < FRAMES; i += step) {
  picks.push(usable[i]);
}

const CELL_W = 480;   // 战场尺寸（布局与 playfield 一致，否则整体缩小）
const CELL_H = 720;
const COLS = Math.min(4, picks.length);
const ROWS = Math.ceil(picks.length / COLS);
const WIDTH = COLS * CELL_W;
const HEIGHT = ROWS * CELL_H;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));

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

const info = await page.evaluate(async ({ frames, cellW, cellH }) => {
  const viewMod = await import('/dist/platform/laya/view/boss_race_view.js');
  const vmMod = await import('/dist/core/game/boss_race_view_model.js');
  Laya.stage.removeChildren();

  const toSnapshot = (row) => ({
    tick: row.tick,
    state: row.state ?? 'running',
    winnerPlayerId: '',
    boss: row.boss ? {
      xMilli: row.boss.x_milli ?? 0, yMilli: row.boss.y_milli ?? 0,
      hp: row.boss.hp ?? 0, maxHp: row.boss.max_hp ?? 6000, phase: 0, effects: [],
    } : { xMilli: 0, yMilli: -60000, hp: 3000, maxHp: 6000, phase: 0, effects: [] },
    players: (row.players || []).map((pl) => ({
      playerId: pl.player_id, xMilli: pl.x_milli ?? 0, yMilli: pl.y_milli ?? 0,
      vxMilli: 0, vyMilli: 0, bossCurrentHp: pl.boss_current_hp ?? 0,
      damageDealt: pl.damage_dealt ?? 0, connected: true,
      lives: pl.lives ?? 3, bombs: pl.bombs ?? 3, graze: pl.graze ?? 0,
      invulnerableUntilTick: pl.invulnerable_until_tick ?? 0,
    })),
    bullets: (row.bullets || []).map((b) => ({
      bulletId: b.bullet_id, xMilli: b.x_milli ?? 0, yMilli: b.y_milli ?? 0,
      vxMilli: b.vx_milli ?? 0, vyMilli: b.vy_milli ?? 0,
      radiusMilli: b.radius_milli ?? 4000, kind: b.bullet_kind ?? 0,
      hidden: false, ownerPlayerId: b.owner_player_id ?? '', patternId: b.pattern_id ?? '',
    })),
    chains: [], events: [],
  });

  const layout = { width: cellW, height: cellH };
  const view = new viewMod.BossRaceView({
    layout,
    playfieldX: 0, playfieldY: 0,
    hudWidth: 0, hudHeight: 0, hudX: cellW,
    stageWidth: cellW, stageHeight: cellH,
  });
  Laya.stage.addChild(view.root);
  view.root.visible = true;
  window.__PK_VIEW__ = { view, vmMod, layout };
  return frames.map((row) => ({ tick: row.tick, bullets: (row.bullets || []).length }));
}, { frames: picks, cellW: CELL_W, cellH: CELL_H });

console.log('filmstrip frames:', JSON.stringify(info));

// 逐帧渲染 + 截图（单视图，避免多实例互相覆盖）。
for (let i = 0; i < picks.length; i += 1) {
  await page.evaluate(async ({ row }) => {
    const { view, vmMod, layout } = window.__PK_VIEW__;
    const toSnapshot = (r) => ({
      tick: r.tick, state: 'running', winnerPlayerId: '',
      boss: { xMilli: r.boss?.x_milli ?? 0, yMilli: r.boss?.y_milli ?? -60000, hp: r.boss?.hp ?? 3000, maxHp: 6000, phase: 0, effects: [] },
      players: (r.players || []).map((pl) => ({
        playerId: pl.player_id, xMilli: pl.x_milli ?? 0, yMilli: pl.y_milli ?? 0,
        vxMilli: 0, vyMilli: 0, bossCurrentHp: pl.boss_current_hp ?? 0, damageDealt: 0,
        connected: true, lives: pl.lives ?? 3, bombs: pl.bombs ?? 3, graze: pl.graze ?? 0,
        invulnerableUntilTick: 0,
      })),
      bullets: (r.bullets || []).map((b) => ({
        bulletId: b.bullet_id, xMilli: b.x_milli ?? 0, yMilli: b.y_milli ?? 0,
        vxMilli: b.vx_milli ?? 0, vyMilli: b.vy_milli ?? 0,
        radiusMilli: b.radius_milli ?? 4000, kind: b.bullet_kind ?? 0,
        hidden: false, ownerPlayerId: b.owner_player_id ?? '', patternId: '',
      })),
      chains: [], events: [],
    });
    const frame = vmMod.buildBossRaceFrame(toSnapshot(row), { layout, localPlayerId: 'p-alpha', bossMaxHp: 6000, frac: 0 });
    view.render(frame, [], undefined, undefined);
  }, { row: picks[i] });
  await page.waitForTimeout(120);
  const file = OUT.replace(/\.png$/, `-t${picks[i].tick}.png`);
  await page.screenshot({ path: file });
  console.log('frame →', file);
}
await browser.close();
process.exit(0);
