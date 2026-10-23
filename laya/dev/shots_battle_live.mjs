/**
 * LIVE battle-screen shot.
 *
 * Plays a real match against the existing lobby test bot (`lobby_bot.py`) on the
 * remote lobby at 121.225.78.211:7350, then screenshots the battle scene once the
 * relay is delivering server snapshots.
 *
 * No local server is ever started: the client's own static files are served to
 * Chromium through a Playwright `page.route()` handler that reads them from disk
 * (a browser-internal mock), while every `/v1/...` request is passed straight
 * through to the real lobby. The page is navigated to the lobby's own origin so
 * REST + WS are same-origin and no CORS can bite.
 *
 * A synthetic reference shot is *always* produced too, so the deliverable is
 * never empty even when the live path fails.
 *
 * Usage: node dev/shots_battle_live.mjs
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_DIR = resolve(HERE, 'shots-battle-live');
const LOG_FILE = 'D:/gotouhou/tmp/native-run/battle_live.log';

const HOST = '121.225.78.211';
const PORT = 7350;
const PYTHON = 'C:/Users/wjcwqc/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe';
const BOT_SCRIPT = 'D:/gotouhou/tools/lobby_bot.py';

const LIVE_PNG = resolve(OUT_DIR, 'battle_live.png');
const SYNTH_PNG = resolve(OUT_DIR, 'battle_synthetic.png');

// Mirrors dev/serve.mjs so the intercepted static files keep the right MIME type.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const lines = [];
function log(...parts) {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  lines.push(line);
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* log file is best-effort */
  }
}

