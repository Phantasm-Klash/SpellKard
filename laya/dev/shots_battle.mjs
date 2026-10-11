/**
 * Battle-screen portrait shot.
 *
 * The battle scene only renders once a snapshot exists (normally from the
 * server). To verify the portrait HUD (score / ULT cd / countdown / both HP
 * bars) and the trajectory-family bullets without a live match, this drives the
 * scene's own `BossRaceView.render(...)` with a synthetic `BossRaceFrame`
 * containing one bullet of every trajectory family.
 *
 * Usage: node dev/shots_battle.mjs [outDir]
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots-live'));
const PORT = process.env.PORT ?? '8123';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !String(m.text()).includes('404')) console.log('[console]', m.text());
});

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(400);

const result = await page.evaluate(async () => {
  const app = window.__PK_APP__;
  if (!app) return 'no app';
  // Switch to the battle scene so its root is visible.
  window.__PK_SCENES__.switchTo('battle');

  const vm = await import('/dist/core/game/boss_race_view_model.js');

  const PATTERNS = ['ring', 'gap_ring', 'n_way', 'aimed', 'seeded_arc', 'sine_stream', 'spiral', 'blossom', 'homing', 'laser_curtain'];
  const bullets = PATTERNS.map((patternId, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    // Fan the headings so the linear/curve cues are visible.
    const angle = (i / PATTERNS.length) * Math.PI * 2;
    return {
      bulletId: `b${i}`,
      ownerPlayerId: 'p1',
      xMilli: (col - 2) * 40000,
      yMilli: (row - 0.5) * 40000 + 20000,
      vxMilli: Math.cos(angle) * 3000,
      vyMilli: Math.sin(angle) * 3000,
      radiusMilli: 5000,
      patternId,
    };
  });

  const snapshot = {
    tick: 1234,
    state: 1, // Running
    winnerPlayerId: '',
    winnerTick: 0,
    players: [
      { playerId: 'p1', xMilli: -20000, yMilli: 60000, bossCurrentHp: 4200, damageDealt: 1800, connected: true },
      { playerId: 'p2', xMilli: 20000, yMilli: 60000, bossCurrentHp: 5100, damageDealt: 900, connected: true },
    ],
    bullets,
    stateHash: '',
  };

  // The battle scene's playfield geometry: 3:2 portrait pinned to the top.
  const layout = { width: 720, height: 1080 };
  const frame = vm.buildBossRaceFrame(snapshot, {
    layout,
    localPlayerId: 'p1',
    bossMaxHp: 6000,
  });

  const hudState = {
    localHpRatio: 4200 / 6000,
    rivalHpRatio: 5100 / 6000,
    bossMaxHp: 6000,
    localHp: 4200,
    rivalHp: 5100,
    damageDealt: 1800,
    score: 1800,
    ultCooldownRatio: 0.35,
    ultReady: false,
    tick: 1234,
    stateName: 'Running',
    patternId: 'spiral',
    bullets: bullets.length,
    connectionLabel: 'server',
    metricsLine: 'snaps 42 · err 3 · hash 42/42 · snap 0',
    tickLimit: 7200,
    tickRateHz: 60,
  };

  app.battleScene.view.render(frame, [], hudState);
  return `rendered ${frame.bullets.length} bullets`;
});

console.log('battle ->', result);
await page.waitForTimeout(400);
const file = resolve(OUT, 'battle.png');
await page.screenshot({ path: file });
console.log('saved', file);

await browser.close();
