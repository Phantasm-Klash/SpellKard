/**
 * Fullscreen adapter for the LayaAir build.
 *
 * There are two runtimes behind one API and they need different doors.
 *
 * ## Web
 *
 *  - `Laya.PAL.browser.requestFullscreen()` calls the document element's
 *    `requestFullscreen()` (with the vendor prefixes) right away, so it is the
 *    only immediate entry point.
 *  - `Laya.stage.fullscreen = true` merely arms a `mousedown`/`touchstart`
 *    listener that enters fullscreen on the *next* click, so it must never be
 *    used as a synchronous toggle.
 *
 * Leaving is the mirror image: `Laya.PAL.browser.exitFullscreen()` is the real
 * name — `Stage.exitFullscreen()` just forwards to it — so `PAL` is preferred
 * and the stage method is kept only as a fallback for a runtime without `PAL`.
 * State is read from `document.fullscreenElement` instead of being tracked
 * locally, because the browser can leave fullscreen on its own (Esc, a display
 * change) and a cached flag would then lie.
 *
 * ## LayaNative (the Windows `.exe`)
 *
 * MEASURED BUG: `Alt+Enter` and `F11` did nothing at all. The engine's web path
 * dead-ends here — `BrowserAdapter.requestFullscreen()` probes
 * `document.documentElement.requestFullscreen` and its three prefixed cousins,
 * all of which are `undefined` in the conch DOM, so it silently returns — and
 * `document.fullscreenElement` does not exist either, so `isFullscreen()` was
 * permanently `false`.
 *
 * DEPRECATED: the first native door tried was `PAL.browser.setResolution(w, h,
 * true)`, which forwards to `conch.setResolution`. Verified live, it *does*
 * enlarge the window — but on Windows it goes through SDL's exclusive mode and
 * `ChangeDisplaySettingsEx`, so it switches the monitor's resolution and
 * refresh rate (measured: 2560x1600@165Hz -> 2560x1440). That mutates the
 * user's desktop for the duration of the session, which is exactly what the
 * player asked us not to do, so the call is gone from this module and must not
 * be reintroduced.
 *
 * The native door is now the `spk_win` extension (`native/win_ext/`): it grows
 * the existing window to the monitor's `rcMonitor` with `SetWindowLongPtr`
 * (drop the border) + `SetWindowPos` (move/size to the full monitor), i.e. a
 * borderless *windowed* fullscreen that never changes the display mode. All of
 * that lives behind {@link setNativeFullscreen} / {@link nativeFullscreenActive}
 * in `platform/native/native_window.ts`; this module only chooses the branch.
 *
 * Because the extension reports its own state (`isFullscreen()`), the native
 * branch reads it back instead of caching a local flag — but unlike the web
 * branch there is no *fallback*: when the extension is missing (web build, or
 * an older native package) the native branch does nothing at all and records
 * `lastError`. It never falls back to the deprecated `setResolution` path.
 *
 * Every DOM and engine access is guarded, so the module is safe on LayaNative
 * (no DOM) and before `Laya.init`.
 *
 * NOTE: `platform/laya/` only.
 */

import { isNativeAssetRuntime } from '../../core/game/tna_assets';
import {
  nativeFullscreenActive,
  nativeWindowAvailable,
  setNativeFullscreen,
} from '../native/native_window';

/** Message from the last failed fullscreen call; empty when none has failed. */
let lastError = '';

/** The `PAL.browser` surface the web branch needs; every member is optional. */
interface FullscreenBrowser {
  readonly requestFullscreen?: () => Promise<void> | void;
  readonly exitFullscreen?: () => void;
}

/**
 * The live document, or `null` on a runtime without one.
 *
 * `typeof` is used rather than a truthiness test because referencing a missing
 * global throws a `ReferenceError` on LayaNative.
 */
function documentOrNull(): Document | null {
  return typeof document === 'undefined' ? null : document;
}

/**
 * `PAL.browser`, or `null` before the platform layer exists.
 *
 * `Laya.PAL` is assigned during `Laya.init`, so it is genuinely absent early;
 * the cast widens the declared shape back to optional to reflect that.
 */
function palBrowser(): FullscreenBrowser | null {
  const pal = (Laya as unknown as { readonly PAL?: { readonly browser?: unknown } }).PAL;
  const browser = pal?.browser;
  if (browser === null || typeof browser !== 'object') {
    return null;
  }
  return browser as FullscreenBrowser;
}

/** True on LayaNative, where fullscreen has to go through the native extension. */
function isNativeRuntime(): boolean {
  return isNativeAssetRuntime();
}

/**
 * The element the document is currently fullscreened on, or `null`.
 *
 * The unprefixed name is the standard one; the prefixed spellings are the same
 * fallbacks the engine's own wrapper supports, read off the raw document so a
 * build without the DOM typings for them still works.
 */
function fullscreenElementOf(doc: Document): unknown {
  const record = doc as unknown as Record<string, unknown>;
  return (
    record.fullscreenElement ??
    record.webkitFullscreenElement ??
    record.mozFullScreenElement ??
    record.msFullscreenElement ??
    null
  );
}