/** Resolves a request path to a file inside REPO_ROOT, or null when it escapes. */
function resolveWithinRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = resolve(REPO_ROOT, relative);
  const prefix = REPO_ROOT.endsWith(sep) ? REPO_ROOT : REPO_ROOT + sep;
  return full === REPO_ROOT || full.startsWith(prefix) ? full : null;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function pngSize(file) {
  try {
    const info = statSync(file);
    const buf = readFileSync(file);
    if (buf.length >= 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: info.size };
    }
    return { width: 0, height: 0, bytes: info.size };
  } catch {
    return null;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(dirname(LOG_FILE), { recursive: true });
writeFileSync(LOG_FILE, '');

const summary = {
  SIGNIN: 'fail',
  ROOM: '',
  BOT_JOINED: 'no',
  BOT_MATCHSTART: 'no',
  SCREEN: '',
  MATCH_ID: '',
  BULLETS: '',
  // Identity: the battle roster id the client believes is "mine", and whether
  // the rendered frame actually flagged a local Boss copy. The roster id only
  // exists on the signed battle ticket, so this is also the regression check for
  // the client reading it from the session (which is always empty).
  LOCAL_PLAYER_ID: '',
  LOCAL_IDENTIFIED: '',
  // Reconciliation: a seeded prediction reports a near-zero position error and
  // matching hashes; the old unseeded one reported a constant spawn-delta error.
  SYNC_SNAPS: '',
  SYNC_ERR: '',
  SYNC_HASH: '',
  SYNC_SNAP: '',
  TICK_LOCAL: '',
  TICK_SERVER: '',
  BULLETS_LOCAL: '',
  BULLETS_SERVER: '',
  LIVE_PNG: LIVE_PNG,
  SYNTH_PNG: SYNTH_PNG,
};
const pageErrors = [];

let browser = null;
let bot = null;
let botJoined = false;
let botMatched = false;

async function main() {
  browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => {
    pageErrors.push(String(e.message));
    log('[pageerror]', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      pageErrors.push(String(m.text()));
      log('[console]', m.text());
    }
  });

  // --- disk-fulfil handler (no server process) ----------------------------- //
  await page.route('**/*', async (route) => {
    let url;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.continue();
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return route.continue();
    }
    // Let the real lobby own its own API + WS handshake (WS is not routed anyway).
    if (url.pathname.startsWith('/v1/')) {
      return route.continue();
    }
    const target = resolveWithinRoot(url.pathname);
    if (target === null) {
      return route.fulfill({ status: 403, contentType: 'text/plain; charset=utf-8', body: 'forbidden' });
    }
    try {
      const info = await stat(target);
      const file = info.isDirectory() ? resolve(target, 'index.html') : target;
      const body = await readFile(file);
      const contentType = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
      return route.fulfill({ status: 200, contentType, headers: { 'Cache-Control': 'no-cache' }, body });
    } catch {
      return route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'not found' });
    }
  });

  const query = new URLSearchParams({
    debug: '1',
    lobbyHttpBase: `http://${HOST}:${PORT}`,
    lobbyWsUrl: `ws://${HOST}:${PORT}/v1/lobby/ws`,
    relayUrl: `ws://${HOST}:${PORT}/v1/battle/relay`,
  });
  log(`goto http://${HOST}:${PORT}/index.html?${query.toString()}`);
  await page.goto(`http://${HOST}:${PORT}/index.html?${query.toString()}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 30000 });
  log('client booted; __PK_SCENES__ present');

  // --- live path (bounded) -------------------------------------------------- //
  try {
    await withTimeout(runLive(page), 165000, 'live match');
  } catch (err) {
    log('LIVE PATH FAILED:', err && err.message ? err.message : String(err));
  }

  // --- synthetic reference (always) ---------------------------------------- //
  try {
    await renderSynthetic(page);
  } catch (err) {
    log('SYNTHETIC RENDER FAILED:', err && err.message ? err.message : String(err));
  }

  // --- read the final screen for the summary ------------------------------- //
  try {
    const screen = await page.evaluate(() => window.__PK_SCENES__.flow.snapshot().screen);
    summary.SCREEN = String(screen);
  } catch {
    /* ignore */
  }
}

async function runLive(page) {
  // 1) sign in
  const signin = await page.evaluate(async () => {
    const flow = window.__PK_SCENES__.flow;
    const ok = await flow.signIn('pk-e2e-host');
    const s = flow.snapshot();
    return {
      ok,
      screen: s.screen,
      statusText: s.statusText,
      lastError: s.lastError,
      session: s.session ? { userId: s.session.userId, playerId: s.session.playerId, displayName: s.session.displayName } : null,
    };
  });
  log('SIGNIN', JSON.stringify(signin));
  if (!signin.ok) {
    summary.SIGNIN = 'fail';
    throw new Error(`signIn returned false (screen=${signin.screen} lastError=${signin.lastError})`);
  }
  summary.SIGNIN = 'ok';

  // 2) create a uniquely-coded room
  const wantedCode = 'E2E' + Date.now().toString(36).toUpperCase();
  const created = await page.evaluate(async (code) => {
    const flow = window.__PK_SCENES__.flow;
    const ok = await flow.createRoom(code);
    const s = flow.snapshot();
    return { ok, screen: s.screen, statusText: s.statusText, lastError: s.lastError, room: s.room };
  }, wantedCode);
  log('CREATE_ROOM', JSON.stringify(created));
  if (!created.ok || created.room === null) {
    throw new Error(`createRoom failed (screen=${created.screen} lastError=${created.lastError})`);
  }
  const actualCode = created.room.roomCode || wantedCode;
  summary.ROOM = actualCode;
  log(`room created: requested=${wantedCode} actual=${actualCode} mode=${created.room.modeId} players=${created.room.players.length}`);

  // 3) start the bot as the second player, targeting this exact room
  const botTs = Date.now();
  const botId = `bot-e2e-${botTs}`;
  log(`spawn bot: ${botId} -> room ${actualCode}`);
  bot = spawn(
    PYTHON,
    [BOT_SCRIPT, '--host', HOST, '--port', String(PORT), '--room', actualCode, '--bot-id', botId, '--wait', '90', '--hold', '240'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const onBotChunk = (buf) => {
    for (const raw of String(buf).split(/\r?\n/)) {
      const line = raw.trim();
      if (line === '') continue;
      log('[bot]', line);
      if (/joined room/i.test(line)) botJoined = true;
      if (/MATCH START/i.test(line)) botMatched = true;
    }
  };
  bot.stdout.on('data', onBotChunk);
  bot.stderr.on('data', onBotChunk);
  bot.on('exit', (code) => log(`[bot] exited code=${code}`));

  // 4) wait for the battle screen; nudge with ready() once if the room fills
  //    but the transition stalls.
  try {
    await page.waitForFunction(() => window.__PK_SCENES__.flow.snapshot().screen === 'battle', {
      timeout: 25000,
      polling: 250,
    });
  } catch {
    log('no battle transition yet; calling flow.ready() once and continuing to wait');
    await page.evaluate(async () => {
      try {
        await window.__PK_SCENES__.flow.ready();
      } catch {
        /* ignore */
      }
    });
    await page.waitForFunction(() => window.__PK_SCENES__.flow.snapshot().screen === 'battle', {
      timeout: 65000,
      polling: 250,
    });
  }
  log('screen reached: battle');

  // 5) let the relay deliver snapshots + bullets move
  await page.waitForTimeout(10000);

  // 6) diagnostics
  const diag = await page.evaluate(() => {
    const app = window.__PK_APP__;
    const s = window.__PK_SCENES__.flow.snapshot();
    const bs = app ? app.battleScene : null;
    let frameBullets = null;
    let battleState = null;
    let metrics = null;
    let localPlayerId = null;
    let localIdentified = null;
    // Why the canonical hash disagrees: it covers the tick counter and the live
    // bullet set, so a mismatch is either a tick offset (the prediction is ahead
    // of the snapshot it is being compared against) or a bullet divergence.
    let localTick = null;
    let snapshotTick = null;
    let localBullets = null;
    let serverBullets = null;
    // Real-danmaku extensions: the server must publish `bullet_kind` /
    // `motion_func` per bullet, otherwise the renderer cannot pick the
    // reverse-engineered atlas frame and falls back to a generic bullet.
    let serverBulletKinds = null;
    try {
      const b = bs && bs.options ? bs.options.battle : null;
      if (b) {
        localTick = b.simulationRef ? b.simulationRef.getCurrentTick() : null;
        snapshotTick = b.latestSnapshot ? b.latestSnapshot.tick : null;
        localBullets = b.simulationRef ? b.simulationRef.snapshot().bullets.length : null;
        serverBullets = b.latestSnapshot ? b.latestSnapshot.bullets.length : null;
      }
      const snap = b ? b.latestSnapshot : null;
      if (snap && Array.isArray(snap.bullets) && snap.bullets.length > 0) {
        serverBulletKinds = snap.bullets.slice(0, 6).map((x) => `${x.bulletKind}:${x.motionFunc}`);
      }
    } catch {
      /* ignore */
    }
    let frameKinds = null;
    try {
      const frame = bs && bs.currentFrame ? bs.currentFrame : null;
      if (frame && frame.bullets) {
        frameBullets = frame.bullets.length;
        if (frame.bullets.length > 0) {
          frameKinds = frame.bullets.slice(0, 6).map((x) => x.bulletKind);
        }
      }
    } catch {
      /* ignore */
    }
    // Identity: what the scene thinks "mine" is, and whether the frame it drew
    // actually carries a local Boss copy (`buildBossRaceFrame` only sets
    // `isLocal` for a player whose id matches).
    try {
      if (bs && bs.options && typeof bs.options.localPlayerId === 'function') {
        localPlayerId = bs.options.localPlayerId();
      }
      const frame = bs ? bs.frame : null;
      if (frame && frame.boss) localIdentified = frame.boss.isLocal === true;
    } catch {
      /* ignore */
    }
    try {
      const b = bs && bs.options ? bs.options.battle : null;
      if (b) {
        battleState = b.state;
        metrics = b.metrics
          ? {
              snapshotsReceived: b.metrics.snapshotsReceived,
              hashMatches: b.metrics.hashMatches,
              hashMismatches: b.metrics.hashMismatches,
              hashComparable: b.metrics.hashComparable,
              hardSnaps: b.metrics.hardSnaps,
              averagePositionErrorMilli: b.metrics.averagePositionErrorMilli,
            }
          : null;
      }
    } catch {
      /* ignore */
    }
    return {
      screen: s.screen,
      statusText: s.statusText,
      lastError: s.lastError,
      match: s.match
        ? {
            matchId: s.match.matchId,
            endpoint: s.match.endpoint,
            playerIds: s.match.playerIds,
            playerId: s.match.playerId,
            serverSeedHex: s.match.serverSeedHex,
            modeId: s.match.modeId,
          }
        : null,
      room: s.room ? { roomCode: s.room.roomCode, players: (s.room.players || []).length, modeId: s.room.modeId } : null,
      frameBullets,
      battleState,
      metrics,
      localPlayerId,
      localIdentified,
      localTick,
      snapshotTick,
      localBullets,
      serverBullets,
      serverBulletKinds,
      frameKinds,
    };
  });
  log('DIAG', JSON.stringify(diag));
  if (diag.match) summary.MATCH_ID = diag.match.matchId || '';
  summary.BULLETS = diag.frameBullets === null ? '' : String(diag.frameBullets);
  summary.LOCAL_PLAYER_ID = diag.localPlayerId === null ? '' : String(diag.localPlayerId);
  summary.LOCAL_IDENTIFIED = diag.localIdentified === null ? '' : String(diag.localIdentified);
  summary.TICK_LOCAL = diag.localTick === null ? '' : String(diag.localTick);
  summary.TICK_SERVER = diag.snapshotTick === null ? '' : String(diag.snapshotTick);
  summary.BULLETS_LOCAL = diag.localBullets === null ? '' : String(diag.localBullets);
  summary.BULLETS_SERVER = diag.serverBullets === null ? '' : String(diag.serverBullets);
  // The proof that the reverse-engineered danmaku reaches the renderer: the
  // server's own `bullet_kind:func` pairs, and the kinds the drawn frame carries.
  summary.BULLET_KINDS_SERVER =
    diag.serverBulletKinds === null ? '' : diag.serverBulletKinds.join(',');
  summary.BULLET_KINDS_FRAME = diag.frameKinds === null ? '' : diag.frameKinds.join(',');
  if (diag.metrics) {
    summary.SYNC_SNAPS = String(diag.metrics.snapshotsReceived);
    summary.SYNC_ERR = String(diag.metrics.averagePositionErrorMilli);
    // Denominator is the number of *comparable* snapshots, not all of them: the
    // live ruleset's client-side bullet timeline is still a sample, so its hash
    // is not expected to agree and must not be reported as a mismatch.
    summary.SYNC_HASH = `${diag.metrics.hashMatches}/${diag.metrics.hashComparable}`;
    summary.SYNC_HASH_COMPARABLE = String(diag.metrics.hashComparable);
    summary.SYNC_SNAP = String(diag.metrics.hardSnaps);
  }

  // 7) live screenshot
  await page.screenshot({ path: LIVE_PNG });
  log('LIVE_PNG written', LIVE_PNG, JSON.stringify(pngSize(LIVE_PNG)));
}

async function renderSynthetic(page) {
  const result = await page.evaluate(async () => {
    const scenes = window.__PK_SCENES__;
    const app = window.__PK_APP__;
    if (!app) return 'no app';
    // Make the battle scene visible, then freeze its live tick loop so the
    // synthetic frame is not overwritten on the next tick.
    scenes.switchTo('battle');
    try {
      app.battleScene.stop();
    } catch {
      /* ignore */
    }

    const vm = await import('/dist/core/game/boss_race_view_model.js');

    const PATTERNS = ['ring', 'gap_ring', 'n_way', 'aimed', 'seeded_arc', 'sine_stream', 'spiral', 'blossom', 'homing', 'laser_curtain'];
    const bullets = PATTERNS.map((patternId, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
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
      state: 1,
      winnerPlayerId: '',
      winnerTick: 0,
      players: [
        { playerId: 'p1', xMilli: -20000, yMilli: 60000, bossCurrentHp: 4200, damageDealt: 1800, connected: true },
        { playerId: 'p2', xMilli: 20000, yMilli: 60000, bossCurrentHp: 5100, damageDealt: 900, connected: true },
      ],
      bullets,
      stateHash: '',
    };

    const layout = { width: 720, height: 1080 };
    const frame = vm.buildBossRaceFrame(snapshot, { layout, localPlayerId: 'p1', bossMaxHp: 6000 });

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

    const view = app.battleScene.__debugView || app.battleScene.view;
    view.render(frame, [], hudState);
    return `rendered ${frame.bullets.length} bullets`;
  });
  log('SYNTHETIC', result);
  await page.waitForTimeout(400);
  await page.screenshot({ path: SYNTH_PNG });
  log('SYNTH_PNG written', SYNTH_PNG, JSON.stringify(pngSize(SYNTH_PNG)));
}

function finalize() {
  summary.BOT_JOINED = botJoined ? 'yes' : 'no';
  summary.BOT_MATCHSTART = botMatched ? 'yes' : 'no';
  log('---- SUMMARY ----');
  log(`SIGNIN=${summary.SIGNIN}`);
  log(`ROOM=${summary.ROOM}`);
  log(`BOT_JOINED=${summary.BOT_JOINED}`);
  log(`BOT_MATCHSTART=${summary.BOT_MATCHSTART}`);
  log(`SCREEN=${summary.SCREEN}`);
  log(`MATCH_ID=${summary.MATCH_ID}`);
  log(`BULLETS=${summary.BULLETS}`);
  log(`LOCAL_PLAYER_ID=${summary.LOCAL_PLAYER_ID}`);
  log(`LOCAL_IDENTIFIED=${summary.LOCAL_IDENTIFIED}`);
  log(`SYNC_SNAPS=${summary.SYNC_SNAPS}`);
  log(`SYNC_ERR=${summary.SYNC_ERR}`);
  log(`SYNC_HASH=${summary.SYNC_HASH}`);
  log(`SYNC_SNAP=${summary.SYNC_SNAP}`);
  log(`TICK_LOCAL=${summary.TICK_LOCAL}`);
  log(`TICK_SERVER=${summary.TICK_SERVER}`);
  log(`BULLETS_LOCAL=${summary.BULLETS_LOCAL}`);
  log(`BULLETS_SERVER=${summary.BULLETS_SERVER}`);
  log(`LIVE_PNG=${summary.LIVE_PNG}`);
  log(`SYNTH_PNG=${summary.SYNTH_PNG}`);
  for (const e of pageErrors.slice(0, 20)) {
    log(`PAGEERROR=${e}`);
  }
  const live = pngSize(LIVE_PNG);
  const synth = pngSize(SYNTH_PNG);
  log(`LIVE_PNG_SIZE=${live ? `${live.width}x${live.height} (${live.bytes}B)` : 'missing'}`);
  log(`SYNTH_PNG_SIZE=${synth ? `${synth.width}x${synth.height} (${synth.bytes}B)` : 'missing'}`);
}

try {
  await main();
} catch (err) {
  log('FATAL:', err && err.stack ? err.stack : String(err));
} finally {
  if (bot && !bot.killed) {
    try {
      bot.kill();
    } catch {
      /* ignore */
    }
  }
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  finalize();
}
