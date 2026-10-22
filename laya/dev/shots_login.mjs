/**
 * Login screen screenshots + programmatic assertions.
 *
 * Drives the real `LoginScene` through the debug harness:
 *   1. sign-in mode  -> shot + assert the backdrop and portrait textures loaded;
 *   2. register mode -> shot + assert the mode flip reached the scene;
 *   3. a simulated native-wide stage (1333x750) -> shot + assert the card and
 *      portrait both stay inside the stage and the portrait keeps its aspect;
 *   4. keyboard wiring -> real Tab / Shift+Tab / Escape / Alt+Enter / Enter
 *      presses must reach the dispatcher and drive the form;
 *   5. caret placement -> a click inside an unfocused field must put the caret
 *      where the pointer is, not at the end of the value.
 *
 * Usage:  node dev/shots_login.mjs [outDir]
 * Requires the dev server (npm run serve) on PORT or 8123.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('C:/Users/wjcwqc/.workbuddy-ai/binaries/node/workspace/');
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] ?? resolve(HERE, 'shots-login'));
const PORT = process.env.PORT ?? '8123';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  channel: 'chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// 3:4 viewport to match the web design stage (900x1200) so `showall` fills it.
const page = await browser.newPage({ viewport: { width: 675, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
// Let the login art settle (the loader probes two roots).
await page.waitForTimeout(2000);

const COLLECT = `(function collect(node, acc) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (!child.visible) continue;
    if (typeof child.text === 'string' && child.text !== '') acc.push(child.text);
    if (child.numChildren) collect(child, acc);
  }
  return acc;
})`;

// Finds the login form's editable fields.
//
// The settings modal carries its own `Laya.Input` fields (the LAN host and the
// third-party endpoints), so the walk skips that subtree: this probe is about
// the login *form*, and an unfiltered walk would count the panel's fields too.
//
// Only *visible* inputs are collected. The card owns five fields (username,
// e-mail, password, confirm, code) but sign-in mode shows just two, and the
// hidden three must not shift the indices the probes below rely on.
const FIND_INPUTS = `(function findInputs(node, acc, skip) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (child === skip) continue;
    if (child instanceof Laya.Input && child.visible) acc.push(child);
    if (child.numChildren) findInputs(child, acc, skip);
  }
  return acc;
})`;

// Finds a button by its label.
//
// A `ui_kit` button is a mouse-enabled `Sprite` whose direct children are the
// seal layer and the `Laya.Text` label, so the label is matched one level down.
// The match is restricted to mouse-enabled sprites because the read-only hint
// rows are also two-text sprites and would otherwise shadow the real control.
const FIND_BUTTON = `(function findButton(node, label) {
  for (let i = 0; i < node.numChildren; i++) {
    const child = node.getChildAt(i);
    if (child.mouseEnabled && child.numChildren > 0) {
      for (let j = 0; j < child.numChildren; j++) {
        const inner = child.getChildAt(j);
        if (inner instanceof Laya.Text && inner.text === label) return child;
      }
    }
    if (child.numChildren) { const found = findButton(child, label); if (found) return found; }
  }
  return null;
})`;

// --- 1. sign-in mode -------------------------------------------------------
const login = await page.evaluate(async (collectSrc) => {
  const collect = eval(collectSrc);
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 400));
  return { state: scenes.login.debugState(), labels: collect(scenes.login.root, []) };
}, COLLECT);
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(OUT, 'login-signin.png') });
console.log('login mode:', JSON.stringify(login.state));

// --- 1b. settings modal ----------------------------------------------------
// The gear button lives in the top-right corner; clicking it must open the
// shared modal on top of the whole screen. It opens on the Language tab (the
// first thing a player looks for when the UI is not in their language), and the
// product facts the old single-page panel used to show now live on About.
const settings = await page.evaluate(async (collectSrc) => {
  const collect = eval(collectSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 300));
  const login = scenes.login;
  login.settingsButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 200));
  const state = login.settings.debugState();
  const labels = collect(login.root, []);

  // Walk every tab and record its metrics: this is what proves each section
  // builds real rows instead of rendering an empty card.
  const tabs = [];
  for (const title of ['Language', 'Display', 'Keys', 'Audio', 'HUD', 'Other', 'About']) {
    login.settings.selectTabByTitle(title);
    await new Promise((r) => setTimeout(r, 60));
    const s = login.settings.debugState();
    tabs.push({
      title: s.activeTab,
      subtitle: s.subtitle,
      rows: s.labels.length,
      contentHeight: s.contentHeight,
      scrollable: s.scrollable,
    });
  }

  // The walk ends on About, so revisit Display and keep its labels: the
  // assertions below pin that tab's own rows, not whatever tab happens to be
  // open when the panel first appears.
  login.settings.selectTabByTitle('Display');
  await new Promise((r) => setTimeout(r, 120));
  const displayLabels = collect(login.root, []);

  login.settings.selectTabByTitle('About');
  await new Promise((r) => setTimeout(r, 120));
  const about = login.settings.debugState();
  const aboutLabels = collect(login.root, []);

  // The Keys tab is generated from the shortcut table, so its rows must name
  // the chords the player actually presses rather than a hand-written list.
  login.settings.selectTabByTitle('Keys');
  await new Promise((r) => setTimeout(r, 120));
  const keysTab = login.settings.debugState();
  const keysLabels = collect(login.root, []);
  return { state, labels, tabs, displayLabels, about, aboutLabels, keysTab, keysLabels };
}, COLLECT);
console.log('settings modal:', JSON.stringify(settings.state));
console.log('settings tabs:', JSON.stringify(settings.tabs));
console.log('settings keys tab:', JSON.stringify(settings.keysTab.labels.length), settings.keysLabels.slice(0, 14));

// One shot per tab, so every menu is reviewable without a live session.
for (const title of ['Display', 'Keys', 'Audio', 'HUD', 'Other', 'About']) {
  await page.evaluate(async (tab) => {
    const panel = window.__PK_SCENES__.login.settings;
    panel.show();
    panel.selectTabByTitle(tab);
    await new Promise((r) => setTimeout(r, 160));
  }, title);
  await page.screenshot({ path: resolve(OUT, `login-settings-${title.toLowerCase()}.png`) });
}

await page.evaluate(async () => {
  window.__PK_SCENES__.login.settings.selectTabByTitle('Display');
  await new Promise((r) => setTimeout(r, 120));
});
await page.screenshot({ path: resolve(OUT, 'login-settings.png') });

const settingsClosed = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  const login = scenes.login;
  login.settings.closeButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 200));
  return { open: login.settings.debugState().open, rootVisible: login.settings.root.visible };
});

// --- 1c. settings really reach the engine ---------------------------------
// A settings screen that only stores values is worthless, so prove each knob
// lands: the frame cap on `Laya.Render.predicate` (the only numeric frame gate
// this engine version has), the mute switch on the mixer bus, and the frame
// counter as a live readout on the stage.
const applied = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const beforeCap = typeof Laya.Render.predicate;
  scenes.settings.update({ display: { frameCap: 30 } });
  await wait(80);
  const capped = typeof Laya.Render.predicate;
  scenes.settings.update({ display: { frameCap: 0 } });
  await wait(80);
  const uncapped = Laya.Render.predicate;

  scenes.settings.update({ audio: { muted: true } });
  await wait(80);
  const mutedBus = Laya.SoundManager.soundMuted;
  scenes.settings.update({ audio: { muted: false, masterVolume: 0.5 } });
  await wait(80);
  const unmutedBus = Laya.SoundManager.soundMuted;

  scenes.settings.update({ display: { showFps: true } });
  await wait(800);
  const texts = [];
  const walk = (node) => {
    for (let i = 0; i < node.numChildren; i++) {
      const child = node.getChildAt(i);
      if (typeof child.text === 'string' && child.text) texts.push(child.text);
      if (child.numChildren) walk(child);
    }
  };
  walk(Laya.stage);
  scenes.settings.update({ display: { showFps: false } });

  return { beforeCap, capped, uncapped, mutedBus, unmutedBus, fps: texts.filter((t) => t.endsWith(' FPS')) };
});
console.log('settings applied:', JSON.stringify(applied));

// --- 1d. persistence ------------------------------------------------------
const persisted = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.settings.update({ audio: { bgmVolume: 0.35 }, hud: { showOpponentHud: false } });
  await new Promise((r) => setTimeout(r, 80));
  const raw = window.localStorage.getItem('spellkard.settings');
  // Restore the shipped defaults so the later pages in this browser context
  // (which share localStorage) boot from a known state.
  scenes.settings.reset();
  // A reset puts *every* knob back to the shipped default, and the shipped
  // default language is Simplified Chinese — so the whole UI flips language
  // here. This harness asserts against the English copy, so re-pin the same
  // `?lang=` override the page booted with; otherwise every `prompt`/label
  // comparison below silently starts looking for English in a Chinese UI.
  scenes.settings.update({ language: 'en' });
  await new Promise((r) => setTimeout(r, 80));
  return raw;
});
console.log('persisted:', persisted);

// --- 2. register mode ------------------------------------------------------
const register = await page.evaluate(async (collectSrc) => {
  const collect = eval(collectSrc);
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('register');
  await new Promise((r) => setTimeout(r, 400));
  return { state: scenes.login.debugState(), labels: collect(scenes.login.root, []) };
}, COLLECT);
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(OUT, 'login-register.png') });
console.log('register mode:', JSON.stringify(register.state));

// --- 2b. the "Send code" button --------------------------------------------
// The register form asks for a username, an e-mail address, a password (twice)
// and the code the lobby mails out. The compact "Send code" button lives inside
// the e-mail row, so this section pins its placement, its label and the
// countdown the server's `resend_in_seconds` drives.
const sendCode = await page.evaluate(async ({ collectSrc, findInputsSrc, findButtonSrc }) => {
  const collect = eval(collectSrc);
  const findInputs = eval(findInputsSrc);
  const findButton = eval(findButtonSrc);
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('register');
  scenes.login.settings.hide();
  await new Promise((r) => setTimeout(r, 350));

  const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
  const email = inputs.find((i) => i.prompt === 'E-mail');
  const username = inputs.find((i) => i.prompt === 'Username');
  const code = inputs.find((i) => i.prompt === 'E-mail code');
  const prompts = inputs.map((i) => i.prompt);
  email.text = 'wjcwqc@example.com';

  // Stub the flow so no network is touched; the button only has to prove that it
  // reaches the flow and turns the server's window into a countdown.
  const original = scenes.flow.requestEmailCode.bind(scenes.flow);
  const calls = [];
  scenes.flow.requestEmailCode = (address) => {
    calls.push(address);
    return Promise.resolve({ ok: true, resendInSeconds: 60 });
  };

  const before = scenes.login.debugState();
  const emailRect = { x: email.x, y: email.y, width: email.width, height: email.height };
  const button = findButton(scenes.login.root, 'Send code');
  if (button) button.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 400));
  const after = scenes.login.debugState();
  const labels = collect(scenes.login.root, []);

  scenes.flow.requestEmailCode = original;
  // Deliberately left in register mode (with the countdown running) so the
  // screenshot below captures the real sign-up form.
  return { prompts, calls, before, after, labels, emailRect };
}, { collectSrc: COLLECT, findInputsSrc: FIND_INPUTS, findButtonSrc: FIND_BUTTON });
console.log(
  'send code:',
  JSON.stringify({
    prompts: sendCode.prompts,
    calls: sendCode.calls,
    before: sendCode.before.emailSendButtonText,
    after: sendCode.after.emailSendButtonText,
    seconds: sendCode.after.codeResendSeconds,
  }),
);
await page.screenshot({ path: resolve(OUT, 'login-register.png') });

// Put the form back the way the probe found it: the probe typed into the
// e-mail field, so clear it and drop the "user edited this" guard that the
// change event set, otherwise the later typing probe starts from a filled box.
await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  const walk = (node) => {
    if (node instanceof Laya.Input) {
      node.text = '';
      return;
    }
    for (let i = 0; i < node.numChildren; i++) walk(node.getChildAt(i));
  };
  walk(scenes.login.root);
  scenes.login.emailDirty = false;
  scenes.login.usernameDirty = false;
  scenes.login.stopCodeCountdown();
  scenes.flow.setAuthMode('login');
  await new Promise((r) => setTimeout(r, 250));
});

// --- 3. native-wide stage --------------------------------------------------
// A second page boots the web build at the LayaNative design size (1333x750)
// through the query overrides, so the two-column layout renders for real
// instead of poking the stage getters (which leaves the render transform
// inconsistent and is only good for reading numbers).
const widePage = await browser.newPage({ viewport: { width: 1333, height: 750 }, deviceScaleFactor: 1 });
widePage.on('pageerror', (e) => console.log('[wide pageerror]', e.message));
await widePage.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en&stageWidth=1333&stageHeight=750`, {
  waitUntil: 'load',
  timeout: 60000,
});
await widePage.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await widePage.waitForTimeout(2000);
const wide = await widePage.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 400));
  return { state: scenes.login.debugState(), stage: { width: Laya.stage.width, height: Laya.stage.height } };
});
await widePage.waitForTimeout(200);
await widePage.screenshot({ path: resolve(OUT, 'login-wide.png') });
console.log('wide stage:', JSON.stringify(wide));
// Release the page: every extra live page holds a swiftshader WebGL context,
// and three of them at once starve the renderer badly enough that the next
// `goto` never reaches `load` (this used to time out here).
await widePage.close();

// --- 3b. ultra-wide stage (halo must still fit) ----------------------------
// A wider window keeps the portrait pinned near the right edge; the halo disc
// must be clamped inside the stage instead of being clipped by it.
const ultraPage = await browser.newPage({ viewport: { width: 1920, height: 750 }, deviceScaleFactor: 1 });
ultraPage.on('pageerror', (e) => console.log('[ultra pageerror]', e.message));
await ultraPage.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en&stageWidth=1920&stageHeight=750`, {
  waitUntil: 'load',
  timeout: 60000,
});
await ultraPage.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await ultraPage.waitForTimeout(2000);
const ultra = await ultraPage.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 400));
  return { state: scenes.login.debugState(), stage: { width: Laya.stage.width, height: Laya.stage.height } };
});
await ultraPage.screenshot({ path: resolve(OUT, 'login-ultrawide.png') });
console.log('ultra-wide stage:', JSON.stringify(ultra));

// On an ultra-wide but short stage the card must stay vertically inside the
// stage, not run off the bottom.
const ultraSettings = await ultraPage.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.login.settings.show();
  await new Promise((r) => setTimeout(r, 250));
  return scenes.login.settings.debugState();
});
console.log('ultra settings:', JSON.stringify({ cardRect: ultraSettings.cardRect }));
await ultraPage.screenshot({ path: resolve(OUT, 'login-ultrawide-settings.png') });
// Same reason as the wide page: hand the WebGL context back before the next one.
await ultraPage.close();

// --- 4. real typing into the first field -----------------------------------
// Focus the field through the engine's own text-input adapter (setting
// `focus = true` is exactly what its mouse-down capture does), then type with
// real key events and read the value back. In sign-in mode the first field is
// the e-mail address (it is the sign-in identifier).
await page.evaluate(async (findSrc) => {
  const findInputs = eval(findSrc);
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 300));
  const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
  inputs[0].focus = true;
}, FIND_INPUTS);
await page.waitForTimeout(300);
await page.keyboard.type('bob');
await page.waitForTimeout(300);
const typed = await page.evaluate(async (findSrc) => {
  const findInputs = eval(findSrc);
  const scenes = window.__PK_SCENES__;
  const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
  await new Promise((r) => setTimeout(r, 100));
  return {
    count: inputs.length,
    first: inputs[0].text,
    passwordType: inputs[1].type,
    passwordValue: inputs[1].text,
  };
}, FIND_INPUTS);
await page.screenshot({ path: resolve(OUT, 'login-typed.png') });
console.log('typed:', JSON.stringify(typed));

// --- 5. busy state ---------------------------------------------------------
// Click the primary button and read the scene *synchronously*: `run()` sets the
// busy flag before its first `await`, so the button label must already read
// "Signing in…" in the same tick as the click.
const busy = await page.evaluate(async ({ collectSrc, findInputsSrc, findButtonSrc }) => {
  const collect = eval(collectSrc);
  const findInputs = eval(findInputsSrc);
  const findButton = eval(findButtonSrc);
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 300));
  const inputs = findInputs(scenes.login.root, []);
  inputs[0].text = 'bob';
  inputs[1].text = 'secret123';
  const before = collect(scenes.login.root, []);
  const button = findButton(scenes.login.root, 'Sign in');
  if (button) button.event(Laya.Event.CLICK);
  const after = collect(scenes.login.root, []);
  return { clicked: !!button, before, after };
}, { collectSrc: COLLECT, findInputsSrc: FIND_INPUTS, findButtonSrc: FIND_BUTTON });
console.log('busy:', JSON.stringify({ clicked: busy.clicked, after: busy.after }));

// --- 6. endpoint caption ---------------------------------------------------
// A fresh page wired with a fake lobby base: the scene is signed out and never
// connected, so it must surface the endpoint it could not reach.
const endpointPage = await browser.newPage({ viewport: { width: 675, height: 900 }, deviceScaleFactor: 1 });
endpointPage.on('pageerror', (e) => console.log('[endpoint pageerror]', e.message));
await endpointPage.goto(
  `http://127.0.0.1:${PORT}/index.html?debug=1&lang=en&lobbyHttpBase=${encodeURIComponent('https://fake-lobby.invalid')}`,
  { waitUntil: 'load', timeout: 60000 },
);
await endpointPage.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await endpointPage.waitForTimeout(1500);
const endpoint = await endpointPage.evaluate(async (collectSrc) => {
  const collect = eval(collectSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 300));
  return { labels: collect(scenes.login.root, []) };
}, COLLECT);
console.log('endpoint labels:', JSON.stringify(endpoint.labels.filter((t) => t.startsWith('Lobby:'))));
await endpointPage.screenshot({ path: resolve(OUT, 'login-endpoint.png') });
await endpointPage.close();

// --- 7. narrow / tall stage ------------------------------------------------
// 480x1280 is far taller than the design ratio; the layout must still produce
// non-negative rectangles (no NaN, no negatives) in register mode (tallest card).
const narrowPage = await browser.newPage({ viewport: { width: 480, height: 1280 }, deviceScaleFactor: 1 });
narrowPage.on('pageerror', (e) => console.log('[narrow pageerror]', e.message));
await narrowPage.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en&stageWidth=480&stageHeight=1280`, {
  waitUntil: 'load',
  timeout: 60000,
});
await narrowPage.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await narrowPage.waitForTimeout(1500);
const narrow = await narrowPage.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('register');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 400));
  return { state: scenes.login.debugState(), stage: { width: Laya.stage.width, height: Laya.stage.height } };
});
console.log('narrow stage:', JSON.stringify(narrow));
await narrowPage.screenshot({ path: resolve(OUT, 'login-narrow.png') });

// The settings card has to adapt to a narrow stage too: it is clamped to the
// available width rather than overflowing it.
const narrowSettings = await narrowPage.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.login.settings.show();
  await new Promise((r) => setTimeout(r, 250));
  return scenes.login.settings.debugState();
});
console.log('narrow settings:', JSON.stringify({ cardRect: narrowSettings.cardRect, tabs: narrowSettings.tabs }));
await narrowPage.screenshot({ path: resolve(OUT, 'login-narrow-settings.png') });
await narrowPage.close();

// --- 8. sigil fallback -----------------------------------------------------
// Block the optional sigil art so it never arrives: the scene must fall back to
// the vector ellipse and still render (portrait loads, no page error thrown).
const fallbackPage = await browser.newPage({ viewport: { width: 675, height: 900 }, deviceScaleFactor: 1 });
const fallbackErrors = [];
fallbackPage.on('pageerror', (e) => fallbackErrors.push(e.message));
await fallbackPage.route('**/login_sigil.png', (route) => route.abort());
await fallbackPage.goto(`http://127.0.0.1:${PORT}/index.html?debug=1&lang=en`, { waitUntil: 'load', timeout: 60000 });
await fallbackPage.waitForFunction(() => !!window.__PK_SCENES__, { timeout: 20000 });
await fallbackPage.waitForTimeout(2000);
const fallback = await fallbackPage.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 300));
  return scenes.login.debugState();
});
console.log('sigil fallback:', JSON.stringify(fallback));
await fallbackPage.screenshot({ path: resolve(OUT, 'login-sigil-fallback.png') });
await fallbackPage.close();

