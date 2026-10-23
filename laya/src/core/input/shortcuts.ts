/**
 * Keyboard shortcut model — engine-agnostic.
 *
 * One table (`DEFAULT_BINDINGS`) is the single source of truth: the dispatcher
 * matches against it, the settings panel prints it, and the tests assert on it.
 * Adding a shortcut is a one-line change here plus a handler in the screen that
 * owns the action's scope.
 *
 * ## Scopes
 *
 * A binding is either `global` (always live: fullscreen, settings overlay) or
 * scoped to one screen. The dispatcher is given the *active* scope plus the
 * `global` bindings, so a login-only key can never fire inside a battle.
 *
 * ## Text fields
 *
 * While a text field has focus the browser/engine owns almost every key, so a
 * binding only fires then if it sets `allowInTextInput`. `Tab`, `Enter`,
 * `Escape` and `Alt+Enter` do; letter keys never do, which is what stops `S`
 * from opening settings while the player is typing a password.
 *
 * NOTE: `core/` only — no DOM, no LayaAir, no Node.
 */

// --- scopes -----------------------------------------------------------------

/** Screens that can own shortcuts. `global` is always live. */
export const SHORTCUT_SCOPES = [
  'global',
  'login',
  'lobby',
  'room',
  'battle',
  'result',
  'checkin',
  'shop',
  'gacha',
  'inventory',
  'records',
  'settings',
] as const;
export type ShortcutScope = (typeof SHORTCUT_SCOPES)[number];

// --- actions ----------------------------------------------------------------

/**
 * Every shortcut the client understands. The string values are stable ids —
 * screens switch on them, so renaming one is a breaking change.
 */
