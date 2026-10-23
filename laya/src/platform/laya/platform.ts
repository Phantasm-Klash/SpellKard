/**
 * Platform detection for the LayaAir client — the "Windows game" question.
 *
 * ## What this answers
 *
 * "Is this build running as the **Windows native client**?" — i.e. the
 * LayaNative (conch) player on a Windows desktop, as opposed to a browser tab
 * on a PC, or a phone. That distinction drives the few genuinely
 * platform-shaped behaviours the client has (window control through the
 * `spk_win` extension, key hints, paths), so it is answered once, here.
 *
 * ## Why `Laya.Browser` and nothing else
 *
 * Every field below is read off the engine's own platform table
 * (`Laya.Browser`, filled in by `Browser.setPlatform` from the runtime's
 * `navigator.userAgent` / `navigator.platform`). No `userAgent` parsing, no
 * registry reads, no custom sniffing: `platformName === 'windows'` is the
 * engine's own classification (verified live on the shipped client:
 * `platformName: "windows"`, `onPC: true`, `onLayaRuntime: true`).
 *
 * `Laya.Browser.onLayaRuntime` is the native-runtime flag (`laya.core.js`
 * sets it in the native adapter), which separates "the packaged client" from
 * "a browser that happens to be on Windows".
 *
 * The module is deliberately pure: {@link classifyPlatform} takes an injected
 * `BrowserLike` scope, so it is unit-testable without an engine, and
 * {@link readBrowser} is the only place that touches the live global.
 *
 * NOTE: `platform/laya/` only.
 */

/**
 * The slice of `Laya.Browser` this module reads.
 *
 * All fields are optional: a foreign or partial scope (a test double, a
 * future engine) must degrade to `'unknown'` rather than throw.
 */
export interface BrowserLike {
  /** `true` on any desktop (not a phone/tablet). */
  readonly onPC?: boolean;
  /** `true` on phones and tablets. */
  readonly onMobile?: boolean;
  /** Engine platform name, e.g. `'windows'`, `'mac'`, `'ios'`, `'android'`. */
  readonly platformName?: string;
  /** `true` inside the LayaNative (conch) runtime. */
  readonly onLayaRuntime?: boolean;
  readonly onMac?: boolean;
  readonly onIOS?: boolean;
  readonly onAndroid?: boolean;
}

/**
 * Where the client is running.
 *
 *  - `windows-native` — the shipped Windows desktop client (LayaNative). This
 *    is the "Windows game" the detection exists for.
 *  - `desktop-web`    — a browser on a desktop OS (Windows or Mac).
 *  - `mobile`         — a phone or tablet browser.
 *  - `unknown`        — the engine has not reported a platform yet.
 */
export type PlatformKind = 'windows-native' | 'desktop-web' | 'mobile' | 'unknown';

/**
 * Classifies a `Laya.Browser`-shaped scope.
 *
 * Windows-native requires *both* halves: the engine must say the OS is
 * Windows **and** that we are inside the native runtime. A browser on Windows
 * is `desktop-web` — it has no `spk_win` extension and no packaged window, so
 * treating it as the native client would enable code paths that cannot work.
 */
export function classifyPlatform(browser: BrowserLike | null | undefined): PlatformKind {
  if (browser === null || browser === undefined) {
    return 'unknown';
  }
  const name = typeof browser.platformName === 'string' ? browser.platformName.toLowerCase() : '';
  const native = browser.onLayaRuntime === true;
  const mobile = browser.onMobile === true;
  if (native && name === 'windows') {
    return 'windows-native';
  }
  if (mobile) {
    return 'mobile';
  }
  if (browser.onPC === true || name !== '') {
    return 'desktop-web';
  }
  return 'unknown';
}

/** Whether `kind` is the Windows native client. */
export function isWindowsNative(kind: PlatformKind): boolean {
  return kind === 'windows-native';
}

/**
 * Short human-readable tag for the current platform.
 *
 * Language-neutral on purpose: it is a technical readout (the About tab's
 * build line and the screenshot harness's debug state both show it), so it is
 * not routed through `t()`.
 */
export function platformTagline(kind: PlatformKind = readPlatform()): string {
  switch (kind) {
    case 'windows-native':
      return 'Windows · native client';
    case 'desktop-web':
      return 'Desktop · browser';
    case 'mobile':
      return 'Mobile · browser';
    case 'unknown':
    default:
      return 'Unknown platform';
  }
}

/**
 * Reads the live `Laya.Browser` table without naming the `Laya` global.
 *
 * The global is reached through `globalThis` so this module stays free of
 * engine types — that is what lets the unit tests import it (the test build
 * only compiles `src/core/**` plus `tests/**`, and a reference to the `Laya`
 * namespace here would not type-check there).
 */
function readBrowser(): BrowserLike | null {
  const scope = globalThis as { Laya?: { Browser?: BrowserLike } };
  const browser = scope.Laya?.Browser;
  return browser ?? null;
}

/** Classifies the live engine platform. */
export function readPlatform(): PlatformKind {
  return classifyPlatform(readBrowser());
}