// --- 9. keyboard shortcuts -------------------------------------------------
// The table and the matcher are unit-tested in `tests/shortcuts.test.ts`; this
// section proves the *wiring* — that a real key press on the page reaches the
// dispatcher, lands in the login scope, and drives the form.
const CLEAR_FOCUS = `(function clearFocus(node) {
  if (node instanceof Laya.Input && node.focus) node.focus = false;
  for (let i = 0; i < node.numChildren; i++) clearFocus(node.getChildAt(i));
})`;

const keys = await page.evaluate(async ({ findSrc, clearSrc }) => {
  const clearFocus = eval(clearSrc);
  const scenes = window.__PK_SCENES__;
  scenes.flow.setAuthMode('login');
  scenes.switchTo('login');
  await new Promise((r) => setTimeout(r, 400));
  scenes.login.settings.hide();
  clearFocus(scenes.login.root);
  await new Promise((r) => setTimeout(r, 250));
  const state = scenes.login.debugState();
  return {
    dispatcher: scenes.shortcuts.debugState(),
    focus: state.focusedFieldIndex,
    fields: state.visibleFieldCount,
  };
}, { findSrc: FIND_INPUTS, clearSrc: CLEAR_FOCUS });
console.log('shortcuts idle:', JSON.stringify(keys));