export const SHORTCUT_ACTIONS = [
  // global
  'app.fullscreen',
  'app.settings',
  'app.settingsClose',
  'app.quitHint',
  // login
  'login.focusNext',
  'login.focusPrev',
  'login.submit',
  'login.toggleMode',
  'login.sendCode',
  'login.back',
  // lobby
  'lobby.menuNext',
  'lobby.menuPrev',
  'lobby.activate',
  'lobby.back',
  'lobby.playPage',
  // room
  'room.ready',
  'room.leave',
  // battle
  'battle.pause',
  'battle.back',
  'battle.toggleHud',
  // generic list/overlay navigation, reused by check-in / shop / inventory / result
  'ui.next',
  'ui.prev',
  'ui.activate',
  'ui.back',
  // settings overlay
  'settings.tabNext',
  'settings.tabPrev',
  'settings.scrollUp',
  'settings.scrollDown',
  'settings.scrollTop',
  'settings.scrollBottom',
  'settings.reset',
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

// --- chords -----------------------------------------------------------------

/** A key plus the modifier state it requires. */
export interface KeyChord {
  /** Normalised key name: `'tab'`, `'enter'`, `'escape'`, `'arrowup'`, `'a'`, `'f11'`. */
  readonly key: string;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly meta?: boolean;
}

/**
 * The subset of a keyboard event the matcher needs. Both the LayaAir event and
 * a plain DOM event satisfy this, which is what lets the matcher be unit-tested
 * with object literals.
 */
export interface KeyEventLike {
  /** `KeyboardEvent.key` — `'Tab'`, `'Enter'`, `'ArrowUp'`, `'a'`, `'A'`. */
  readonly key?: string;
  /** `KeyboardEvent.keyCode` — the engine exposes this too; used as a fallback. */
  readonly keyCode?: number;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
}

/** `keyCode` → normalised name, for events that carry no usable `key`. */
const KEY_CODE_NAMES: Readonly<Record<number, string>> = {
  8: 'backspace',
  9: 'tab',
  13: 'enter',
  16: 'shift',
  17: 'control',
  18: 'alt',
  19: 'pause',
  27: 'escape',
  32: 'space',
  33: 'pageup',
  34: 'pagedown',
  35: 'end',
  36: 'home',
  37: 'arrowleft',
  38: 'arrowup',
  39: 'arrowright',
  40: 'arrowdown',
  45: 'insert',
  46: 'delete',
  96: 'numpad0',
  106: 'numpadmultiply',
  107: 'numpadadd',
  109: 'numpadsubtract',
  110: 'numpaddecimal',
  111: 'numpaddivide',
  112: 'f1',
  113: 'f2',
  114: 'f3',
  115: 'f4',
  116: 'f5',
  117: 'f6',
  118: 'f7',
  119: 'f8',
  120: 'f9',
  121: 'f10',
  122: 'f11',
  123: 'f12',
  186: ';',
  187: '=',
  188: ',',
  189: '-',
  190: '.',
  191: '/',
  192: '`',
  219: '[',
  220: '\\',
  221: ']',
  222: "'",
};

/** NumpadEnter reports `key === 'Enter'` but `keyCode === 13`; both are 'enter'. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  ' ': 'space',
  spacebar: 'space',
  add: 'numpadadd',
  subtract: 'numpadsubtract',
  multiply: 'numpadmultiply',
  divide: 'numpaddivide',
  decimal: 'numpaddecimal',
  del: 'delete',
  apps: 'contextmenu',
};

/**
 * Names whose `keyCode` outranks `key`.
 *
 * These keys have no printable identity of their own, so a runtime that spells
 * `key` as `String.fromCharCode(keyCode)` — LayaNative's DOM emulation does
 * exactly that — produces a meaningless character for every one of them:
 * `'\t'` for Tab, `'%'` for ArrowLeft, `'p'` for F1. Everything *not* listed
 * here (letters, digits, punctuation, `space`) keeps `key`, so a keyboard
 * layout that moves a character still resolves to what the player pressed.
 */
const KEY_CODE_AUTHORITATIVE_NAMES: ReadonlySet<string> = new Set([
  'backspace',
  'tab',
  'enter',
  'shift',
  'control',
  'alt',
  'pause',
  'escape',
  'pageup',
  'pagedown',
  'end',
  'home',
  'arrowleft',
  'arrowup',
  'arrowright',
  'arrowdown',
  'insert',
  'delete',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
]);

/**
 * Normalises a raw `key` string into the form used by `KeyChord.key`, falling
 * back to `keyCode` whenever `key` cannot be trusted.
 *
 * MEASURED BUG (LayaNative `.exe`): the runtime ships its own DOM emulation
 * (`scripts/apploader.js`) whose keyboard bridge is
 *
 *     ke.key = String.fromCharCode(keycode)
 *
 * so a non-printable key arrives spelled as a *character* rather than a name —
 * `Tab` as `'\t'`, `Enter` as `'\r'`, `Escape` as `'\x1b'`, `Backspace` as
 * `'\b'` — and a key whose `keyCode` happens to be a printable code point
 * arrives as that character: `ArrowLeft` as `'%'` (37), `ArrowUp` as `'&'`
 * (38), `End` as `'#'` (35), `F1` as `'p'` (112).
 *
 * Trusting that string is what made **every** shortcut dead in the native build
 * while the web build kept working: `'\t'` normalised to `'\t'` and never
 * matched `{key:'tab'}`, so `Tab` never stepped the login form and `Alt+Enter`
 * never reached the fullscreen binding. The rules are therefore:
 *
 *  1. the aliases below always win;
 *  2. a `keyCode` naming a {@link KEY_CODE_AUTHORITATIVE_NAMES} key always wins
 *     (`Tab`, `Enter`, arrows, `F1`–`F12`, …);
 *  3. otherwise `key` wins, but only when it is a plausible name — a
 *     multi-character spelling, or a single alphanumeric character. A lone
 *     control character or bare symbol is rejected and `keyCode` decides.
 */
export function normalizeKey(raw: string | undefined, keyCode?: number): string {
  const named = trustedKeyName(raw, keyCode);
  if (named !== null) {
    return named;
  }
  if (keyCode !== undefined && KEY_CODE_NAMES[keyCode] !== undefined) {
    return KEY_CODE_NAMES[keyCode];
  }
  return '';
}

/**
 * The normalised name for a `key`/`keyCode` pair, or `null` when neither is
 * authoritative enough. See {@link normalizeKey}.
 */
function trustedKeyName(raw: string | undefined, keyCode: number | undefined): string | null {
  const byCode = keyCode !== undefined ? KEY_CODE_NAMES[keyCode] : undefined;
  // Rule 2: a non-printable key is named correctly only by its keyCode.
  if (byCode !== undefined && KEY_CODE_AUTHORITATIVE_NAMES.has(byCode)) {
    return byCode;
  }
  if (raw === undefined || raw === '' || raw === 'Unidentified') {
    return null;
  }
  const lowered = raw.toLowerCase();
  const alias = KEY_ALIASES[lowered];
  if (alias !== undefined) {
    // `' '` is the one single character worth trusting: it is aliased to
    // `space`, which is what `keyCode 32` would say anyway.
    return alias;
  }
  // Rule 3: a lone control character or symbol is ambiguous, so let keyCode
  // decide; a multi-character name or an alphanumeric stands on its own.
  if (lowered.length === 1 && !isAsciiAlphanumeric(lowered.charCodeAt(0))) {
    return null;
  }
  return lowered;
}

/** `true` for `0-9`, `a-z` and `A-Z` (the caller has already lowercased). */
function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || (code >= 0x61 && code <= 0x7a);
}

