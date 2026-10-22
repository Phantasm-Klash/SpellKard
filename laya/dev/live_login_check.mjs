/**
 * Live end-to-end check against a running Gensoulkyo lobby.
 *
 * Every other login test runs against a scripted transport, so this is the only
 * one that proves the *client* and the *server* actually agree. It drives the
 * real web build through the debug harness and asserts:
 *
 *   1. sign-in  — e-mail + password reaches `/v1/auth/login` and lands on the
 *      lobby screen with a real session;
 *   2. send code — the register form's compact button reaches
 *      `/v1/auth/email/code` and turns into the server's own resend countdown,
 *      which only happens when the lobby accepted the send.
 *
 * Usage:
 *   node dev/live_login_check.mjs [lobbyBase]
 *   PK_LOBBY_BASE=http://gateway.wjcwqc.com:7350 node dev/live_login_check.mjs
 *
 * Requires the local dev server (`PORT=8123 node dev/serve.mjs`); the page is
 * served locally and the API is remote. Credentials come from PK_EMAIL /
 * PK_PASSWORD and default to the seeded operator account.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[3] ?? resolve(HERE, 'shots-live'));
mkdirSync(OUT, { recursive: true });

const LOBBY = process.argv[2] ?? process.env.PK_LOBBY_BASE ?? 'http://127.0.0.1:7350';
const WS = LOBBY.replace(/^http/, 'ws') + '/v1/lobby/ws';
const PORT = process.env.PORT ?? '8123';
const EMAIL = process.env.PK_EMAIL ?? 'wjcwqc@gmail.com';
const PASSWORD = process.env.PK_PASSWORD ?? 'wjc11111';
// Plus-addressed so the probe never collides with a registered account while
// still landing in the same mailbox.
const PROBE_EMAIL = process.env.PK_PROBE_EMAIL ?? `wjcwqc+pk${Date.now()}@gmail.com`;

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

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` -- ${detail}`}`);
  if (!ok) failures.push(label);
};

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 675, height: 900 }, deviceScaleFactor: 1 });

// Chrome reports every failed sub-resource as a bare "Failed to load resource"
// console error without the URL, so URLs are tracked from the response event
// instead; that keeps this list to things that actually matter.
const errors = [];
const ignorable = (text) => /favicon|Failed to load resource/i.test(text);
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !ignorable(m.text())) errors.push(`console: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && !ignorable(r.url())) errors.push(`http ${r.status()} ${r.url()}`);
});

const url =
  `http://127.0.0.1:${PORT}/index.html?debug=1&lang=en` +
  `&lobbyHttpBase=${encodeURIComponent(LOBBY)}` +
  `&lobbyWsUrl=${encodeURIComponent(WS)}`;
console.log(`lobby: ${LOBBY}`);
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 30000 });
await page.waitForTimeout(2500);

// --- 1. sign in with the seeded account ------------------------------------
console.log('\n[1] sign in');
const filled = await page.evaluate(
  async ({ findInputsSrc, email, password }) => {
    const findInputs = eval(findInputsSrc);
    const scenes = window.__PK_SCENES__;
    scenes.flow.setAuthMode('login');
    scenes.switchTo('login');
    await new Promise((r) => setTimeout(r, 400));
    const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
    inputs[0].text = email;
    inputs[1].text = password;
    return { count: inputs.length, prompt: inputs[0].prompt };
  },
  { findInputsSrc: FIND_INPUTS, email: EMAIL, password: PASSWORD },
);
check('sign-in mode shows exactly the e-mail and password rows', filled.count === 2, JSON.stringify(filled));
check('the first row is the e-mail field', filled.prompt === 'E-mail', filled.prompt);

await page.evaluate(
  async ({ findButtonSrc }) => {
    const findButton = eval(findButtonSrc);
    const scenes = window.__PK_SCENES__;
    const button = findButton(scenes.login.root, 'Sign in');
    if (button) button.event(Laya.Event.CLICK);
    return !!button;
  },
  { findButtonSrc: FIND_BUTTON },
);
// Give the real round trip (PBKDF2 verify + bootstrap) time to finish.
await page.waitForTimeout(6000);
const signedIn = await page.evaluate(() => {
  const snapshot = window.__PK_SCENES__.flow.snapshot();
  return {
    screen: snapshot.screen,
    statusText: snapshot.statusText,
    lastError: snapshot.lastError,
    userId: snapshot.session?.userId ?? null,
    displayName: snapshot.session?.displayName ?? null,
    hasToken: (snapshot.session?.sessionToken ?? '') !== '',
  };
});
console.log('   ', JSON.stringify(signedIn));
check('the client landed on the lobby screen', signedIn.screen === 'lobby', signedIn.screen);
check('the lobby issued a session token', signedIn.hasToken);
check('the session names the seeded account', signedIn.userId !== null, String(signedIn.userId));
check('no sign-in error was reported', signedIn.lastError === '', signedIn.lastError);
await page.screenshot({ path: resolve(OUT, 'live-login.png') });

// --- 2. the register form's "Send code" button -----------------------------
console.log('\n[2] send verification code');
const sent = await page.evaluate(
  async ({ findInputsSrc, findButtonSrc, probeEmail }) => {
    const findInputs = eval(findInputsSrc);
    const findButton = eval(findButtonSrc);
    const scenes = window.__PK_SCENES__;
    scenes.flow.signOut();
    scenes.flow.setAuthMode('register');
    scenes.switchTo('login');
    await new Promise((r) => setTimeout(r, 400));
    const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
    const email = inputs.find((i) => i.prompt === 'E-mail');
    email.text = probeEmail;
    const before = scenes.login.debugState();
    const button = findButton(scenes.login.root, 'Send code');
    if (button) button.event(Laya.Event.CLICK);
    // A real SMTP send takes a moment; the countdown only starts once the
    // lobby answers.
    await new Promise((r) => setTimeout(r, 4000));
    const after = scenes.login.debugState();
    return {
      clicked: !!button,
      before: before.emailSendButtonText,
      after: after.emailSendButtonText,
      seconds: after.codeResendSeconds,
      statusText: scenes.flow.snapshot().statusText,
      lastError: scenes.flow.snapshot().lastError,
    };
  },
  { findInputsSrc: FIND_INPUTS, findButtonSrc: FIND_BUTTON, probeEmail: PROBE_EMAIL },
);
console.log('   ', JSON.stringify(sent));
check('the button was found and clicked', sent.clicked === true);
check('the button started as "Send code"', sent.before === 'Send code', sent.before);
check(
  'the lobby accepted the send and the button became a countdown',
  /^Resend \d+s$/.test(sent.after),
  sent.after,
);
check('the countdown came from the server window', sent.seconds > 0 && sent.seconds <= 60, String(sent.seconds));
check('the status line reports where the code went', sent.statusText.includes(PROBE_EMAIL), sent.statusText);
check('no error was reported', sent.lastError === '', sent.lastError);
await page.screenshot({ path: resolve(OUT, 'live-register.png') });

check('no page error and no failed request', errors.length === 0, JSON.stringify(errors));

await browser.close();
console.log(`\n===== ${failures.length === 0 ? 'LIVE CHECK OK' : `${failures.length} FAILED`} =====`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
}
process.exit(failures.length === 0 ? 0 : 1);