const focusAt = () => page.evaluate(() => window.__PK_SCENES__.login.debugState().focusedFieldIndex);

await page.evaluate(async ({ findSrc }) => {
  const findInputs = eval(findSrc);
  const scenes = window.__PK_SCENES__;
  findInputs(scenes.login.root, [], scenes.login.settings.root)[0].focus = true;
}, { findSrc: FIND_INPUTS });
await page.waitForTimeout(250);
const focusStart = await focusAt();

await page.keyboard.press('Tab');
await page.waitForTimeout(180);
const focusTab = await focusAt();

await page.keyboard.press('Shift+Tab');
await page.waitForTimeout(180);
const focusShiftTab = await focusAt();

// Two more Tabs from index 0 must wrap back to 0 across the two-field form.
await page.keyboard.press('Tab');
await page.waitForTimeout(120);
await page.keyboard.press('Tab');
await page.waitForTimeout(180);
const focusWrapped = await focusAt();
const afterTabs = await page.evaluate(() => window.__PK_SCENES__.shortcuts.debugState());
console.log('tab focus:', JSON.stringify({ focusStart, focusTab, focusShiftTab, focusWrapped, lastAction: afterTabs.lastAction, count: afterTabs.dispatchCount }));

// Escape with a field focused leaves the field first (it does not close the
// screen): that two-step behaviour is what the binding table promises.
await page.keyboard.press('Escape');
await page.waitForTimeout(220);
const focusAfterEscape = await focusAt();
console.log('escape focus:', focusAfterEscape);

