/**
 * Window-control wrapper for **native** (LayaNative) builds.
 *
 * LayaNative has no DOM `requestFullscreen`, and the engine's own
 * `PAL.browser.setResolution(w, h, true)` door is unusable for fullscreen: it
 * forwards to `conch.setResolution`, which on Windows goes through SDL's
 * exclusive mode and `ChangeDisplaySettingsEx`, so it *switches the monitor's
 * resolution and refresh rate* (measured: 2560x1600@165Hz -> 2560x1440).
 *
 * `spk_win` (see `laya/native/win_ext/`) is a native extension that instead
 * resizes the existing window to the monitor's `rcMonitor` with
 * `SetWindowLongPtr` + `SetWindowPos`, i.e. a borderless *windowed* fullscreen
 * that never touches the display mode. This module is the thin JS wrapper over
 * its global object.
 *
 * The extension surface is deliberately tiny and synchronous: ints and strings
 * only, no objects to marshal across the JSVM boundary. Every method returns a
 * plain value, so the wrapper can stay allocation-free and exception-free.
 *
 * The extension is optional — it is absent on web builds and on older native
 * packages — so {@link spkWin} validates the shape and everything degrades to a
 * safe `null`/`false` rather than throwing.
 *
 * NOTE: `platform/native/` only.
 */

/** The `spk_win` global exported by the LayaNative window extension. */
export interface SpkWinApi {
  /** Extension build id, e.g. `"spellkard-win/1.0.0"`. */
  version(): string;
  /** Primary monitor size as `"2048x1280"`. */
  getDesktopSize(): string;
  /** `1` when the window is currently borderless-windowed-fullscreen, else `0`. */
  isFullscreen(): number;
  /** A JSON snapshot of the window/desktop state; see the extension docs. */
  getState(): string;
  /** Enters (`1`) or leaves (`0`) borderless windowed fullscreen; `1` on success. */
  setFullscreen(enable: number): number;
}

/** A monitor size in device pixels. */
export interface NativeDesktopSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Parses the extension's `"2048x1280"` desktop-size string.
 *
 * Returns `null` for anything that is not a `WxH` pair of positive integers —
 * a malformed string, a missing value, or a degenerate `"0x0"` — so callers can
 * treat "unknown desktop size" and "no extension" identically.
 */
export function parseDesktopSize(text: string): NativeDesktopSize | null {
  // Guard the runtime shape too: the native side could hand back a non-string
  // (e.g. `null` when the monitor query failed) despite the declared type.
  if (typeof text !== 'string') {
    return null;
  }
  const match = /^(\d+)x(\d+)$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function isSpkWinApi(value: unknown): value is SpkWinApi {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === 'function' &&
    typeof record.getDesktopSize === 'function' &&
    typeof record.isFullscreen === 'function' &&
    typeof record.getState === 'function' &&
    typeof record.setFullscreen === 'function'
  );
}

/**
 * Returns the `spk_win` extension when it is loaded, or `null` otherwise.
 *
 * The `scope` parameter defaults to `globalThis` and exists so tests can inject
 * a fake; on LayaNative the extension is installed on both `window` and the
 * global object, so both are probed. A partially-installed object (a missing
 * method) is rejected rather than trusted.
 */
export function spkWin(scope: unknown = globalThis): SpkWinApi | null {
  if (typeof scope !== 'object' || scope === null) {
    return null;
  }
  const direct = (scope as Record<string, unknown>).spk_win;
  if (isSpkWinApi(direct)) {
    return direct;
  }
  const nested = (scope as Record<string, unknown>).window;
  if (typeof nested === 'object' && nested !== null) {
    const fromWindow = (nested as Record<string, unknown>).spk_win;
    if (isSpkWinApi(fromWindow)) {
      return fromWindow;
    }
  }
  return null;
}

/** True when the `spk_win` extension is loaded and usable. */
export function nativeWindowAvailable(scope: unknown = globalThis): boolean {
  return spkWin(scope) !== null;
}

/**
 * True when the window is currently in native borderless windowed fullscreen.
 *
 * Reads the state from the extension rather than caching it, so a change made
 * outside this module is still observed. Absent extension or a throwing getter
 * both read as `false`.
 */
export function nativeFullscreenActive(scope: unknown = globalThis): boolean {
  const api = spkWin(scope);
  if (api === null) {
    return false;
  }
  try {
    return api.isFullscreen() === 1;
  } catch {
    return false;
  }
}

/** The primary monitor size, or `null` when unavailable or unparsable. */
export function nativeDesktopSize(scope: unknown = globalThis): NativeDesktopSize | null {
  const api = spkWin(scope);
  if (api === null) {
    return null;
  }
  try {
    return parseDesktopSize(api.getDesktopSize());
  } catch {
    return null;
  }
}

/**
 * Enters (`true`) or leaves (`false`) borderless windowed fullscreen.
 *
 * Returns whether the extension accepted the call. The native side is
 * idempotent and never changes the display mode, and any failure (absent
 * extension, a `0` result, a thrown error) collapses to `false` so callers can
 * stay no-op-safe inside a keyboard handler.
 */
export function setNativeFullscreen(enable: boolean, scope: unknown = globalThis): boolean {
  const api = spkWin(scope);
  if (api === null) {
    return false;
  }
  try {
    return api.setFullscreen(enable ? 1 : 0) === 1;
  } catch {
    return false;
  }
}
