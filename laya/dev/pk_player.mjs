/**
 * One player's end-to-end lobby run, driven through the real UI.
 *
 * This is the per-player half of the two-player battle check: each player runs
 * its OWN copy of this script in its OWN browser, so the two clients are
 * genuinely independent processes that only meet on the lobby. The scripts
 * coordinate through a rendezvous directory (the host publishes the room code it
 * was given; the guest reads it) rather than sharing any state.
 *
 * Steps, each screenshotted:
 *   01 login screen            -> 06 sign-in filled
 *   02 register form filled    -> 07 signed in (lobby menu)
 *   03 verification code sent  -> 08 room created / joined
 *   04 code entered            -> 09 both players in the room
 *   05 registered (lobby)      -> 10 battle
 *
 * The client's static files are served from disk by a Playwright route handler
 * and the page is navigated to the LOBBY's own origin, so every `/v1/...` call
 * and the WebSocket are same-origin: no local server is started and no CORS can
 * interfere.
 *
 * Usage:
 *   node dev/pk_player.mjs --role host  --user pktest1 --email no-reply+pk1@wjcwqc.com \
 *        --password ... --out <dir> --rv <rendezvous dir> [--lobby http://host:7350]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// --- arguments -------------------------------------------------------------
function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const ROLE = arg('role', 'host');
const USER = arg('user');
const EMAIL = arg('email');
const PASSWORD = arg('password');
const OUT = resolve(arg('out', resolve(HERE, `shots-pk/${ROLE}`)));
const RV = resolve(arg('rv', resolve(HERE, 'shots-pk/rendezvous')));
const LOBBY = arg('lobby', 'http://121.225.78.211:7350');
const LOBBY_WS = arg('ws', LOBBY.replace(/^http/, 'ws') + '/v1/lobby/ws');
const RELAY = arg('relay', LOBBY.replace(/^http/, 'ws') + '/v1/battle/relay');
// `--stop-after room` ends the run once the room exists (or the guest has
// joined), which is how the flow is smoke-tested without waiting for a match.
const STOP_AFTER = arg('stop-after', 'battle');
/** How long to wait for the companion script to hand over the mailed code. */
const CODE_TIMEOUT_MS = Number(arg('code-timeout', '240')) * 1000;

mkdirSync(OUT, { recursive: true });
mkdirSync(RV, { recursive: true });
const LOG_FILE = resolve(OUT, `${ROLE}.log`);
writeFileSync(LOG_FILE, '');

function log(...parts) {
  const line = `[${ROLE}] ` + parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

const steps = [];
function step(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` -- ${detail}`}`);
}

// --- static file serving ---------------------------------------------------
const MIME = {
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

function resolveWithinRoot(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const full = resolve(REPO_ROOT, relative);
  const prefix = REPO_ROOT.endsWith(sep) ? REPO_ROOT : REPO_ROOT + sep;
  return full === REPO_ROOT || full.startsWith(prefix) ? full : null;
}

// --- in-page probes --------------------------------------------------------
const FIND_INPUTS = `(function findInputs(node, acc, skip) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (child === skip) continue;
    if (child instanceof Laya.Input && child.visible) acc.push(child);
    if (child.numChildren) findInputs(child, acc, skip);
  }
  return acc;
})`;

const FIND_BUTTON = `(function findButton(node, label) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (child instanceof Laya.Sprite && !(child instanceof Laya.Text) && child.numChildren === 1) {
      const inner = child.getChildAt(0);
      if (inner instanceof Laya.Text && inner.text === label) return child;
    }
    if (child.numChildren) { const found = findButton(child, label); if (found) return found; }
  }
  return null;
})`;

async function shot(page, name) {
  const file = resolve(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  log(`shot ${file}`);
  return file;
}

/** Waits for a rendezvous file to appear (and to contain valid JSON). */
async function waitForFile(file, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        /* partially written; retry */
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${label} (${file})`);
}

/**
 * Reads the verification code the lobby just mailed.
 *
 * The code is handed over through a file rather than read here: this script runs
 * inside a sandbox that forbids spawning child processes (`spawnSync` fails with
 * EBUSY for every binary), so it cannot call out to the mailbox itself. It
 * publishes a request file and waits for the companion `pk_wait_code.sh` to drop
 * the code next to it — the same shape as a human checking their inbox.
 */