// --- 9b. Alt+Enter fullscreen ---------------------------------------------
const fsBefore = await page.evaluate(() => window.__PK_SCENES__.fullscreen());
await page.keyboard.press('Alt+Enter');
await page.waitForTimeout(500);
const fsAfter = await page.evaluate(() => ({
  state: window.__PK_SCENES__.fullscreen(),
  lastAction: window.__PK_SCENES__.shortcuts.debugState().lastAction,
  element: document.fullscreenElement !== null,
}));
// Leave fullscreen again so the later screenshots are framed normally.
await page.evaluate(async () => {
  if (document.fullscreenElement !== null) {
    await document.exitFullscreen().catch(() => undefined);
  }
});
await page.waitForTimeout(300);
console.log('fullscreen:', JSON.stringify({ before: fsBefore, after: fsAfter }));

// --- 9c. caret placement on click ------------------------------------------
// MEASURED BUG: the engine's `TextInputAdapter.onTouchBegin` never forwards the
// pointer position, so a click on an unfocused field parked the caret at the
// end of the value (selectionStart === text.length at 20%, 50% and 80%).
// `platform/laya/text_input` re-applies the selection after the DOM overlay
// focuses, so the index must now track the click.
const caretGeom = await page.evaluate(async ({ findSrc }) => {
  const findInputs = eval(findSrc);
  const scenes = window.__PK_SCENES__;
  const input = findInputs(scenes.login.root, [], scenes.login.settings.root)[0];
  input.text = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const origin = input.localToGlobal(new Laya.Point(0, 0));
  const k = Laya.stage._canvasTransform.a * Laya.stage.clientScaleX;
  return { x: origin.x * k, y: origin.y * k, w: input.width * k, h: input.height * k };
}, { findSrc: FIND_INPUTS });