/** Normalises a whole event into `{key, ...modifiers}`. */
export function normalizeEvent(event: KeyEventLike): KeyChord {
  const chord: KeyChord = {
    key: normalizeKey(event.key, event.keyCode),
    alt: event.altKey === true,
    ctrl: event.ctrlKey === true,
    shift: event.shiftKey === true,
    meta: event.metaKey === true,
  };
  return chord;
}

/** True when the chord's modifier requirements are exactly met. */
export function chordMatches(chord: KeyChord, event: KeyEventLike): boolean {
  const actual = normalizeEvent(event);
  if (chord.key !== actual.key) {
    return false;
  }
  return (
    (chord.alt === true) === actual.alt &&
    (chord.ctrl === true) === actual.ctrl &&
    (chord.shift === true) === actual.shift &&
    (chord.meta === true) === actual.meta
  );
}

/** `{key:'enter', alt:true}` → `'Alt+Enter'`. Used by the settings panel. */
export function describeChord(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl === true) {
    parts.push('Ctrl');
  }
  if (chord.alt === true) {
    parts.push('Alt');
  }
  if (chord.shift === true) {
    parts.push('Shift');
  }
  if (chord.meta === true) {
    parts.push('Meta');
  }
  parts.push(describeKey(chord.key));
  return parts.join('+');
}

/** Human label for a normalised key name. */
export function describeKey(key: string): string {
  switch (key) {
    case 'arrowup':
      return '↑';
    case 'arrowdown':
      return '↓';
    case 'arrowleft':
      return '←';
    case 'arrowright':
      return '→';
    case 'pageup':
      return 'PageUp';
    case 'pagedown':
      return 'PageDown';
    case 'space':
      return 'Space';
    default:
      if (key.startsWith('numpad')) {
        return `Num ${key.slice(6).toUpperCase()}`;
      }
      return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  }
}

// --- bindings ---------------------------------------------------------------

export interface ShortcutBinding {
  readonly action: ShortcutAction;
  readonly scope: ShortcutScope;
  readonly chord: KeyChord;
  /** Shown in the settings panel; keep it short and imperative. */
  readonly label: string;
  /** Fire even while a text field owns the keyboard. */
  readonly allowInTextInput?: boolean;
}

/**
 * The default table.
 *
 * Order inside the array does not matter: `resolveShortcut` ranks candidates by
 * modifier count, so `Alt+Enter` always beats a bare `Enter`.
 */
