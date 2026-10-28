/**
 * shots_battle_judgment.mjs — 客户端渲染验证截图：用**生产渲染路径**
 * （buildBossRaceFrame + BossRaceView + drawHudBar + 判定卡片）渲染一帧带
 * 判定/擦弹的战斗画面并截图，用于肉眼核对判定点、擦弹圈、判定卡片读数、
 * 弹幕、Boss、自机与侧栏 HUD 是否按预期出现。
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REPO_ROOT = resolve(HERE, '..');
const OUT = process.env.PK_SHOT_OUT ?? 'D:/gotouhou/tmp/smoke/shots/battle-judgment.png';
// --trace <jsonl>：用服务端真实快照（取弹幕最多的那帧）替代合成帧。
const traceArg = process.argv.indexOf('--trace');
const TRACE = traceArg > 0 ? process.argv[traceArg + 1] : '';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.map': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.atlas': 'text/plain', '.fnt': 'text/plain',
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300));
});
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

if (TRACE) {
  // 只挑弹幕最多的那一帧传进页面（整条 trace 太大，会拖死 evaluate）。
  const lines = (await import('node:fs')).readFileSync(TRACE, 'utf8').trim().split('\n');
  let best = null;
  let bestCount = -1;
  for (const line of lines) {
    const row = JSON.parse(line);
    const count = (row.bullets || []).length;
    if (count > bestCount) {
      best = row;
      bestCount = count;
    }
  }
  await page.evaluate((data) => { window.__PK_TRACE__ = [data]; }, best);
  console.log('trace peak frame:', bestCount, 'bullets at tick', best.tick);
}

const info = await page.evaluate(async () => {
  const W = 480;
  const H = 720;
  const HUD = 420;
  const viewMod = await import('/dist/platform/laya/view/boss_race_view.js');
  const vmMod = await import('/dist/core/game/boss_race_view_model.js');

  Laya.stage.removeChildren();
  const view = new viewMod.BossRaceView({
    layout: { width: W, height: H },
    playfieldX: 0,
    playfieldY: 0,
    hudWidth: HUD,
    hudHeight: H,
    hudX: W,
    stageWidth: W + HUD,
    stageHeight: H,
  });
  Laya.stage.addChild(view.root);
  view.root.visible = true;

  // 有 trace 时用真实快照里弹幕最多的那一帧。
  let snapshot = null;
  if (window.__PK_TRACE__) {
    const rows = window.__PK_TRACE__;
    let best = rows[0];
    for (const row of rows) {
      if ((row.bullets || []).length > (best.bullets || []).length) best = row;
    }
    // trace 用 snake_case，渲染器要 camelCase —— 逐字段映射。
    snapshot = {
      tick: best.tick,
      state: best.state ?? 'running',
      winnerPlayerId: best.winner_player_id ?? '',
      boss: best.boss ? {
        xMilli: best.boss.x_milli ?? 0,
        yMilli: best.boss.y_milli ?? 0,
        hp: best.boss.hp ?? 0,
        maxHp: best.boss.max_hp ?? 6000,
        phase: best.boss.phase ?? 0,
        effects: [],
      } : { xMilli: 0, yMilli: -60000, hp: 3000, maxHp: 6000, phase: 0, effects: [] },
      players: (best.players || []).map((pl) => ({
        playerId: pl.player_id ?? pl.playerId,
        xMilli: pl.x_milli ?? pl.xMilli ?? 0,
        yMilli: pl.y_milli ?? pl.yMilli ?? 0,
        vxMilli: pl.vx_milli ?? 0,
        vyMilli: pl.vy_milli ?? 0,
        bossCurrentHp: pl.boss_current_hp ?? 0,
        damageDealt: pl.damage_dealt ?? 0,
        connected: true,
        lives: pl.lives ?? 3,
        bombs: pl.bombs ?? 3,
        graze: pl.graze ?? 0,
        invulnerableUntilTick: pl.invulnerable_until_tick ?? 0,
      })),
      bullets: (best.bullets || []).map((b) => ({
        bulletId: b.bullet_id ?? b.bulletId,
        xMilli: b.x_milli ?? b.xMilli ?? 0,
        yMilli: b.y_milli ?? b.yMilli ?? 0,
        vxMilli: b.vx_milli ?? 0,
        vyMilli: b.vy_milli ?? 0,
        radiusMilli: b.radius_milli ?? 4000,
        kind: b.bullet_kind ?? 0,
        hidden: b.hidden ?? false,
        ownerPlayerId: b.owner_player_id ?? '',
        patternId: b.pattern_id ?? '',
      })),
      chains: [],
      events: [],
    };
  }
  if (!snapshot) snapshot = {
    tick: 640,
    state: 'running',
    winnerPlayerId: '',
    boss: { xMilli: 0, yMilli: -60000, hp: 4200, maxHp: 6000, phase: 1, effects: [] },
    players: [
      {
        playerId: 'p-local', xMilli: 12000, yMilli: 30000, vxMilli: 3000, vyMilli: 0,
        bossCurrentHp: 4200, damageDealt: 1800, connected: true,
        lives: 2, bombs: 2, graze: 137, invulnerableUntilTick: 660,
      },
      {
        playerId: 'p-rival', xMilli: -30000, yMilli: 60000, vxMilli: 0, vyMilli: 0,
        bossCurrentHp: 5100, damageDealt: 900, connected: true,
        lives: 3, bombs: 3, graze: 64, invulnerableUntilTick: 0,
      },
    ],
    bullets: Array.from({ length: 28 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 28;
      const r = 60000 + (i % 5) * 18000;
      return {
        bulletId: 'b' + i,
        xMilli: Math.round(Math.cos(a) * r),
        yMilli: Math.round(Math.sin(a) * r) - 30000,
        vxMilli: Math.round(-Math.sin(a) * 3200),
        vyMilli: Math.round(Math.cos(a) * 3200),
        radiusMilli: 4000,
        kind: i % 6,
        hidden: false,
        ownerPlayerId: 'p-local',
        patternId: 'kome_ring',
      };
    }),
    chains: [],
    events: [],
  };

  const frame = vmMod.buildBossRaceFrame(snapshot, {
    layout: { width: W, height: H },
    localPlayerId: 'p-local',
    bossMaxHp: 6000,
    frac: 0,
  });

  const hudState = {
    localHpRatio: 4200 / 6000,
    rivalHpRatio: 5100 / 6000,
    bossMaxHp: 6000,
    localHp: 4200,
    rivalHp: 5100,
    damageDealt: 1800,
    tick: 640,
    stateName: 'Running',
    patternId: 'kome_ring',
    bullets: 28,
    connectionLabel: 'server',
    metricsLine: 'snapshots 640 · err 0.0px · hash 640/640',
    tickLimit: 7200,
    tickRateHz: 64,
    score: 128400,
    ultCooldownRatio: 0,
    ultReady: true,
  };

  view.render(frame, [], hudState, vmMod.buildJudgmentHud(frame) ?? undefined);
  return {
    bullets: frame.bullets.length,
    players: frame.players.map((p) => ({ id: p.playerId, graze: p.graze, lives: p.lives, judgmentActive: p.judgmentActive })),
    judgment: vmMod.buildJudgmentHud(frame),
  };
});
console.log('frame:', JSON.stringify(info));

await page.waitForTimeout(700);
await page.screenshot({ path: OUT });
console.log('screenshot →', OUT);
await browser.close();
