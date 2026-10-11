/**
 * Shortcut model tests.
 *
 * The table (`DEFAULT_BINDINGS`) is the single source of truth for the
 * dispatcher, the settings panel and these tests, so the assertions pin the
 * behaviours a screen actually depends on:
 *  - a modifier chord must match *exactly*, so `Alt+Enter` never collapses into
 *    a bare `Enter`;
 *  - a scoped key must not fire outside its screen, while `global` keys fire
 *    everywhere;
 *  - a text field must suppress every binding that did not opt in.
 */

import {
  DEFAULT_BINDINGS,
  SHORTCUT_SCOPES,
  chordMatches,
  describeChord,
  isModifierOnly,
  listShortcuts,
  normalizeKey,
  resolveShortcut,
  stepFocus,
} from '../src/core/input/shortcuts';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

suite('shortcuts: normalizeKey');

test('key names are lowercased and alias-resolved', () => {
  expectEqual(normalizeKey('Tab'), 'tab');
  expectEqual(normalizeKey('Escape'), 'escape');
  expectEqual(normalizeKey(' '), 'space', 'the literal space key is aliased');
  expectEqual(normalizeKey('Esc'), 'escape', 'the legacy escape alias resolves');
  expectEqual(normalizeKey('ArrowUp'), 'arrowup');
  expectEqual(normalizeKey('A'), 'a');
  expectEqual(normalizeKey('NumpadEnter'), 'numpadenter', 'numpad keys are not aliased away');
});

test('keyCode is the fallback when key is absent', () => {
  expectEqual(normalizeKey(undefined, 13), 'enter');
  expectEqual(normalizeKey(undefined, 9), 'tab');
  expectEqual(normalizeKey(undefined, 27), 'escape');
  expectEqual(normalizeKey(undefined, 37), 'arrowleft');
  expectEqual(normalizeKey(undefined, 112), 'f1');
  expectEqual(normalizeKey(undefined, 9999), '', 'an unknown keyCode yields no name');
});

// LayaNative's DOM emulation spells `key` as `String.fromCharCode(keyCode)`
// (see `scripts/apploader.js`), so these are the spellings a real `.exe`
// delivers. Trusting them over `keyCode` is what used to kill every shortcut.
test('a control-character key defers to keyCode (LayaNative spelling)', () => {
  expectEqual(normalizeKey(String.fromCharCode(9), 9), 'tab');
  expectEqual(normalizeKey(String.fromCharCode(13), 13), 'enter');
  expectEqual(normalizeKey(String.fromCharCode(27), 27), 'escape');
  expectEqual(normalizeKey(String.fromCharCode(8), 8), 'backspace');
  expectEqual(normalizeKey(String.fromCharCode(32), 32), 'space');
});

test('a bare symbol key defers to keyCode (LayaNative spelling)', () => {
  expectEqual(normalizeKey('%', 37), 'arrowleft');
  expectEqual(normalizeKey('&', 38), 'arrowup');
  expectEqual(normalizeKey('(', 40), 'arrowdown');
  expectEqual(normalizeKey('!', 33), 'pageup');
  expectEqual(normalizeKey('#', 35), 'end');
  expectEqual(normalizeKey('$', 36), 'home');
  expectEqual(normalizeKey('p', 112), 'f1', 'F1 arrives as "p" on native');
});

test('letters and digits stay authoritative over keyCode', () => {
  expectEqual(normalizeKey('p', 80), 'p', 'a letter is never overridden by its keyCode');
  expectEqual(normalizeKey('a', 65), 'a');
  expectEqual(normalizeKey('7', 55), '7');
});

suite('shortcuts: chord matching');

test('chordMatches requires an exact modifier match', () => {
  expect(!chordMatches({ key: 'enter', alt: true }, { key: 'Enter' }), 'a missing Alt must not match');
  expect(
    !chordMatches({ key: 'enter', alt: true }, { key: 'Enter', altKey: true, shiftKey: true }),
    'an extra Shift must not match',
  );
});

test('Alt+Enter beats a bare Enter', () => {
  expectEqual(resolveShortcut({ key: 'Enter', altKey: true }, 'login'), 'app.fullscreen');
  expectEqual(resolveShortcut({ key: 'Enter' }, 'login'), 'login.submit');
});

test('Shift+Tab beats Tab', () => {
  expectEqual(resolveShortcut({ key: 'Tab', shiftKey: true }, 'login'), 'login.focusPrev');
  expectEqual(resolveShortcut({ key: 'Tab' }, 'login'), 'login.focusNext');
});

test('a native-spelled key resolves exactly like its DOM spelling', () => {
  // `[key as LayaNative spells it, keyCode, key as a browser spells it]`.
  const spellings: ReadonlyArray<readonly [string, number, string]> = [
    [String.fromCharCode(9), 9, 'Tab'],
    [String.fromCharCode(13), 13, 'Enter'],
    [String.fromCharCode(27), 27, 'Escape'],
    ['%', 37, 'ArrowLeft'],
    ['&', 38, 'ArrowUp'],
    ['p', 112, 'F1'],
  ];
  for (const [nativeKey, keyCode, domKey] of spellings) {
    for (const scope of SHORTCUT_SCOPES) {
      expectEqual(
        resolveShortcut({ key: nativeKey, keyCode }, scope),
        resolveShortcut({ key: domKey }, scope),
        `${domKey} must resolve the same however the runtime spells it (scope '${scope}')`,
      );
    }
  }
});

