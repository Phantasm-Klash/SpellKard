/**
 * record_battle_demo.mjs — 录制真实对局演示视频（非合成、非离线渲染）。
 *
 * 做法与 dev/shots_battle_live.mjs 同源：
 *   * 静态文件由 Playwright `page.route()` 从本地磁盘喂给 Chromium（不启任何
 *     本地 HTTP 服务）；`/v1/...` 请求全部直通**真实大厅**（121.225.78.211:7350）。
 *   * 每一方都是一个真实客户端页面（真实登录、真实建房/加入、真实票据、
 *     真实 KCP/UDP 经大厅 WS 中继），画面来自真实对战服下发的快照。
 *   * 用 Playwright `recordVideo` 录下页面真实渲染，再用 ffmpeg 裁到开局后的
 *     N 秒（剪辑不改变画面内容）。
 *
 * 用法：
 *   node dev/record_battle_demo.mjs --boss tian --host-shot auto --guest-shot auto \
 *        --duration 22 --out tian-vs-hui
 *   node dev/record_battle_demo.mjs --mode coop_boss --coop 2 --boss tian --duration 20 --out coop2
 *
 * 依赖：本地 Playwright（managed node workspace）+ 服务器 ffmpeg（裁剪由调用方执行）。
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const HOST = process.env.PK_LOBBY_HOST ?? '121.225.78.211';
const PORT = Number(process.env.PK_LOBBY_PORT ?? 7350);
const OUT_ROOT = process.env.PK_DEMO_OUT ?? 'D:/gotouhou-work/tmp/demo_out';

const ENVELOPE_OPS = new Set(['/v1/shop/purchase', '/v1/gacha/pull', '/v1/gacha/faith-exchange']);

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
  '.mp3': 'audio/mpeg',
  '.atlas': 'text/plain; charset=utf-8',
  '.fnt': 'text/plain; charset=utf-8',
};

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const out = {
    boss: 'tian',
    mode: 'mvp_boss_race',
    coop: 0,
    duration: 20,
    out: 'demo',
    hostShot: 'auto',
    guestShot: 'auto',
    solo: false,
    noReady: false,
    stage: 'lunar_maze',
    width: 720,
    height: 960,
    leadMs: 0,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = () => argv[++i];
    switch (key) {
      case '--boss': out.boss = next(); break;
      case '--mode': out.mode = next(); break;
      case '--coop': out.coop = Number(next()); break;
      case '--duration': out.duration = Number(next()); break;
      case '--out': out.out = next(); break;
      case '--host-shot': out.hostShot = next(); break;
      case '--solo': out.solo = true; break;
      case '--no-ready': out.noReady = true; break;
      case '--stage': out.stage = next(); break;
      case '--guest-shot': out.guestShot = next(); break;
      case '--width': out.width = Number(next()); break;
      case '--height': out.height = Number(next()); break;
      default: throw new Error(`unknown argument ${key}`);
    }
  }
  if (out.mode === 'coop_boss' && out.coop === 0) out.coop = 2;
  return out;
}

function log(...parts) {
  console.log(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
}

function resolveWithinRoot(pathname) {
  const clean = decodeURIComponent(pathname.split('?')[0]);
  const target = resolve(REPO_ROOT, '.' + clean);
  if (target !== REPO_ROOT && !target.startsWith(REPO_ROOT + '/') && !target.startsWith(REPO_ROOT + '\\')) {
    return null;
  }
  return target;
}

// --------------------------------------------------------------- browser io
async function openClient(browser, role, options) {
  const videoDir = resolve(options.videoRoot, role);
  mkdirSync(videoDir, { recursive: true });
  const videoStartMs = Date.now();  // recordVideo 从 context 创建开始计时
  const record = role === 'host';
  // guest 只负责真实输入，不需要大画面：小视口显著降低渲染开销，把帧率让给录制端。
  const vw = role === 'host' ? options.width : Math.max(240, Math.round(options.width * 0.38));
  const vh = role === 'host' ? options.height : Math.max(320, Math.round(options.height * 0.38));
  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: 1,
    ...(record ? { recordVideo: { dir: videoDir, size: { width: options.width, height: options.height } } } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(String(m.text()));
  });

  let envelopeSeq = 0;
  await page.route('**/*', async (route) => {
    let url;
    try {
      url = new URL(route.request().url());
    } catch {
      return route.continue();
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
    // 真实大厅拥有自己的 API 与 WS 握手；WS 不经 route。
    if (url.pathname.startsWith('/v1/') && route.request().method() === 'POST') {
      log('[req]', url.pathname, (route.request().postData() || '').slice(0, 200));
    }
    if (url.pathname.startsWith('/v1/')) {
      // 抽卡/商店要求业务信封头（服务端只校验格式：version/seq/ts/nonce/op/key/mode/tag）。
      // 客户端 REST 层尚未实现信封，这里在录制侧补齐，仅用于给演示账号发放自机。
      if (ENVELOPE_OPS.has(url.pathname) && route.request().method() === 'POST') {
        envelopeSeq += 1;
        const headers = { ...route.request().headers() };
        headers['x-phk-business-envelope'] = 'business-v0-scaffold';
        headers['x-phk-business-seq'] = String(envelopeSeq);
        headers['x-phk-business-timestamp-ms'] = String(Date.now());
        headers['x-phk-business-nonce'] = randomBytes(16).toString('hex');
        headers['x-phk-business-op'] = url.pathname.includes('shop') ? 'shop.purchase' : 'gacha.pull';
        headers['x-phk-business-key-id'] = 'demo-harness';
        headers['x-phk-business-mode'] = 'demo-harness';
        headers['x-phk-business-tag'] = randomBytes(32).toString('hex');
        return route.continue({ headers });
      }
      return route.continue();
    }
    const target = resolveWithinRoot(url.pathname);
    if (target === null) return route.fulfill({ status: 403, body: 'forbidden' });
    try {
      const info = await stat(target);
      const file = info.isDirectory() ? resolve(target, 'index.html') : target;
      const body = await readFile(file);
      const contentType = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
      return route.fulfill({ status: 200, contentType, headers: { 'Cache-Control': 'no-cache' }, body });
    } catch {
      return route.fulfill({ status: 404, body: 'not found' });
    }
  });

  const query = new URLSearchParams({
    debug: '1',
    lobbyHttpBase: `http://${HOST}:${PORT}`,
    lobbyWsUrl: `ws://${HOST}:${PORT}/v1/lobby/ws`,
    relayUrl: `ws://${HOST}:${PORT}/v1/battle/relay`,
  });
  await page.goto(`http://${HOST}:${PORT}/index.html?${query.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 60000 });
  return { context, page, errors, videoDir, videoStartMs };
}

async function signIn(page, name) {
  const result = await page.evaluate(async (displayName) => {
    const flow = window.__PK_SCENES__.flow;
    const ok = await flow.signIn(displayName);
    const s = flow.snapshot();
    return { ok, screen: s.screen, lastError: s.lastError, session: s.session ? { userId: s.session.userId } : null };
  }, name);
  if (!result.ok) throw new Error(`signIn failed for ${name}: ${result.lastError ?? result.screen}`);
  return result;
}

/** 买辉玉 + 抽自机，返回可用的 shot 候选（默认自机在前）。 */
async function ensureShots(page) {
  return page.evaluate(async () => {
    const flow = window.__PK_SCENES__.flow;
    const client = flow.client;
    const pulled = [];
    const errors = [];
    const purchases = [];
    // 初始 2000 金币 / 300 辉玉：买 2 次辉玉包（600 金币 → 600 辉玉）再抽。
    for (let i = 0; i < 2; i += 1) {
      try {
        const resp = await client.call('shop.purchase', {
          product_id: 'gems.pack.600',
          quantity: 1,
          nonce: `demo-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        });
        const pbody = resp && resp.payload ? resp.payload : resp;
        purchases.push(resp && resp.ok === false ? `fail:${resp.error_code ?? pbody?.error_code ?? 'unknown'}` : 'ok');
      } catch (e) {
        errors.push(`purchase ${i}: ${e && e.message ? e.message : e}`);
      }
    }
    for (let i = 0; i < 8; i += 1) {
      try {
        const resp = await client.call('gacha.pull', { pool_id: 'gacha.characters', count: 1 });
        const payload = resp && resp.payload ? resp.payload : resp;
        const results = payload && Array.isArray(payload.results) ? payload.results : [];
        if (results.length === 0) {
          errors.push(`pull ${i} empty: ${JSON.stringify(resp).slice(0, 240)}`);
          break;
        }
        for (const r of results) {
          if (r && typeof r.shot_id === 'string' && r.shot_id !== '') pulled.push(r.shot_id);
        }
      } catch (e) {
        errors.push(`pull ${i}: ${e && e.message ? e.message : e}`);
        break;
      }
    }
    const unique = [];
    for (const id of ['ReimuA1', 'ReimuA2', ...pulled]) {
      if (!unique.includes(id)) unique.push(id);
    }
    return { candidates: unique, pulled, purchases, errors };
  });
}