async function waitForEmailCode(address, timeoutMs) {
  const request = resolve(RV, `code-requested-${USER}.txt`);
  const answer = resolve(RV, `code-${USER}.txt`);
  writeFileSync(request, `${address}\n`);
  log(`requested the verification code for ${address} (marker: ${request})`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(answer)) {
      const code = readFileSync(answer, 'utf8').trim();
      if (/^\d{6}$/.test(code)) {
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for the verification code (${answer})`);
}

// --- the run ---------------------------------------------------------------
const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text())) pageErrors.push(m.text());
});

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/internal/')) {
    await route.continue();
    return;
  }
  const file = resolveWithinRoot(url.pathname);
  if (file === null) {
    await route.fulfill({ status: 403, body: 'forbidden' });
    return;
  }
  try {
    const body = await readFile(file);
    await route.fulfill({
      status: 200,
      contentType: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      body,
    });
  } catch {
    await route.fulfill({ status: 404, body: 'not found' });
  }
});

const target =
  `${LOBBY}/index.html?debug=1` +
  `&lobbyHttpBase=${encodeURIComponent(LOBBY)}` +
  `&lobbyWsUrl=${encodeURIComponent(LOBBY_WS)}` +
  `&relayUrl=${encodeURIComponent(RELAY)}`;
log(`navigating to ${target}`);
await page.goto(target, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 40000 });
await page.waitForTimeout(2500);

// --- 1. login screen -------------------------------------------------------
await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 400));
});
await shot(page, '01-login-screen');

// --- 2. register form ------------------------------------------------------
const formFilled = await page.evaluate(
  async ({ findInputsSrc, user, email, password }) => {
    const findInputs = eval(findInputsSrc);
    const scenes = window.__PK_SCENES__;
    scenes.flow.setAuthMode('register');
    await new Promise((r) => setTimeout(r, 500));
    const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
    const byPrompt = (p) => inputs.find((i) => i.prompt === p);
    byPrompt('Username').text = user;
    byPrompt('E-mail').text = email;
    byPrompt('Password').text = password;
    byPrompt('Confirm password').text = password;
    await new Promise((r) => setTimeout(r, 200));
    return { prompts: inputs.map((i) => i.prompt), fields: scenes.login.debugState().visibleFieldCount };
  },
  { findInputsSrc: FIND_INPUTS, user: USER, email: EMAIL, password: PASSWORD },
);
step('register form shows the five fields', formFilled.fields === 5, JSON.stringify(formFilled));
await shot(page, '02-register-filled');

// --- 3. request the verification code -------------------------------------
const sent = await page.evaluate(
  async ({ findButtonSrc }) => {
    const findButton = eval(findButtonSrc);
    const scenes = window.__PK_SCENES__;
    const button = findButton(scenes.login.root, 'Send code');
    if (button) button.event(Laya.Event.CLICK);
    await new Promise((r) => setTimeout(r, 4000));
    const state = scenes.login.debugState();
    return {
      clicked: !!button,
      text: state.emailSendButtonText,
      status: scenes.flow.snapshot().statusText,
      error: scenes.flow.snapshot().lastError,
    };
  },
  { findButtonSrc: FIND_BUTTON },
);
step('Send code reached the lobby and started a countdown', sent.clicked && /^Resend \d+s$/.test(sent.text), JSON.stringify(sent));
await shot(page, '03-code-sent');

// --- 4. read the mailed code and submit -----------------------------------
const code = await waitForEmailCode(EMAIL, CODE_TIMEOUT_MS);
step('verification code arrived by e-mail', /^\d{6}$/.test(code), code);
await page.evaluate(
  async ({ findInputsSrc, code }) => {
    const findInputs = eval(findInputsSrc);
    const scenes = window.__PK_SCENES__;
    const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
    const field = inputs.find((i) => i.prompt === 'E-mail code');
    field.text = code;
    await new Promise((r) => setTimeout(r, 200));
  },
  { findInputsSrc: FIND_INPUTS, code },
);
await shot(page, '04-code-entered');

await page.evaluate(
  async ({ findButtonSrc }) => {
    const findButton = eval(findButtonSrc);
    const scenes = window.__PK_SCENES__;
    const button = findButton(scenes.login.root, 'Sign up & play');
    if (button) button.event(Laya.Event.CLICK);
  },
  { findButtonSrc: FIND_BUTTON },
);
let registered = null;
try {
  await page.waitForFunction(() => window.__PK_SCENES__.flow.snapshot().screen === 'lobby', { timeout: 40000, polling: 250 });
  registered = await page.evaluate(() => {
    const s = window.__PK_SCENES__.flow.snapshot();
    return { screen: s.screen, status: s.statusText, userId: s.session?.userId ?? '', display: s.session?.displayName ?? '' };
  });
} catch {
  registered = await page.evaluate(() => {
    const s = window.__PK_SCENES__.flow.snapshot();
    return { screen: s.screen, status: s.statusText, lastError: s.lastError };
  });
}
step('registration signed the player in', registered.screen === 'lobby', JSON.stringify(registered));
await shot(page, '05-registered');

// --- 5. sign out, then sign in again with e-mail + password ---------------
await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.flow.signOut();
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 600));
});
await page.evaluate(
  async ({ findInputsSrc, email, password }) => {
    const findInputs = eval(findInputsSrc);
    const scenes = window.__PK_SCENES__;
    const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
    inputs[0].text = email;
    inputs[1].text = password;
    await new Promise((r) => setTimeout(r, 200));
  },
  { findInputsSrc: FIND_INPUTS, email: EMAIL, password: PASSWORD },
);
await shot(page, '06-signin-filled');

await page.evaluate(
  async ({ findButtonSrc }) => {
    const findButton = eval(findButtonSrc);
    const scenes = window.__PK_SCENES__;
    const button = findButton(scenes.login.root, 'Sign in');
    if (button) button.event(Laya.Event.CLICK);
  },
  { findButtonSrc: FIND_BUTTON },
);
let signedIn = null;
try {
  await page.waitForFunction(() => window.__PK_SCENES__.flow.snapshot().screen === 'lobby', { timeout: 40000, polling: 250 });
  signedIn = await page.evaluate(() => {
    const s = window.__PK_SCENES__.flow.snapshot();
    return { screen: s.screen, status: s.statusText, display: s.session?.displayName ?? '' };
  });
} catch {
  signedIn = await page.evaluate(() => {
    const s = window.__PK_SCENES__.flow.snapshot();
    return { screen: s.screen, status: s.statusText, lastError: s.lastError };
  });
}
step('sign-in with e-mail + password reached the lobby', signedIn.screen === 'lobby', JSON.stringify(signedIn));
await shot(page, '07-signed-in');

// --- 6. the Play page: create or join a room ------------------------------
await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.lobby.setPage('play');
  await new Promise((r) => setTimeout(r, 500));
});
await shot(page, '08a-play-page');

const ROOM_FILE = resolve(RV, 'room.json');
const JOINED_FILE = resolve(RV, 'joined.json');

let roomCode = '';
if (ROLE === 'host') {
  const created = await page.evaluate(
    async ({ findButtonSrc }) => {
      const findButton = eval(findButtonSrc);
      const scenes = window.__PK_SCENES__;
      const button = findButton(scenes.lobby.root, 'Create room');
      if (button) button.event(Laya.Event.CLICK);
      await new Promise((r) => setTimeout(r, 3000));
      const s = scenes.flow.snapshot();
      return { clicked: !!button, room: s.room, status: s.statusText, error: s.lastError };
    },
    { findButtonSrc: FIND_BUTTON },
  );
  step('Create room produced a room on the lobby', !!created.room && created.room.roomCode !== '', JSON.stringify(created).slice(0, 400));
  roomCode = created.room?.roomCode ?? '';
  writeFileSync(ROOM_FILE, JSON.stringify({ roomCode, host: USER, at: Date.now() }));
  log(`published room ${roomCode} to the rendezvous file`);
  await shot(page, '08-room-created');

  await waitForFile(JOINED_FILE, 180000, 'the guest to join');
  log('guest reported joined');
  await page.waitForTimeout(1500);
  const roomState = await page.evaluate(() => window.__PK_SCENES__.flow.snapshot().room);
  step('the room shows both players', (roomState?.players?.length ?? 0) >= 2, JSON.stringify(roomState).slice(0, 400));
  await shot(page, '09-both-players');
} else {
  const rendezvous = await waitForFile(ROOM_FILE, 180000, 'the host to create a room');
  roomCode = rendezvous.roomCode;
  log(`host published room ${roomCode}`);
  const joined = await page.evaluate(
    async ({ roomCode }) => {
      const scenes = window.__PK_SCENES__;
      const ok = await scenes.flow.joinRoom(roomCode);
      await new Promise((r) => setTimeout(r, 2000));
      const s = scenes.flow.snapshot();
      return { ok, room: s.room, status: s.statusText, error: s.lastError };
    },
    { roomCode },
  );
  step('joining the host room reached the lobby', joined.ok === true, JSON.stringify(joined).slice(0, 400));
  writeFileSync(JOINED_FILE, JSON.stringify({ roomCode, guest: USER, at: Date.now() }));
  await shot(page, '08-room-joined');
  const roomState = await page.evaluate(() => window.__PK_SCENES__.flow.snapshot().room);
  step('the room shows both players', (roomState?.players?.length ?? 0) >= 2, JSON.stringify(roomState).slice(0, 400));
  await shot(page, '09-both-players');
}

// --- 7. the match ----------------------------------------------------------
if (STOP_AFTER === 'room') {
  log('--stop-after room: finishing before the match');
  writeFileSync(resolve(OUT, `${ROLE}-result.json`), JSON.stringify({ role: ROLE, user: USER, roomCode, steps, pageErrors }, null, 2));
  await browser.close();
  const failedEarly = steps.filter((s) => !s.ok);
  log(`===== ${ROLE}: ${steps.length - failedEarly.length}/${steps.length} steps passed =====`);
  process.exit(failedEarly.length === 0 ? 0 : 1);
}

let battle = null;
try {
  await page.waitForFunction(() => window.__PK_SCENES__.flow.snapshot().screen === 'battle', { timeout: 90000, polling: 250 });
  battle = { screen: 'battle' };
} catch {
  battle = await page.evaluate(() => {
    const s = window.__PK_SCENES__.flow.snapshot();
    return { screen: s.screen, status: s.statusText, lastError: s.lastError, allocation: s.allocation };
  });
}
step('the client entered the battle screen', battle.screen === 'battle', JSON.stringify(battle).slice(0, 400));
await shot(page, '10-battle-start');
await page.waitForTimeout(8000);
const inBattle = await page.evaluate(() => {
  const s = window.__PK_SCENES__.flow.snapshot();
  const app = window.__PK_APP__;
  // The endpoint the lobby handed this client lives on the signed match start,
  // not on the (empty) client-side allocation view.
  const match = s.match ?? null;
  let snapshots = null;
  try {
    const battle = app && app.battleScene ? app.battleScene.options.battle : null;
    snapshots = battle && battle.metrics ? battle.metrics.snapshotsReceived : null;
  } catch {
    /* the metrics are a diagnostic, not a requirement */
  }
  return {
    screen: s.screen,
    matchId: match?.matchId ?? s.allocation?.matchId ?? '',
    endpoint: match?.endpoint ?? s.allocation?.endpoint ?? '',
    modeId: match?.modeId ?? '',
    rulesetVersion: match?.rulesetVersion ?? '',
    roster: match?.playerIds ?? [],
    localPlayerId: match?.playerId ?? '',
    snapshots,
  };
});
log('battle state:', JSON.stringify(inBattle));
step(
  'the lobby routed the match to the RAKsmart battle server',
  (inBattle.endpoint ?? '').includes('104.233.217.232'),
  JSON.stringify(inBattle),
);
step(
  'the client is receiving snapshots from that server',
  typeof inBattle.snapshots === 'number' && inBattle.snapshots > 0,
  `snapshots=${inBattle.snapshots}`,
);
await shot(page, '11-battle-running');

step('no page error was raised', pageErrors.length === 0, JSON.stringify(pageErrors).slice(0, 300));

writeFileSync(resolve(OUT, `${ROLE}-result.json`), JSON.stringify({ role: ROLE, user: USER, roomCode, steps, battle: inBattle, pageErrors }, null, 2));
await browser.close();

const failed = steps.filter((s) => !s.ok);
log(`===== ${ROLE}: ${steps.length - failed.length}/${steps.length} steps passed =====`);
process.exit(failed.length === 0 ? 0 : 1);