const caretSamples = [];
for (const frac of [0.2, 0.5, 0.8]) {
  // Blur first: every sample must go through the canvas->DOM transition, which
  // is the path the engine gets wrong.
  await page.evaluate(async ({ findSrc }) => {
    const findInputs = eval(findSrc);
    const scenes = window.__PK_SCENES__;
    const input = findInputs(scenes.login.root, [], scenes.login.settings.root)[0];
    if (input.focus) input.focus = false;
    await new Promise((r) => setTimeout(r, 180));
  }, { findSrc: FIND_INPUTS });
  await page.waitForTimeout(200);

  await page.mouse.click(caretGeom.x + caretGeom.w * frac, caretGeom.y + caretGeom.h / 2);
  await page.waitForTimeout(400);
  const sample = await page.evaluate(() => {
    const el = document.querySelector('input');
    if (el === null) return null;
    const style = getComputedStyle(el);
    // The overlay is positioned in window coordinates and then CSS-scaled by
    // the stage transform, so a span parked in `document.body` measures the
    // *untransformed* advance. Multiply by the element's own effective scale
    // (`rect.width / offsetWidth`) to get the on-screen caret position.
    const rect = el.getBoundingClientRect();
    const scale = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
    const span = document.createElement('span');
    span.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`;
    span.textContent = el.value.slice(0, el.selectionStart ?? 0);
    document.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return {
      selectionStart: el.selectionStart,
      caretVisualX: +(rect.x + width * scale).toFixed(1),
      scale: +scale.toFixed(3),
      boxX: +rect.x.toFixed(1),
    };
  });
  caretSamples.push({ frac, clickX: +(caretGeom.x + caretGeom.w * frac).toFixed(1), ...sample });
}
console.log('caret samples:', JSON.stringify(caretSamples));
await page.screenshot({ path: resolve(OUT, 'login-caret.png') });

// --- 9d. the upscaler slot -------------------------------------------------
// `software` is a real (spatial) pass; `fsr` and `dlss` are honest placeholders
// that must never apply anything. Choosing one must be *recorded* without
// silently running a different pass.
const upscale = await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inDom = () => document.querySelector('svg[data-pk-upscaler="1"]') !== null;

  const before = scenes.upscalers.debugState();

  scenes.settings.update({ display: { upscaler: 'software', upscalerSharpness: 0.5 } });
  await wait(140);
  const software = scenes.upscalers.debugState();
  const softwareInDom = inDom();

  scenes.settings.update({ display: { upscaler: 'dlss' } });
  await wait(140);
  const dlss = scenes.upscalers.debugState();
  const dlssInDom = inDom();

  scenes.settings.update({ display: { upscaler: 'fsr' } });
  await wait(140);
  const fsr = scenes.upscalers.debugState();

  scenes.settings.update({ display: { upscaler: 'off', upscalerSharpness: 0.4 } });
  await wait(140);
  const off = scenes.upscalers.debugState();

  return { before, software, softwareInDom, dlss, dlssInDom, fsr, off };
});
console.log('upscaler:', JSON.stringify(upscale));

// The Upscaling group sits below the fold on the Display tab, so the tab shot
// above never shows it: scroll the panel to the bottom for a reviewable frame.
// Opened through the gear, which is the path the player takes — and the one
// that ends the login field's DOM overlay before the modal appears.
await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.login.settings.hide();
  await new Promise((r) => setTimeout(r, 160));
  scenes.login.settingsButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 200));
  scenes.login.settings.selectTabByTitle('Display');
  await new Promise((r) => setTimeout(r, 160));
  scenes.login.settings.handleShortcut('settings.scrollBottom', {});
  await new Promise((r) => setTimeout(r, 160));
});
await page.screenshot({ path: resolve(OUT, 'login-settings-upscaling.png') });

// --- 9e. Enter submits ------------------------------------------------------
// With no field focused the dispatcher owns Enter; with a field focused the
// engine's own ENTER event does, so the dispatcher deliberately stands down to
// avoid a double submit.
//
// The assertion spies on the exact flow call `submit()` makes rather than
// reading the button label: the lobby is unreachable in this harness, so the
// round trip can fail inside the assertion window and the label would be racy.
const enterFocus = await page.evaluate(async ({ findSrc, clearSrc }) => {
  const findInputs = eval(findSrc);
  const clearFocus = eval(clearSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('login');
  // The upscaler shot above leaves the modal open, and an open modal owns the
  // keyboard — close it first so Enter reaches the form.
  scenes.login.settings.hide();
  await new Promise((r) => setTimeout(r, 250));
  const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
  inputs[0].text = 'bob';
  inputs[1].text = 'secret123';
  clearFocus(scenes.login.root);
  await new Promise((r) => setTimeout(r, 200));

  const original = scenes.flow.signInWithAccount.bind(scenes.flow);
  window.__pkEnter = {
    calls: [],
    restore: () => {
      scenes.flow.signInWithAccount = original;
    },
  };
  scenes.flow.signInWithAccount = (user, pass) => {
    window.__pkEnter.calls.push({ user, pass });
    return original(user, pass);
  };
  return scenes.login.debugState().focusedFieldIndex;
}, { findSrc: FIND_INPUTS, clearSrc: CLEAR_FOCUS });

await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const entered = await page.evaluate(() => {
  const scenes = window.__PK_SCENES__;
  const result = {
    lastAction: scenes.shortcuts.debugState().lastAction,
    calls: window.__pkEnter.calls,
  };
  window.__pkEnter.restore();
  return result;
});
console.log('enter:', JSON.stringify({ focus: enterFocus, lastAction: entered.lastAction, calls: entered.calls }));
await page.screenshot({ path: resolve(OUT, 'login-enter-submit.png') });

// --- 9f. the Keys tab screenshot + no stray overlay ------------------------
// A focused field's overlay is a DOM element in window space, so it paints
// above every canvas layer — including a modal opened on top of it. Opening
// from the gear must therefore blur first, leaving no stray DOM input behind.
const overlayLeak = await page.evaluate(async ({ findSrc }) => {
  const findInputs = eval(findSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('login');
  scenes.login.settings.hide();
  await new Promise((r) => setTimeout(r, 200));
  findInputs(scenes.login.root, [], scenes.login.settings.root)[0].focus = true;
  await new Promise((r) => setTimeout(r, 350));
  const focused = document.querySelectorAll('input, textarea').length;
  scenes.login.settingsButton.sprite.event(Laya.Event.CLICK);
  await new Promise((r) => setTimeout(r, 350));
  return {
    focused,
    afterOpen: document.querySelectorAll('input, textarea').length,
    open: scenes.login.settings.isOpen,
  };
}, { findSrc: FIND_INPUTS });
console.log('overlay leak:', JSON.stringify(overlayLeak));

await page.evaluate(async () => {
  const scenes = window.__PK_SCENES__;
  scenes.login.settings.show();
  scenes.login.settings.selectTabByTitle('Keys');
  await new Promise((r) => setTimeout(r, 220));
});
await page.screenshot({ path: resolve(OUT, 'login-settings-keys.png') });

// --- 9g. the open modal owns the keyboard ----------------------------------
// While the settings modal is up it is checked before the form, so a
// login-scoped key it does not handle must not reach the screen underneath.
// (This was found the hard way: leaving the modal open in 9e silently stopped
// the form from submitting.)
const owned = await page.evaluate(async ({ findSrc, clearSrc }) => {
  const findInputs = eval(findSrc);
  const clearFocus = eval(clearSrc);
  const scenes = window.__PK_SCENES__;
  scenes.switchTo('login');
  scenes.login.settings.show();
  await new Promise((r) => setTimeout(r, 250));
  const inputs = findInputs(scenes.login.root, [], scenes.login.settings.root);
  inputs[0].text = 'bob';
  inputs[1].text = 'secret123';
  clearFocus(scenes.login.root);
  await new Promise((r) => setTimeout(r, 200));

  const original = scenes.flow.signInWithAccount.bind(scenes.flow);
  window.__pkOwned = {
    calls: [],
    restore: () => {
      scenes.flow.signInWithAccount = original;
    },
  };
  scenes.flow.signInWithAccount = (user, pass) => {
    window.__pkOwned.calls.push({ user, pass });
    return original(user, pass);
  };
  return { open: scenes.login.settings.isOpen, focus: scenes.login.debugState().focusedFieldIndex };
}, { findSrc: FIND_INPUTS, clearSrc: CLEAR_FOCUS });

await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const ownedAfter = await page.evaluate(() => {
  const scenes = window.__PK_SCENES__;
  const result = {
    calls: window.__pkOwned.calls,
    open: scenes.login.settings.isOpen,
  };
  window.__pkOwned.restore();
  return result;
});
console.log('modal ownership:', JSON.stringify({ before: owned, after: ownedAfter }));

await browser.close();

// --- assertions ------------------------------------------------------------
const nonNegative = (rect) => rect.x >= 0 && rect.y >= 0 && rect.width >= 0 && rect.height >= 0;
const narrowOk =
  nonNegative(narrow.state.cardRect) &&
  nonNegative(narrow.state.portraitRect) &&
  nonNegative(narrow.state.backgroundRect);

// The halo must be a square inside the stage and centred on the portrait.
const haloInside = (state, stageW, stageH) =>
  state.haloRect.x >= 0 &&
  state.haloRect.x + state.haloRect.width <= stageW &&
  state.haloRect.y >= 0 &&
  state.haloRect.y + state.haloRect.height <= stageH;
const haloSquared = (state) => state.haloRect.width === state.haloRect.height && state.haloRect.width > 0;
const haloSymmetry = (state) =>
  Math.abs(state.haloRect.x + state.haloRect.width / 2 - (state.portraitRect.x + state.portraitRect.width / 2)) <= 1;

// The gear button is pinned to the top-right corner: flush with the screen
// margin on the right and sitting on the title band.
const settingsButtonTopRight = (state, stageW) =>
  state.settingsButtonRect.x + state.settingsButtonRect.width === stageW - 24 &&
  state.settingsButtonRect.y >= 0 &&
  state.settingsButtonRect.y < 60;
const settingsCardInside = (state, stageW, stageH) =>
  state.cardRect.x >= 0 &&
  state.cardRect.y >= 0 &&
  state.cardRect.x + state.cardRect.width <= stageW &&
  state.cardRect.y + state.cardRect.height <= stageH;

const checks = [
  ['login: backdrop texture loaded', login.state.backgroundLoaded === true],
  ['login: portrait texture loaded', login.state.portraitLoaded === true],
  ['login: sigil texture loaded (art delivered)', login.state.sigilLoaded === true, true],
  ['login: stacked on the 900x1200 web stage', login.state.stacked === true],
  ['login: mode is sign-in', login.state.authMode === 'login'],
  ['login: card shows "Sign in"', login.labels.includes('Sign in')],
  ['login: secondary shows "Create account"', login.labels.includes('Create account')],
  ['login: backdrop offset is centred (negative y)', login.state.backgroundOffset.y < 0],
  ['login: backdrop rect is non-negative', nonNegative(login.state.backgroundRect)],
  ['login: halo inside the 900x1200 stage', haloInside(login.state, 900, 1200)],
  ['login: halo is square and centred', haloSquared(login.state) && haloSymmetry(login.state)],
  ['login: title is the Chinese product name', login.state.titleText === '纷争幻想'],
  ['login: the white caption under the title is gone', !login.labels.includes('千夜追忆 · Boss Race')],
  ['login: no Latin wordmark left on the screen', !login.labels.some((t) => t.includes('Phantasm'))],
  ['login: settings button is in the top-right corner', settingsButtonTopRight(login.state, 900)],
  [
    'login: settings button is a 40px square',
    login.state.settingsButtonRect.width === 40 && login.state.settingsButtonRect.height === 40,
  ],
  ['login: settings modal starts closed', login.state.settings.open === false],
  ['settings: opens from the gear button', settings.state.open === true],
  ['settings: card is inside the 900x1200 stage', settingsCardInside(settings.state, 900, 1200)],
  ['settings: opens on the Language tab', settings.state.activeTab === 'Language'],
  [
    'settings: exposes the seven tabs in order',
    JSON.stringify(settings.state.tabs) ===
      JSON.stringify(['Language', 'Display', 'Keys', 'Audio', 'HUD', 'Other', 'About']),
  ],
  [
    'settings: the Display tab builds its rows',
    settings.displayLabels.includes('Resolution scale') &&
      settings.displayLabels.includes('Effects') &&
      settings.displayLabels.includes('Frame rate limit'),
  ],
  ['settings: every tab builds content', settings.tabs.every((t) => t.contentHeight > 0 && t.rows > 3)],
  // Subtitles used to be a single bilingual string (`中文 · English`). They are
  // now resolved through `t()`, so the contract is "every tab has one".
  ['settings: every tab has a subtitle', settings.tabs.every((t) => t.subtitle.length > 0)],
  ['settings: the HUD tab overflows and is scrollable', settings.tabs.find((t) => t.title === 'HUD').scrollable === true],
  ['settings: About tab lists both product names', settings.aboutLabels.includes('纷争幻想 · Phantasm Klash')],
  ['settings: About tab shows the version', settings.aboutLabels.includes('0.1.0')],
  ['settings: About tab shows the code licence', settings.aboutLabels.includes('MIT')],
  ['settings: About tab lists the credits', settings.aboutLabels.some((t) => t.includes('東方Project'))],
  [
    'settings: the repository button is disabled while unpublished',
    settings.aboutLabels.includes('Not published yet'),
  ],
  [
    'settings: card has a heading and a Close button',
    // The heading is read from the debug snapshot, not from the visible-text
    // walk: once the TNA `bar_config` plaque loads it *replaces* the text, so a
    // walk-based check would only pass until the art arrived.
    settings.state.labels.includes('Settings') && settings.labels.includes('Close'),
  ],
  [
    'settings: the open modal is visible in the scene tree',
    settings.state.open === true && settings.displayLabels.includes('Resolution scale'),
  ],
  ['settings: Close hides the modal again', settingsClosed.open === false && settingsClosed.rootVisible === false],
  ['display: the default frame cap is installed on the render loop', applied.beforeCap === 'function'],
  ['display: capping to 30 FPS installs a render predicate', applied.capped === 'function'],
  ['display: "uncapped" removes the render predicate', applied.uncapped === null],
  ['audio: the mute switch flips the engine mixer bus', applied.mutedBus === true && applied.unmutedBus === false],
  ['display: the frame-rate readout appears when enabled', applied.fps.length > 0],
  [
    'persistence: settings are written to localStorage',
    typeof persisted === 'string' &&
      persisted.includes('"bgmVolume":0.35') &&
      persisted.includes('"showOpponentHud":false'),
  ],
  ['register: mode flipped', register.state.authMode === 'register'],
  ['register: confirm field visible', register.state.confirmVisible === true],
  ['register: e-mail code field visible', register.state.codeVisible === true],
  ['login: confirm field hidden', login.state.confirmVisible === false],
  ['login: e-mail code field hidden', login.state.codeVisible === false],
  ['register: heading shows "Create account"', register.labels.includes('Create account')],
  ['register: primary shows "Sign up & play"', register.labels.includes('Sign up & play')],
  ['register: secondary shows "Back to sign in"', register.labels.includes('Back to sign in')],
  // The register form asks for exactly these five rows, in this order.
  [
    'register: form asks for username, e-mail, password, confirmation and code',
    JSON.stringify(sendCode.prompts) ===
      JSON.stringify(['Username', 'E-mail', 'Password', 'Confirm password', 'E-mail code']),
  ],
  ['register: the card shows a "Send code" button', sendCode.before.emailSendButtonText === 'Send code'],
  ['register: the send-code button is live before any request', sendCode.before.emailSendButtonEnabled === true],
  [
    'register: the send-code button sits inside the e-mail row, right of the input',
    sendCode.before.emailSendButtonRect.y === sendCode.emailRect.y &&
      sendCode.before.emailSendButtonRect.x >= sendCode.emailRect.x + sendCode.emailRect.width &&
      sendCode.before.emailSendButtonRect.x + sendCode.before.emailSendButtonRect.width ===
        sendCode.before.cardRect.width - 20,
  ],
  ['register: clicking it asks the flow for a code for the typed address', JSON.stringify(sendCode.calls) === JSON.stringify(['wjcwqc@example.com'])],
  ['register: the button turns into a countdown', /^Resend \d+s$/.test(sendCode.after.emailSendButtonText)],
  ['register: the countdown starts from the server window', sendCode.after.codeResendSeconds > 0 && sendCode.after.codeResendSeconds <= 60],
  ['register: the button is disabled while counting down', sendCode.after.emailSendButtonEnabled === false],
  // The login card carries only the primary + secondary buttons now; returning
  // to the lobby is the keyboard-only `login.back` binding (Shift+Escape).
  ['register: no "Back to lobby" button on the card', !register.labels.includes('Back to lobby')],
  ['wide: stage really is 1333x750', wide.stage.width === 1333 && wide.stage.height === 750],
  ['wide: not stacked', wide.state.stacked === false],
  ['wide: card inside the stage', wide.state.cardRect.x >= 0 && wide.state.cardRect.x + wide.state.cardRect.width <= 1333],
  ['wide: portrait inside the stage', wide.state.portraitRect.x + wide.state.portraitRect.width <= 1333],
  ['wide: portrait aspect preserved', Math.abs(wide.state.portraitRect.width / wide.state.portraitRect.height - 190 / 279) < 0.02],
  ['wide: backdrop + portrait loaded', wide.state.backgroundLoaded === true && wide.state.portraitLoaded === true],
  ['wide: halo fully inside the stage (not clipped)', haloInside(wide.state, 1333, 750)],
  ['wide: halo is square and centred', haloSquared(wide.state) && haloSymmetry(wide.state)],
  ['wide: halo clamped to 333 (was 628, would clip)', wide.state.haloRect.width === 333],
  ['wide: settings button is in the top-right corner', settingsButtonTopRight(wide.state, 1333)],
  ['wide: title is still the Chinese product name', wide.state.titleText === '纷争幻想'],
  ['ultra: stage really is 1920x750', ultra.stage.width === 1920 && ultra.stage.height === 750],
  ['ultra: halo fully inside the stage (not clipped)', haloInside(ultra.state, 1920, 750)],
  ['ultra: halo is square and centred', haloSquared(ultra.state) && haloSymmetry(ultra.state)],
  ['typing: two editable inputs exist in sign-in mode', typed.count === 2],
  ['typing: password field is masked', typed.passwordType === 'password'],
  ['typing: typed text reaches the field', typed.first === 'bob'],
  ['busy: primary button was found and clicked', busy.clicked === true],
  ['busy: label was "Sign in" before the click', busy.before.includes('Sign in')],
  ['busy: primary label becomes "Signing in…"', busy.after.includes('Signing in…')],
  ['endpoint: shows "Lobby: <endpoint>" when disconnected', endpoint.labels.some((t) => t === 'Lobby: https://fake-lobby.invalid')],
  ['narrow: stage really is 480x1280', narrow.stage.width === 480 && narrow.stage.height === 1280],
  ['narrow: no negative geometry', narrowOk],
  ['narrow: settings card fits the 480x1280 stage', settingsCardInside(narrowSettings, 480, 1280)],
  ['narrow: settings card is clamped to the narrow stage', narrowSettings.cardRect.width < 560],
  ['narrow: settings still exposes every tab', narrowSettings.tabs.length === 7],
  ['ultra: settings card fits the 1920x750 stage', settingsCardInside(ultraSettings, 1920, 750)],
  ['ultra: settings card keeps its max width', ultraSettings.cardRect.width === 560],
  ['fallback: sigil missing leaves the ellipse', fallback.sigilLoaded === false],
  ['fallback: backdrop + portrait still load', fallback.backgroundLoaded === true && fallback.portraitLoaded === true],
  ['fallback: no page error when the art is missing', fallbackErrors.length === 0],

  // --- shortcut wiring ------------------------------------------------------
  ['shortcuts: the dispatcher is attached to the stage', keys.dispatcher.attached === true],
  ['shortcuts: the login screen owns the scope', keys.dispatcher.scope === 'login'],
  ['shortcuts: no field is focused and both are live', keys.focus === -1 && keys.fields === 2],
  ['shortcuts: Tab moves focus from the username to the password field', focusStart === 0 && focusTab === 1],
  ['shortcuts: Shift+Tab moves focus back to the username', focusShiftTab === 0],
  ['shortcuts: Tab wraps around the two-field form', focusWrapped === 0],
  ['shortcuts: Tab is routed to the login.focusNext action', afterTabs.lastAction === 'login.focusNext'],
  ['shortcuts: Escape leaves the field before it leaves the screen', focusAfterEscape === -1],
  ['fullscreen: the runtime exposes a fullscreen API', fsBefore.supported === true],
  ['fullscreen: Alt+Enter is routed to the fullscreen action', fsAfter.lastAction === 'app.fullscreen'],
  [
    'fullscreen: Alt+Enter really enters fullscreen',
    fsAfter.state.fullscreen === true && fsAfter.element === true,
    true,
  ],

  // --- caret placement ------------------------------------------------------
  [
    'caret: the click index is read back from the live overlay',
    caretSamples.length === 3 && caretSamples.every((s) => s !== null && typeof s.selectionStart === 'number'),
  ],
  [
    'caret: clicking further right lands further right',
    caretSamples[0].selectionStart < caretSamples[1].selectionStart &&
      caretSamples[1].selectionStart < caretSamples[2].selectionStart,
  ],
  [
    'caret: the three clicks produce three distinct indices',
    new Set(caretSamples.map((s) => s.selectionStart)).size === 3 &&
      caretSamples.every((s) => s.selectionStart < 36),
  ],
  [
    'caret: the caret lands within 12px of the click',
    caretSamples.every((s) => Math.abs(s.caretVisualX - s.clickX) <= 12),
  ],

  // --- upscaler slot --------------------------------------------------------
  ['upscaler: defaults to Off with no pass applied', upscale.before.backend === 'off' && upscale.before.sharpenApplied === false],
  [
    'upscaler: Software is available and applies a real pass',
    upscale.software.backend === 'software' &&
      upscale.software.available === true &&
      upscale.software.sharpenApplied === true,
  ],
  ['upscaler: the Software pass honours the sharpness value', upscale.software.sharpenStrength === 0.5],
  [
    'upscaler: the sharpen filter definition reaches the DOM',
    upscale.software.filterElementPresent === true && upscale.softwareInDom === true,
  ],
  [
    'upscaler: DLSS is recorded as chosen but stays unavailable',
    upscale.dlss.backend === 'dlss' && upscale.dlss.available === false,
  ],
  ['upscaler: the DLSS placeholder applies no pass', upscale.dlss.sharpenApplied === false && upscale.dlssInDom === false],
  [
    'upscaler: FSR is likewise an honest placeholder',
    upscale.fsr.backend === 'fsr' && upscale.fsr.available === false && upscale.fsr.sharpenApplied === false,
  ],
  [
    'upscaler: returning to Off clears the pass and the filter',
    upscale.off.backend === 'off' && upscale.off.sharpenApplied === false && upscale.off.filterElementPresent === false,
  ],

  // --- Enter submits --------------------------------------------------------
  ['enter: Enter is routed to login.submit when no field is focused', enterFocus === -1 && entered.lastAction === 'login.submit'],
  [
    'enter: Enter really submits with the typed credentials',
    entered.calls.length === 1 && entered.calls[0].user === 'bob' && entered.calls[0].pass === 'secret123',
  ],

  // --- Keys tab -------------------------------------------------------------
  [
    'settings: the Keys tab is generated from the binding table',
    settings.keysLabels.includes('Tab') &&
      settings.keysLabels.includes('Shift+Tab') &&
      settings.keysLabels.includes('Alt+Enter / F11'),
  ],
  ['settings: the Keys tab groups the bindings by scope', settings.keysLabels.includes('Global') && settings.keysLabels.includes('Login')],

  // --- modal keyboard ownership --------------------------------------------
  ['modal: the open settings modal owns the keyboard', owned.open === true && owned.focus === -1],
  ['modal: a login key does not reach the form behind the modal', ownedAfter.calls.length === 0],
  ['modal: Escape closes the modal', ownedAfter.open === false],

  // --- no stray DOM overlay over the modal ---------------------------------
  ['overlay: focusing a field creates exactly one DOM overlay', overlayLeak.focused === 1],
  [
    'overlay: opening the modal ends the field overlay',
    overlayLeak.open === true && overlayLeak.afterOpen === 0,
  ],
];

console.log('');
let failed = 0;
let skipped = 0;
for (const [name, ok, optional] of checks) {
  if (!ok && optional) {
    console.log(`SKIP  ${name}`);
    skipped += 1;
    continue;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\nlogin shots: ${checks.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
console.log(
  'saved',
  resolve(OUT, 'login-signin.png'),
  resolve(OUT, 'login-settings.png'),
  resolve(OUT, 'login-settings-about.png'),
  resolve(OUT, 'login-register.png'),
  resolve(OUT, 'login-wide.png'),
  resolve(OUT, 'login-ultrawide.png'),
  resolve(OUT, 'login-endpoint.png'),
  resolve(OUT, 'login-narrow.png'),
);
process.exit(failed === 0 ? 0 : 1);
