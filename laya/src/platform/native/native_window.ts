/**
 * Resolves a window-scale setting into a concrete window size.
 *
 * `auto` needs the work area, so it takes it as an argument rather than
 * reaching for the extension - that keeps this a pure function and makes the
 * fit testable without a native host. When the area is unknown, `auto` degrades
 * to the design size rather than refusing: an unknown monitor should not leave
 * the window at whatever size it happened to start at.
 *
 * The fixed multiples are whole numbers, so the window keeps the **monitor's**
 * exact shape at 1x, 2x and 4x - the layout is width-adaptive (the playfield
 * takes the room the fixed HUD leaves), so a screen-shaped window shows more
 * playfield than one locked to the design stage's 3:4. `auto` is the only one
 * that answers to the work area rather than to a multiple of the screen.
 */
export function windowSizeForScale(
  scale: WindowScale,
  geometry: NativeScreenGeometry | null
): NativeWindowSize {
  if (scale === 'auto') {
    // The *work area* - the screen minus the taskbar - is what the window
    // fills, and the frame comes out of it as well, so the client area ends up
    // slightly smaller than this. That last part is done natively
    // (`fitWindowToWorkArea`), because only the window knows how tall its own
    // frame is; this is the size the arithmetic can predict.
    const area = geometry?.workArea ?? null;
    if (area === null) {
      return { width: WINDOW_SIZES['1'].width, height: WINDOW_SIZES['1'].height, scale: 1 };
    }
    const width = Math.min(area.width, Math.round(area.height * WINDOW_ASPECT));
    const height = Math.round(width / WINDOW_ASPECT);
    return { width, height, scale: width / WINDOW_SIZES['1'].width };
  }
  // The fixed settings are absolute sizes; the setting says "make the window
  // this big", not "make it some multiple of the screen".
  const size = WINDOW_SIZES[String(scale)] ?? WINDOW_SIZES['1'];
  return { width: size.width, height: size.height, scale };
}

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
  /**
   * Resizes the window's client area to `width`x`height`; `1` on success.
   *
   * Optional on purpose: older builds of the extension do not export it, and
   * this module's contract is that a missing capability degrades instead of
   * throwing. Until it is compiled in, {@link requestNativeWindowSize} reports
   * `false` and the window simply stays as it is.
   */
  setWindowSize?(width: number, height: number): number;
  /**
   * Sizes the window so its outer rectangle is exactly the work area.
   *
   * Optional like {@link SpkWinApi.setWindowSize}: a build without it simply
   * cannot fill the screen.
   */
  fitWindowToWorkArea?(): number;
}

import type { WindowScale } from '../../core/settings/schema';

/** A monitor size in device pixels. */
export interface NativeDesktopSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The usable part of the monitor, in device pixels — the work area, i.e. the
 * screen minus the taskbar and any other app bars.
 *
 * This is what an "auto" window should fill: a window sized to the whole
 * monitor loses its bottom edge behind the taskbar.
 */
export interface NativeWorkArea {
  readonly width: number;
  readonly height: number;
}

/**
 * The two screen rectangles a window size can be derived from.
 *
 * The **desktop** is the whole monitor and the **work area** is what is left
 * once the taskbar is subtracted. They share the monitor's aspect ratio, so a
 * window derived from either keeps the screen's shape — which is what the game
 * wants: its layout is width-adaptive (the playfield takes the room the fixed
 * HUD leaves, `core/game/battle_layout.ts`), so a screen-shaped window shows
 * more playfield, while a window locked to the design stage's 3:4 would leave
 * wide black bars on a 16:9 display.
 */
export interface NativeScreenGeometry {
  readonly desktop: NativeDesktopSize;
  readonly workArea: NativeWorkArea;
}

/**
 * The stage the UI is laid out for.
 *
 * It is **not** the window's shape: the stage is portrait (the playfield is
 * 640 wide with the HUD beside it), while the window sizes below are landscape
 * 4:3. The window is what the player sees; the stage is what the layout is
 * measured against.
 */
export const DESIGN_WIDTH = 900;
export const DESIGN_HEIGHT = 1200;

/**
 * The window sizes the fixed settings choose, in device pixels.
 *
 * They are absolute rather than multiples of anything: the setting says "make
 * the window this big", and the numbers are the classic 4:3 desktop sizes the
 * game is meant to run in. All of them keep the 4:3 shape, so "auto" can keep
 * it too.
 */