export const DEFAULT_BINDINGS: readonly ShortcutBinding[] = [
  // --- global ---------------------------------------------------------------
  { action: 'app.fullscreen', scope: 'global', chord: { key: 'enter', alt: true }, label: 'shortcuts.app.fullscreen', allowInTextInput: true },
  { action: 'app.fullscreen', scope: 'global', chord: { key: 'f11' }, label: 'shortcuts.app.fullscreen' },
  { action: 'app.settings', scope: 'global', chord: { key: ',', ctrl: true }, label: 'shortcuts.app.settings' },
  { action: 'app.settings', scope: 'global', chord: { key: 'f1' }, label: 'shortcuts.app.settings' },
  { action: 'app.settingsClose', scope: 'global', chord: { key: 'escape' }, label: 'shortcuts.app.settingsClose', allowInTextInput: true },

  // --- login ----------------------------------------------------------------
  { action: 'login.focusNext', scope: 'login', chord: { key: 'tab' }, label: 'shortcuts.login.focusNext', allowInTextInput: true },
  { action: 'login.focusPrev', scope: 'login', chord: { key: 'tab', shift: true }, label: 'shortcuts.login.focusPrev', allowInTextInput: true },
  { action: 'login.submit', scope: 'login', chord: { key: 'enter' }, label: 'shortcuts.login.submit', allowInTextInput: true },
  { action: 'login.toggleMode', scope: 'login', chord: { key: 'enter', ctrl: true }, label: 'shortcuts.login.toggleMode', allowInTextInput: true },
  { action: 'login.sendCode', scope: 'login', chord: { key: 'e', ctrl: true }, label: 'shortcuts.login.sendCode', allowInTextInput: true },
  { action: 'login.back', scope: 'login', chord: { key: 'escape', shift: true }, label: 'shortcuts.login.back', allowInTextInput: true },

  // --- lobby ----------------------------------------------------------------
  { action: 'lobby.menuNext', scope: 'lobby', chord: { key: 'arrowdown' }, label: 'shortcuts.lobby.menuNext' },
  { action: 'lobby.menuNext', scope: 'lobby', chord: { key: 'tab' }, label: 'shortcuts.lobby.menuNext' },
  { action: 'lobby.menuPrev', scope: 'lobby', chord: { key: 'arrowup' }, label: 'shortcuts.lobby.menuPrev' },
  { action: 'lobby.menuPrev', scope: 'lobby', chord: { key: 'tab', shift: true }, label: 'shortcuts.lobby.menuPrev' },
  { action: 'lobby.activate', scope: 'lobby', chord: { key: 'enter' }, label: 'shortcuts.lobby.activate' },
  { action: 'lobby.activate', scope: 'lobby', chord: { key: 'space' }, label: 'shortcuts.lobby.activate' },
  { action: 'lobby.playPage', scope: 'lobby', chord: { key: 'p' }, label: 'shortcuts.lobby.playPage' },
  { action: 'lobby.back', scope: 'lobby', chord: { key: 'escape' }, label: 'shortcuts.login.back' },

  // --- room -----------------------------------------------------------------
  { action: 'room.ready', scope: 'room', chord: { key: 'enter' }, label: 'shortcuts.room.ready' },
  { action: 'room.leave', scope: 'room', chord: { key: 'escape' }, label: 'shortcuts.room.leave' },

  // --- battle ---------------------------------------------------------------
  { action: 'battle.pause', scope: 'battle', chord: { key: 'escape' }, label: 'shortcuts.battle.pause' },
  { action: 'battle.toggleHud', scope: 'battle', chord: { key: 'h' }, label: 'shortcuts.battle.toggleHud' },
  { action: 'battle.back', scope: 'battle', chord: { key: 'q' }, label: 'shortcuts.battle.forfeit' },

  // --- generic list screens -------------------------------------------------
  { action: 'ui.next', scope: 'checkin', chord: { key: 'arrowdown' }, label: 'shortcuts.ui.next' },
  { action: 'ui.prev', scope: 'checkin', chord: { key: 'arrowup' }, label: 'shortcuts.ui.prev' },
  { action: 'ui.activate', scope: 'checkin', chord: { key: 'enter' }, label: 'shortcuts.ui.confirm' },
  { action: 'ui.back', scope: 'checkin', chord: { key: 'escape' }, label: 'shortcuts.ui.back' },
  { action: 'ui.next', scope: 'shop', chord: { key: 'arrowdown' }, label: 'shortcuts.ui.next' },
  { action: 'ui.prev', scope: 'shop', chord: { key: 'arrowup' }, label: 'shortcuts.ui.prev' },
  { action: 'ui.activate', scope: 'shop', chord: { key: 'enter' }, label: 'shortcuts.shop.buy' },
  { action: 'ui.back', scope: 'shop', chord: { key: 'escape' }, label: 'shortcuts.ui.back' },
  { action: 'ui.next', scope: 'gacha', chord: { key: 'arrowdown' }, label: 'shortcuts.gacha.nextPool' },
  { action: 'ui.prev', scope: 'gacha', chord: { key: 'arrowup' }, label: 'shortcuts.gacha.prevPool' },
  { action: 'ui.activate', scope: 'gacha', chord: { key: 'enter' }, label: 'shortcuts.gacha.pullOne' },
  { action: 'ui.back', scope: 'gacha', chord: { key: 'escape' }, label: 'shortcuts.ui.back' },
  { action: 'ui.next', scope: 'inventory', chord: { key: 'arrowdown' }, label: 'shortcuts.ui.next' },
  { action: 'ui.prev', scope: 'inventory', chord: { key: 'arrowup' }, label: 'shortcuts.ui.prev' },
  { action: 'ui.activate', scope: 'inventory', chord: { key: 'enter' }, label: 'shortcuts.ui.use' },
  { action: 'ui.back', scope: 'inventory', chord: { key: 'escape' }, label: 'shortcuts.ui.back' },
  { action: 'ui.next', scope: 'records', chord: { key: 'arrowdown' }, label: 'shortcuts.ui.next' },
  { action: 'ui.prev', scope: 'records', chord: { key: 'arrowup' }, label: 'shortcuts.ui.prev' },
  { action: 'ui.back', scope: 'records', chord: { key: 'escape' }, label: 'shortcuts.ui.back' },
  { action: 'ui.activate', scope: 'result', chord: { key: 'enter' }, label: 'shortcuts.ui.continue' },
  { action: 'ui.back', scope: 'result', chord: { key: 'escape' }, label: 'shortcuts.battle.back' },

  // --- settings overlay -----------------------------------------------------
  { action: 'settings.tabNext', scope: 'settings', chord: { key: 'tab', ctrl: true }, label: 'shortcuts.settings.tabNext', allowInTextInput: true },
  { action: 'settings.tabPrev', scope: 'settings', chord: { key: 'tab', ctrl: true, shift: true }, label: 'shortcuts.settings.tabPrev', allowInTextInput: true },
  { action: 'settings.scrollUp', scope: 'settings', chord: { key: 'arrowup' }, label: 'shortcuts.settings.scrollUp' },
  { action: 'settings.scrollDown', scope: 'settings', chord: { key: 'arrowdown' }, label: 'shortcuts.settings.scrollDown' },
  { action: 'settings.scrollUp', scope: 'settings', chord: { key: 'pageup' }, label: 'shortcuts.settings.scrollUp' },
  { action: 'settings.scrollDown', scope: 'settings', chord: { key: 'pagedown' }, label: 'shortcuts.settings.scrollDown' },
  { action: 'settings.scrollTop', scope: 'settings', chord: { key: 'home' }, label: 'shortcuts.settings.scrollTop' },
  { action: 'settings.scrollBottom', scope: 'settings', chord: { key: 'end' }, label: 'shortcuts.settings.scrollBottom' },
  { action: 'settings.reset', scope: 'settings', chord: { key: 'r', ctrl: true }, label: 'shortcuts.settings.reset' },
];