/** True when the runtime is currently in fullscreen. */
export function isFullscreen(): boolean {
  if (isNativeRuntime()) {
    // The extension owns the state, so it is read back rather than cached.
    return nativeFullscreenActive();
  }
  const doc = documentOrNull();
  if (doc === null) {
    return false;
  }
  return fullscreenElementOf(doc) != null;
}

/** True when the runtime exposes any fullscreen API at all. */
function fullscreenSupported(): boolean {
  if (isNativeRuntime()) {
    return nativeWindowAvailable();
  }
  const doc = documentOrNull();
  if (doc === null) {
    return false;
  }
  const root = doc.documentElement as unknown as Record<string, unknown> | null;
  const request =
    root?.requestFullscreen ??
    root?.webkitRequestFullscreen ??
    root?.mozRequestFullScreen ??
    root?.msRequestFullscreen;
  if (typeof request === 'function') {
    return true;
  }
  // The PAL wrapper is the engine's own cross-prefix fallback and may exist
  // even where the unprefixed `documentElement` method does not.
  return typeof palBrowser()?.requestFullscreen === 'function';
}

/** True for a value that can be awaited (the engine may return a promise or void). */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  );
}

/** Records an error without ever letting it escape as a throw. */
function recordError(error: unknown): void {
  lastError = error instanceof Error ? error.message : String(error);
}

/**
 * Enters native fullscreen through the `spk_win` extension.
 *
 * Returns the state the extension reports afterwards, so a refused call reads
 * as `false` instead of a stale local flag. When the extension is absent this
 * is a deliberate no-op — it does NOT fall back to `conch.setResolution`, which
 * would change the display mode.
 */
function enterNativeFullscreen(): boolean {
  if (!nativeWindowAvailable()) {
    lastError = 'spk_win extension unavailable';
    return false;
  }
  if (!setNativeFullscreen(true)) {
    lastError = 'spk_win setFullscreen(true) failed';
    return false;
  }
  lastError = '';
  return nativeFullscreenActive();
}

/** Leaves native fullscreen through the `spk_win` extension. */
function exitNativeFullscreen(): void {
  if (!nativeWindowAvailable()) {
    lastError = 'spk_win extension unavailable';
    return;
  }
  if (!setNativeFullscreen(false)) {
    lastError = 'spk_win setFullscreen(false) failed';
    return;
  }
  lastError = '';
}

/**
 * Enters fullscreen when not in it, leaves when in it. Resolves with the state
 * that is in force afterwards.
 *
 * Never rejects: a browser refuses `requestFullscreen()` outside a user gesture,
 * and a failed toggle must stay a no-op rather than surface as an unhandled
 * rejection in a keyboard handler.
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) {
    exitFullscreen();
    return isFullscreen();
  }

  if (isNativeRuntime()) {
    return enterNativeFullscreen();
  }

  const browser = palBrowser();
  const request = browser?.requestFullscreen;
  if (browser === null || typeof request !== 'function') {
    lastError = documentOrNull() === null ? 'no document' : 'fullscreen API unavailable';
    return isFullscreen();
  }

  try {
    const outcome = request.call(browser);
    // The engine's wrapper drops the element's promise and returns nothing,
    // while a raw browser call returns a promise that settles once fullscreen
    // is actually entered — await whichever shape came back.
    if (isThenable(outcome)) {
      await outcome;
    }
    lastError = '';
  } catch (error) {
    recordError(error);
  }
  return isFullscreen();
}

/** Leaves fullscreen. No-op when not fullscreen. */
export function exitFullscreen(): void {
  if (isNativeRuntime()) {
    exitNativeFullscreen();
    return;
  }
  if (!isFullscreen()) {
    return;
  }

  const browser = palBrowser();
  const leave = browser?.exitFullscreen;
  if (browser !== null && typeof leave === 'function') {
    try {
      leave.call(browser);
    } catch (error) {
      recordError(error);
    }
    return;
  }

  // Fallback only: `Stage.exitFullscreen()` forwards to the very same
  // `PAL.browser` method, so it is reached solely when `PAL` itself is missing.
  const stage = (Laya as unknown as { readonly stage?: Laya.Stage }).stage;
  if (stage !== undefined) {
    try {
      stage.exitFullscreen();
    } catch (error) {
      recordError(error);
    }
  }
}

/** For the screenshot harness. */
export function fullscreenDebugState(): {
  readonly fullscreen: boolean;
  readonly supported: boolean;
  /** Which door the runtime uses — `true` on LayaNative. */
  readonly native: boolean;
  /** Whether the `spk_win` native extension is loaded (always `false` on web). */
  readonly extension: boolean;
  readonly lastError: string;
} {
  return {
    fullscreen: isFullscreen(),
    supported: fullscreenSupported(),
    native: isNativeRuntime(),
    extension: nativeWindowAvailable(),
    lastError,
  };
}
