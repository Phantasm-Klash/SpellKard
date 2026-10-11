/**
 * "Session lost" browser regression.
 *
 * Drives the real app through the debug harness to prove the whole wiring in the
 * built bundle for both ways a session can end underneath the player:
 *
 *   1. `session_replaced` — the server said the account signed in elsewhere.
 *   2. `session_expired`  — an authenticated call came back a bare `401`, which
 *      is what an aged-out token, a restarted lobby and a superseded token all
 *      look like. The wording must NOT claim a takeover.
 *
 * Each must clear the session, flip the screen back to the login page and show
 * the matching player-facing reason.
 *
 * This does not need a live lobby: it installs a session directly and injects
 * the event the transport would have emitted.
 *
 * Usage:  node dev/shots_kicked.mjs [outDir]
 * Requires the dev server (npm run serve) on PORT or 8123.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots-kicked'));
const PORT = process.env.PORT ?? '8123';
const REPLACED_MESSAGE = 'This account was signed in on another device — this session has ended';
const EXPIRED_MESSAGE = 'Your session has expired — please sign in again';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 675, height: 900 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await page.waitForTimeout(1500);

const COLLECT = `(function collect(node, acc) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (!child.visible) continue;
    if (typeof child.text === 'string' && child.text !== '') acc.push(child.text);
    if (child.numChildren) collect(child, acc);
  }
  return acc;
})`;

/** Arm a signed-in lobby screen, fire `kind`, and report what the UI did. */
const DRIVE = `(async (collectSrc, kind) => {
  const collect = eval(collectSrc);
  const scenes = window.__PK_SCENES__;
  const flow = scenes.flow;

  // Reset first: the sessionLost flag is only cleared by sign-out/show-login,
  // and the previous scenario left it set — a second report would be swallowed
  // by the idempotency guard.
  flow.signOut();

  // Signed-in state, as it would be after a successful sign-in.
  flow.client.session = {
    sessionToken: 'tok-1',
    userId: 'u-1',
    playerId: 'p-1',
    displayName: 'Alice',
    characterId: 'reimu',
    rulesetVersion: 'rs-1',
    unlockedCharacterIds: [],
  };
  scenes.switchTo('lobby');
  await new Promise((r) => setTimeout(r, 300));
  const lobbyVisibleBefore = scenes.lobby.root.visible;

  // The transport would emit this after the lobby dropped the session.
  flow.client.dispatchEvent({ kind });
  await new Promise((r) => setTimeout(r, 300));

  const snapshot = flow.snapshot();
  return {
    lobbyVisibleBefore,
    loginVisibleAfter: scenes.login.root.visible,
    screen: flow.currentScreen,
    session: snapshot.session,
    authErrorCode: snapshot.authErrorCode,
    sessionLost: snapshot.sessionLost,
    lastError: snapshot.lastError,
    labels: collect(scenes.login.root, []),
  };
})`;

const replaced = await page.evaluate(
  ({ drive, collect, kind }) => eval(`(${drive})`)(collect, kind),
  { drive: DRIVE, collect: COLLECT, kind: 'session_replaced' },
);
await page.screenshot({ path: resolve(OUT, 'kicked-login.png') });

const expired = await page.evaluate(
  ({ drive, collect, kind }) => eval(`(${drive})`)(collect, kind),
  { drive: DRIVE, collect: COLLECT, kind: 'session_expired' },
);
await page.screenshot({ path: resolve(OUT, 'expired-login.png') });

await browser.close();

const checks = [
  // -- scenario 1: replaced by a newer sign-in ---------------------------- #
  ['replaced: starts on the lobby screen', replaced.lobbyVisibleBefore === true],
  ['replaced: returns to the login screen', replaced.screen === 'login' && replaced.loginVisibleAfter === true],
  ['replaced: session is cleared', replaced.session === null],
  ['replaced: authErrorCode is session_replaced', replaced.authErrorCode === 'session_replaced'],
  ['replaced: sessionLost flag is set', replaced.sessionLost === true],
  ['replaced: lastError is the player-facing reason', replaced.lastError === REPLACED_MESSAGE],
  ['replaced: login screen renders the reason', replaced.labels.includes(REPLACED_MESSAGE)],

  // -- scenario 2: a bare authenticated 401 ------------------------------- #
  ['expired: starts on the lobby screen', expired.lobbyVisibleBefore === true],
  ['expired: returns to the login screen', expired.screen === 'login' && expired.loginVisibleAfter === true],
  ['expired: session is cleared', expired.session === null],
  ['expired: authErrorCode is session_expired', expired.authErrorCode === 'session_expired'],
  ['expired: sessionLost flag is set', expired.sessionLost === true],
  ['expired: lastError is the player-facing reason', expired.lastError === EXPIRED_MESSAGE],
  ['expired: login screen renders the reason', expired.labels.includes(EXPIRED_MESSAGE)],
  ['expired: does not claim a takeover', !expired.labels.includes(REPLACED_MESSAGE)],

  ['no page error thrown', pageErrors.length === 0],
];

console.log('');
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\nkicked shots: ${checks.length - failed} passed, ${failed} failed`);
if (pageErrors.length > 0) {
  console.log('page errors:', JSON.stringify(pageErrors));
}
process.exit(failed === 0 ? 0 : 1);