/**
 * The design stage, and the shape the window keeps.
 *
 * The stage is **portrait** (900x1200, 3:4) — the playfield is a tall block
 * with the HUD beside it — so the window has to be portrait too. It used to be
 * 4:3 landscape, which is the stage turned on its side: with `showall` the
 * stage was then letterboxed down the sides and only about 56% of the width
 * carried any game.
 */
export const STAGE_WIDTH = 900;
export const STAGE_HEIGHT = 1200;

export const WINDOW_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  '1': { width: 600, height: 800 },
  // Exactly the design stage: one stage pixel per screen pixel, the sharpest
  // of the three.
  '1.5': { width: STAGE_WIDTH, height: STAGE_HEIGHT },
  '2': { width: 1200, height: 1600 },
};

/** The shape every window size keeps: 3:4, the stage's own. */
export const WINDOW_ASPECT = STAGE_WIDTH / STAGE_HEIGHT;

/** A concrete window size in logical pixels. */
export interface NativeWindowSize {
  readonly width: number;
  readonly height: number;
  /** The multiple of the design stage this corresponds to. */
  readonly scale: number;
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
/**
 * Asks the host to resize its window, and reports whether it did.
 *
 * `false` is not an error worth surfacing: it means the running build has no
 * window-resize door (web builds, or the current prebuilt `spk_win.dll`), so
 * the caller should leave the window alone rather than fall back to something
 * louder. Deliberately *not* wired to `PAL.browser.setResolution`, which on
 * Windows reaches `conch.setResolution` and changes the monitor's mode — see
 * the module header.
 */
export function requestNativeWindowSize(
  size: NativeWindowSize,
  scope: unknown = globalThis
): boolean {
  const api = spkWin(scope);
  if (api === null || typeof api.setWindowSize !== 'function') {
    return false;
  }
  try {
    return api.setWindowSize(size.width, size.height) === 1;
  } catch {
    return false;
  }
}

/**
 * The work area of the monitor the window is on, or `null` when it cannot be
 * read.
 *
 * The extension's `getState()` already reports it (`workW` / `workH`), so this
 * is a parse of that JSON rather than a second native call.
 */
export function nativeWorkArea(scope: unknown = globalThis): NativeWorkArea | null {
  const api = spkWin(scope);
  if (api === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(api.getState());
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const width = Number(record.workW);
    const height = Number(record.workH);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * The window's current outer size, or `null` when it cannot be read.
 *
 * Used to tell whether the native window has stopped moving yet.
 */
export function nativeWindowSize(scope: unknown = globalThis): NativeDesktopSize | null {
  const api = spkWin(scope);
  if (api === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(api.getState());
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const width = Number(record.windowW);
    const height = Number(record.windowH);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { width, height };
  } catch {
    return null;
  }
}

/**
 * The monitor's desktop and work area together, or `null` when the extension
 * is not there.
 *
 * The two come from one native call — `getState()` reports both — so they are
 * always consistent with each other.
 */
export function nativeScreenGeometry(scope: unknown = globalThis): NativeScreenGeometry | null {
  const api = spkWin(scope);
  if (api === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(api.getState());
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const desktopW = Number(record.desktopW);
    const desktopH = Number(record.desktopH);
    const workW = Number(record.workW);
    const workH = Number(record.workH);
    if (!Number.isFinite(desktopW) || !Number.isFinite(desktopH) || desktopW <= 0 || desktopH <= 0) {
      return null;
    }
    const workArea = Number.isFinite(workW) && Number.isFinite(workH) && workW > 0 && workH > 0
      ? { width: workW, height: workH }
      : { width: desktopW, height: desktopH };
    return { desktop: { width: desktopW, height: desktopH }, workArea };
  } catch {
    return null;
  }
}

/**
 * Fills the work area: the window's outer rectangle becomes the work area, so
 * the client area is the work area minus the frame.
 *
 * This is the exact "auto" size - the taskbar and the window's own border are
 * both excluded, because only the window knows how tall its frame is. It is
 * done natively rather than by computing a number here for that reason.
 */
export function requestNativeWindowFill(scope: unknown = globalThis): boolean {
  const api = spkWin(scope);
  if (api === null || typeof api.fitWindowToWorkArea !== 'function') {
    return false;
  }
  try {
    return api.fitWindowToWorkArea() === 1;
  } catch {
    return false;
  }
}

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