/** Rank: more modifiers first, so `Alt+Enter` wins over `Enter`. */
function modifierRank(chord: KeyChord): number {
  return (
    (chord.ctrl === true ? 1 : 0) +
    (chord.alt === true ? 1 : 0) +
    (chord.shift === true ? 1 : 0) +
    (chord.meta === true ? 1 : 0)
  );
}

/** Every binding that can fire in `scope`, best-ranked first. */
export function bindingsForScope(
  scope: ShortcutScope,
  bindings: readonly ShortcutBinding[] = DEFAULT_BINDINGS,
): ShortcutBinding[] {
  return bindings
    .filter((binding) => binding.scope === scope || binding.scope === 'global')
    .slice()
    .sort((left, right) => modifierRank(right.chord) - modifierRank(left.chord));
}

/**
 * Resolves an event into an action.
 *
 * `scope` is the active screen; `global` bindings are always considered. Set
 * `inTextInput` when a text field owns the keyboard — only bindings that opted
 * in with `allowInTextInput` will fire.
 */
export function resolveShortcut(
  event: KeyEventLike,
  scope: ShortcutScope,
  options: { readonly inTextInput?: boolean; readonly bindings?: readonly ShortcutBinding[] } = {},
): ShortcutAction | null {
  const inTextInput = options.inTextInput === true;
  for (const binding of bindingsForScope(scope, options.bindings)) {
    if (inTextInput && binding.allowInTextInput !== true) {
      continue;
    }
    if (chordMatches(binding.chord, event)) {
      return binding.action;
    }
  }
  return null;
}