test('Alt+Enter is still reachable when the runtime spells Enter as "\\r"', () => {
  const nativeAltEnter = { key: String.fromCharCode(13), keyCode: 13, altKey: true };
  expectEqual(resolveShortcut(nativeAltEnter, 'login'), 'app.fullscreen');
  expectEqual(resolveShortcut(nativeAltEnter, 'lobby'), 'app.fullscreen');
  expectEqual(resolveShortcut(nativeAltEnter, 'battle'), 'app.fullscreen');
});

suite('shortcuts: text-input policy');

test('only opt-in bindings fire while a text field owns the keyboard', () => {
  // Letters are never allowInTextInput, so typing must not trigger them.
  expectEqual(resolveShortcut({ key: 'a' }, 'lobby', { inTextInput: true }), null);
  expectEqual(resolveShortcut({ key: 'p' }, 'lobby', { inTextInput: true }), null);
  // …but the same key is live outside a text field.
  expectEqual(resolveShortcut({ key: 'p' }, 'lobby'), 'lobby.playPage');

  // Tab and Escape opted in, so they survive the text-input policy.
  expectEqual(resolveShortcut({ key: 'Tab' }, 'login', { inTextInput: true }), 'login.focusNext');
  expectEqual(resolveShortcut({ key: 'Escape' }, 'login', { inTextInput: true }), 'app.settingsClose');
});

suite('shortcuts: scope isolation');

test('a scoped binding does not fire in another scope', () => {
  expectEqual(resolveShortcut({ key: 'p' }, 'battle'), null, 'lobby.playPage must not leak into battle');
  expectEqual(resolveShortcut({ key: 'Tab' }, 'battle'), null, 'login.focusNext must not leak into battle');
});

test('a global binding resolves in every scope', () => {
  for (const scope of SHORTCUT_SCOPES) {
    expectEqual(resolveShortcut({ key: 'F11' }, scope), 'app.fullscreen', `F11 must work in '${scope}'`);
  }
});

suite('shortcuts: modifiers and labels');

test('isModifierOnly flags bare modifier presses only', () => {
  for (const key of ['Shift', 'Control', 'Alt', 'Meta']) {
    expect(isModifierOnly({ key }), `${key} must be modifier-only`);
  }
  expect(!isModifierOnly({ key: 'Enter' }), 'Enter is a real key');
});

test('describeChord renders modifiers in a stable order', () => {
  expectEqual(describeChord({ key: 'enter', alt: true }), 'Alt+Enter');
  expectEqual(describeChord({ key: 'tab', shift: true }), 'Shift+Tab');
  expectEqual(describeChord({ key: 'tab', ctrl: true, shift: true }), 'Ctrl+Shift+Tab');
  expectEqual(describeChord({ key: 'arrowup' }), '↑');
  expectEqual(describeChord({ key: 'f11' }), 'F11');
});

suite('shortcuts: focus order');

test('stepFocus wraps, skips disabled slots and handles empty lists', () => {
  const slots = ['a', 'b', 'c'];
  expectEqual(stepFocus(slots, 2, 1), 0, 'forward wraps past the end');
  expectEqual(stepFocus(slots, 0, -1), 2, 'backward wraps past the start');
  expectEqual(stepFocus(slots, -1, 1), 0, 'from -1 the first hop lands on 0');
  expectEqual(
    stepFocus(slots, 0, 1, (slot) => slot !== 'b'),
    2,
    'a disabled slot is skipped',
  );
  expectEqual(stepFocus([], 0, 1), -1, 'an empty list has no target');
});

suite('shortcuts: table sanity');

test('listShortcuts has one entry per action, all labelled', () => {
  const listing = listShortcuts();
  const actions = listing.map((entry) => entry.action);
  expectEqual(new Set(actions).size, actions.length, 'actions must be unique');
  for (const entry of listing) {
    expect(entry.label.length > 0, `${entry.action} needs a label`);
    expect(entry.chords.length > 0, `${entry.action} needs at least one chord`);
  }
});

test('every default binding is well-formed', () => {
  for (const binding of DEFAULT_BINDINGS) {
    expect(binding.chord.key.length > 0, `${binding.action} has an empty key`);
    expect(binding.label.length > 0, `${binding.action} has an empty label`);
  }
  const fullscreen = DEFAULT_BINDINGS.filter((binding) => binding.action === 'app.fullscreen');
  expect(fullscreen.length >= 2, 'fullscreen needs at least two chords');
  expectDeepEqual(
    fullscreen.map((binding) => describeChord(binding.chord)).sort(),
    ['Alt+Enter', 'F11'],
  );
});