function bombFor(shot) {
  return String(shot).replace(/A[12]$/, '');
}

async function createRoom(page, code, mode, options) {
  return page.evaluate(
    async ({ roomCode, modeId, opts }) => {
      const flow = window.__PK_SCENES__.flow;
      const ok = await flow.createRoom(roomCode, modeId, opts);
      const s = flow.snapshot();
      return {
        ok,
        screen: s.screen,
        lastError: s.lastError,
        room: s.room
          ? { roomCode: s.room.roomCode, modeId: s.room.modeId, players: s.room.players.length, bossId: s.room.bossId }
          : null,
      };
    },
    { roomCode: code, modeId: mode, opts: options },
  );
}

/** 用 REST 建房：客户端 WS 的 rooms.create 不携带 boss_id，这里走 /v1 面。 */
async function createRoomRest(page, options) {
  const session = await page.evaluate(() => {
    const client = window.__PK_SCENES__.flow.client;
    const s = client.session;
    return s ? { token: s.sessionToken, userId: s.userId } : null;
  });
  if (session === null) throw new Error('no session token for REST room create');
  const params = { stage_id: options.stage ?? 'lunar_maze' };
  if (options.shotType) params.shot_type = options.shotType;
  if (options.bombType) params.bomb_type = options.bombType;
  if (options.coopPlayers) params.coop_players = String(options.coopPlayers);
  const body = { mode_id: options.mode, boss_id: options.bossId ?? '', mode_params: params };
  const resp = await fetch(`http://${HOST}:${PORT}/v1/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || data.ok === false) {
    return { ok: false, lastError: (data && (data.error_code || data.message)) || `http_${resp.status}`, room: null };
  }
  return { ok: true, lastError: '', room: { roomCode: data.room_code, modeId: data.mode_id, players: 1, bossId: data.boss_id } };
}

async function joinRoom(page, code, options) {
  return page.evaluate(
    async ({ roomCode, opts }) => {
      const flow = window.__PK_SCENES__.flow;
      const ok = await flow.joinRoom(roomCode, opts);
      const s = flow.snapshot();
      return { ok, screen: s.screen, lastError: s.lastError };
    },
    { roomCode: code, opts: options },
  );
}

async function ready(page) {
  return page.evaluate(async () => {
    try {
      return await window.__PK_SCENES__.flow.ready();
    } catch {
      return false;
    }
  });
}

async function waitBattle(page, timeoutMs) {
  try {
    await page.waitForFunction(() => window.__PK_SCENES__.flow.snapshot().screen === 'battle', {
      timeout: timeoutMs,
      polling: 250,
    });
    return true;
  } catch {
    return false;
  }
}

async function battleDiag(page) {
  return page.evaluate(() => {
    const app = window.__PK_APP__;
    const flow = window.__PK_SCENES__.flow;
    const s = flow.snapshot();
    const scene = app ? app.battleScene : null;
    const battle = scene ? scene.options.battle : null;
    const snap = battle && battle.latestSnapshot ? battle.latestSnapshot : null;
    const frame = scene ? scene.currentFrame : null;
    const coop = scene ? scene.currentCoopFrame : null;
    return {
      screen: s.screen,
      modeId: s.room ? s.room.modeId : null,
      matchId: s.match ? s.match.matchId : null,
      tick: snap ? snap.tick : null,
      players: snap && snap.players ? snap.players.length : null,
      bullets: snap && snap.bullets ? snap.bullets.length : null,
      bossHp: frame && frame.boss ? frame.boss.hp : null,
      cutscene: scene && scene.cutscene
        ? {
            done: scene.cutscene.done,
            elapsedMs: scene.cutscene.sequencer ? scene.cutscene.sequencer.elapsedMs : null,
            lastStep: scene.cutscene.lastStep ? scene.cutscene.lastStep.kind : null,
            rootVisible: scene.cutscene.root.visible,
          }
        : null,
      tickIntervalMs: battle ? battle.tickIntervalMs : null,
      coop: coop ? { seatCount: coop.seatCount, bossHp: coop.bossHp, players: coop.players.length, bullets: coop.bullets.length } : null,
    };
  });
}

// --------------------------------------------------------------------- main
async function main() {
  const args = parseArgs(process.argv);
  const stamp = Date.now().toString(36);
  const runRoot = resolve(OUT_ROOT, `${args.out}-${stamp}`);
  const videoRoot = resolve(runRoot, 'video');
  mkdirSync(videoRoot, { recursive: true });

  const browser = await chromium.launch({
    headless: process.env.PK_HEADED !== '1',
    channel: 'chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  const summary = { args, runRoot, players: [], diag: null, errors: [] };
  let host = null;
  const guests = [];
  try {
    // ---- host
    host = await openClient(browser, 'host', { ...args, videoRoot });
    await signIn(host.page, `demo-${args.out}-host-${stamp}`);
    const hostShots = await ensureShots(host.page);
    log('host shots', hostShots);

    let hostShot = args.hostShot;
    if (hostShot === 'auto') {
      // 优先选一个非 Reimu 的已拥有 shot（更直观地展示不同自机）。
      hostShot = hostShots.candidates.find((id) => !id.startsWith('Reimu')) ?? hostShots.candidates[0];
    }

    const code = 'DEMO' + stamp.toUpperCase().slice(-5);
    // 拥有权校验在服务端；抽卡结果可能重复/失败，因此按候选逐个试建。
    const hostTries = [hostShot, ...hostShots.candidates.filter((id) => id !== hostShot)];
    let created = null;
    for (const shot of hostTries) {
      const roomOpts = {
        mode: args.mode,
        stage: args.stage,
        bossId: args.boss,
        shotType: shot,
        bombType: bombFor(shot),
        ...(args.mode === 'coop_boss' ? { coopPlayers: args.coop } : {}),
      };
      created = await createRoomRest(host.page, roomOpts);
      log('createRoom(rest)', created, 'shot', shot);
      if (created.ok && created.room !== null) {
        hostShot = shot;
        // 让客户端接管这个房间（房主 join 自己的房间 = join_retry）。
        const adopted = await joinRoom(host.page, created.room.roomCode, { shotType: shot, bombType: bombFor(shot) });
        log('host adopt room', adopted);
        if (!adopted.ok) {
          created = { ok: false, lastError: adopted.lastError, room: null };
          continue;
        }
        break;
      }
    }
    if (created === null || !created.ok || created.room === null) {
      throw new Error(`createRoom failed: ${created ? created.lastError : 'no candidate'}`);
    }
    summary.room = created.room;

    // ---- guests
    const guestCount = args.solo ? 0 : args.mode === 'coop_boss' ? args.coop - 1 : 1;
    let guestShot = args.guestShot;
    for (let i = 0; i < guestCount; i += 1) {
      const guest = await openClient(browser, `guest${i + 1}`, { ...args, videoRoot: resolve(runRoot, 'video-aux') });
      await signIn(guest.page, `demo-${args.out}-g${i + 1}-${stamp}`);
      const shots = await ensureShots(guest.page);
      let shot = guestShot;
      if (shot === 'auto') {
        // 优先「不同角色」的 shot（A1/A2 只算同一角色的不同弹型）。
        const hostChar = hostShot.replace(/A[12]$/, '');
        shot = shots.candidates.find((id) => id !== hostShot && id.replace(/A[12]$/, '') !== hostChar) ??
          shots.candidates.find((id) => id !== hostShot) ??
          shots.candidates[0];
      }
      let joined = null;
      const guestTries = [shot, ...shots.candidates.filter((id) => id !== shot)];
      for (const tryShot of guestTries) {
        joined = await joinRoom(guest.page, created.room.roomCode, {
          shotType: tryShot,
          bombType: bombFor(tryShot),
        });
        log(`guest${i + 1} join`, joined, 'shot', tryShot);
        if (joined.ok) {
          shot = tryShot;
          break;
        }
      }
      if (joined === null || !joined.ok) throw new Error(`guest${i + 1} join failed: ${joined ? joined.lastError : 'no candidate'}`);
      guests.push({ ...guest, shot });
      summary.players.push({ role: `guest${i + 1}`, shot });
      // 只有第一个 guest 决定 guestShot，后续各自挑不同的
      guestShot = shot;
    }
    summary.players.unshift({ role: 'host', shot: hostShot });

    // ---- ready + wait for battle
    if (!args.noReady) {
      await ready(host.page);
      for (const g of guests) await ready(g.page);
    }

    let battle = await waitBattle(host.page, 60000);
    if (!battle) {
      const diag = await host.page
        .evaluate(() => {
          const f = window.__PK_SCENES__.flow;
          const s = f.snapshot();
          const app = window.__PK_APP__;
          const b = app && app.battleScene ? app.battleScene.options.battle : null;
          return {
            screen: s.screen,
            statusText: s.statusText,
            lastError: s.lastError,
            room: s.room ? { code: s.room.roomCode, players: s.room.players.length } : null,
            match: s.match ? s.match.matchId : null,
            hasBattleClient: !!b,
            latestSnapshot: !!(b && b.latestSnapshot),
            connState: b ? b.state : null,
          };
        })
        .catch((e) => ({ evalError: String(e) }));
      log('battle transition failed; diag', diag, 'pageErrors', host.errors.slice(-5));
      summary.transitionDiag = diag;
      summary.pageErrors = host.errors.slice(-10);
      // 再给一次机会（ready 可能把状态切走了）
      if (!args.noReady) {
        await ready(host.page);
        battle = await waitBattle(host.page, 45000);
      }
    }
    if (!battle) throw new Error('battle screen never reached');

    // 等第一帧**服务端**快照（否则客户端只是在本地预测，画面不是服务端权威）。
    const gotSnapshot = await host.page
      .waitForFunction(
        () => {
          const app = window.__PK_APP__;
          const b = app && app.battleScene ? app.battleScene.options.battle : null;
          return !!(b && b.latestSnapshot);
        },
        { timeout: 30000, polling: 400 },
      )
      .then(() => true)
      .catch(() => false);
    if (!gotSnapshot) throw new Error('no server snapshot (client stayed in prediction)');
    // 过场按「本地 tick」计时，而本机 swiftshader 只有 ~15fps ⇒ 9s 过场会被拉长到 ~36s。
    // 这里把装饰性过场快进到结束（纯 UI 层，不改任何玩法/网络逻辑），直接录对局画面。
    await host.page.evaluate(() => {
      const scene = window.__PK_APP__ && window.__PK_APP__.battleScene;
      const cut = scene && scene.cutscene;
      if (cut && cut.sequencer) {
        cut.sequencer.elapsedMs = 1e9;
      }
    });
    await host.page.waitForTimeout(600);
    const tBattle = Date.now();
    // 视频时间轴从 context 创建开始；过场已快进，只留 1s 余量。
    summary.trimOffsetSec = Math.max(0, (tBattle - host.videoStartMs) / 1000 + 1.0);
    log('server snapshot received; recording', args.duration, 's');

    // 开局后让画面跑满指定时长
    await host.page.waitForTimeout(args.duration * 1000);
    summary.diag = await battleDiag(host.page);
    log('diag', summary.diag);

    // 截一张对战画面作为封面
    const shotPath = resolve(runRoot, 'cover.png');
    await host.page.screenshot({ path: shotPath });
    summary.cover = shotPath;
  } catch (err) {
    summary.errors.push(String(err && err.stack ? err.stack : err));
    log('FAILED:', err && err.message ? err.message : String(err));
  } finally {
    // 关闭上下文以落盘视频（recordVideo 在 close 时 finalize）
    const closers = [];
    if (host) closers.push(host.context.close());
    for (const g of guests) closers.push(g.context.close());
    await Promise.allSettled(closers);
    await browser.close();
  }

  // 汇总视频文件
  const videos = [];
  for (const dir of [resolve(runRoot, 'video', 'host'), resolve(runRoot, 'video')]) {
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.webm')) videos.push(resolve(dir, f));
      }
    } catch {
      /* ignore */
    }
  }
  summary.videos = videos;
  writeFileSync(resolve(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  log('SUMMARY', JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0) process.exitCode = 1;
}

await main();