/** True when the event is only a modifier press and must never be dispatched. */
export function isModifierOnly(event: KeyEventLike): boolean {
  const key = normalizeKey(event.key, event.keyCode);
  return key === 'shift' || key === 'control' || key === 'alt' || key === 'meta';
}

/**
 * The full table grouped for display: one entry per action, listing every chord
 * that triggers it. Used by the settings panel's shortcut reference.
 */
export interface ShortcutListing {
  readonly scope: ShortcutScope;
  readonly action: ShortcutAction;
  readonly label: string;
  readonly chords: string;
}

export function listShortcuts(
  bindings: readonly ShortcutBinding[] = DEFAULT_BINDINGS,
): ShortcutListing[] {
  const byAction = new Map<ShortcutAction, ShortcutListing>();
  for (const binding of bindings) {
    const existing = byAction.get(binding.action);
    const chord = describeChord(binding.chord);
    if (existing === undefined) {
      byAction.set(binding.action, {
        scope: binding.scope,
        action: binding.action,
        label: binding.label,
        chords: chord,
      });
    } else if (!existing.chords.split(' / ').includes(chord)) {
      byAction.set(binding.action, { ...existing, chords: `${existing.chords} / ${chord}` });
    }
  }
  const scopeOrder = new Map<ShortcutScope, number>(SHORTCUT_SCOPES.map((scope, index) => [scope, index]));
  return [...byAction.values()].sort((left, right) => {
    const leftRank = scopeOrder.get(left.scope) ?? 99;
    const rightRank = scopeOrder.get(right.scope) ?? 99;
    return leftRank !== rightRank ? leftRank - rightRank : left.action.localeCompare(right.action);
  });
}

// --- focus order ------------------------------------------------------------

/**
 * Moves a focus index through a list of focusable slots, wrapping at both ends
 * and skipping entries that are disabled or hidden. Used by the login form's
 * `Tab` / `Shift+Tab`.
 */
export function stepFocus<T>(
  slots: readonly T[],
  current: number,
  direction: 1 | -1,
  isEnabled: (slot: T) => boolean = () => true,
): number {
  if (slots.length === 0) {
    return -1;
  }
  let index = current;
  for (let hop = 0; hop < slots.length; hop += 1) {
    index = (index + direction + slots.length) % slots.length;
    const slot = slots[index];
    if (slot !== undefined && isEnabled(slot)) {
      return index;
    }
  }
  return -1;
}
