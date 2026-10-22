/**
 * Applies the *Display* settings group to the LayaAir runtime.
 *
 * The settings model (`core/settings`) is engine-agnostic and only stores
 * values; this module is the one place that turns those values into engine
 * calls. Keeping the two apart is what lets the model be unit-tested without a
 * renderer, and what keeps every engine touch point greppable in one file.
 *
 * Two knobs, both verified against `engine/libs/laya.core.js` rather than
 * assumed:
 *
 *  - **Frame rate limit** — `Stage.frameRate` is NOT a numeric cap in this
 *    engine version: its setter only maps the strings `'slow' | 'mouse' |
 *    'sleep'` onto `Render.throttleMode`, so `30` and `120` both land on
 *    `throttleMode = 0` ("fast"). The supported hook is `Render.predicate`,
 *    which the vsync loop consults before every update+render; returning
 *    `false` skips that tick entirely.
 *  - **Render scale** — `Browser.pixelRatio` has no setter, but it is a plain
 *    forwarder to `PAL.browser.getPixelRatio()`, which is a writable member.
 *    Overriding it multiplies the canvas *backing store* only: the engine's own
 *    sizing code divides the draw scale back out (`canvasScale /= pixelRatio`),
 *    so the on-screen size is unchanged and only the sample count moves. That
 *    is exactly what a render-resolution setting should do.
 *
 * NOTE: `platform/laya/` only. Never imported from `core/`.
 */

import type { DisplaySettings } from '../../core/settings';

/**
 * Slack subtracted from the ideal frame interval when gating the render loop.
 *
 * `requestAnimationFrame` delivers timestamps a little *under* the nominal
 * interval on most displays (e.g. ~16.6ms for 60Hz), so a strict
 * `delta >= 1000 / 60` test would drop every other frame and halve the rate.
 * Two milliseconds of slack absorbs that jitter without letting an unwanted
 * frame through: at 30 FPS the gap to the next vsync is still far larger.
 */
const CAP_TOLERANCE_MS = 2;

/**
 * Bounds on the render-scale multiplier.
 *
 * Below 0.5 the UI text stops being legible; above 2 the backing store grows
 * quadratically for no visible gain (and a 4K window at 2x is already 33M
 * pixels per frame). The setter clamps rather than rejects so a corrupt stored
 * value cannot blank the canvas.
 */
const MIN_RENDER_SCALE = 0.5;
const MAX_RENDER_SCALE = 2;

/** Live render-scale factor read by the patched `getPixelRatio`. */
let renderScaleFactor = 1;
let pixelRatioPatched = false;

/**
 * Applies the whole Display group. Safe to call on every settings change and
 * before `Laya.init` has run — every engine access is guarded.
 */
export function applyDisplaySettings(display: DisplaySettings): void {
  applyFrameCap(display.frameCap);
  applyRenderScale(display.renderScale);
}

/**
 * Installs (or removes) the frame-rate gate.
 *
 * `cap <= 0` means "uncapped", which is the engine's own default state, so we
 * hand the loop back by clearing the predicate rather than installing one that
 * always returns `true` — that keeps `Render` in its pristine state and lets
 * the engine's own `throttleMode` logic stay in charge.
 */
export function applyFrameCap(cap: number): void {
  if (!Number.isFinite(cap) || cap <= 0) {
    Laya.Render.predicate = null;
    return;
  }
  const minDeltaMs = 1000 / cap - CAP_TOLERANCE_MS;
  let lastAccepted = Number.NEGATIVE_INFINITY;
  Laya.Render.predicate = (timestamp: number): boolean => {
    // A non-finite timestamp would poison `lastAccepted` and stall the loop
    // forever, so treat it as "let this frame through".
    if (!Number.isFinite(timestamp)) {
      return true;
    }
    if (timestamp - lastAccepted < minDeltaMs) {
      return false;
    }
    lastAccepted = timestamp;
    return true;
  };
}

/**
 * Sets the render-resolution multiplier and re-measures the canvas.
 *
 * Three things have to line up for this to actually change the sample count:
 *
 *  1. **`Config.useRetinalCanvas` must be on.** It defaults to `false`, and with
 *     it off `Stage.setScreenSize` sizes the backing store from the *design*
 *     size and lets the CSS matrix do the fitting — so the canvas was always
 *     900x1200 no matter what the setting said. This was the bug: the slider
 *     moved, the stored value changed, and nothing on screen ever did.
 *  2. **`getPixelRatio` must report device ratio × scale**, which is what
 *     {@link patchPixelRatio} installs. The engine multiplies the backing store
 *     by it and divides the draw scale back out, so the on-screen size is
 *     unchanged and only the pixel count moves.
 *  3. **The stage must re-measure**, which `updateCanvasSize` does; the engine
 *     only calls it on a real window resize, so we ask for it directly.
 */
export function applyRenderScale(scale: number): void {
  renderScaleFactor = clampRenderScale(scale);
  enableRetinalCanvas();
  patchPixelRatio();
  requestCanvasResize();
}

/** Clamps the multiplier into {@link MIN_RENDER_SCALE}..{@link MAX_RENDER_SCALE}. */
export function clampRenderScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, scale));
}

/**
 * Turns on `Config.useRetinalCanvas` so `pixelRatio` reaches the backing store.
 *
 * Safe to call repeatedly; a runtime without `Config` is left alone (the
 * setting then behaves as it did before — no resolution change, no crash).
 */
function enableRetinalCanvas(): void {
  const config = (Laya as unknown as { Config?: { useRetinalCanvas?: boolean } }).Config;
  if (config !== undefined) {
    config.useRetinalCanvas = true;
  }
}

/**
 * Wraps `PAL.browser.getPixelRatio` once so it reports the device ratio times
 * the chosen render scale.
 *
 * The wrapper calls through to the original instead of caching a number: the
 * device ratio is resolved by the platform layer during init and can change
 * when the window moves between displays, so multiplying the live value keeps
 * us correct in both directions.
 */
function patchPixelRatio(): void {
  if (pixelRatioPatched) {
    return;
  }
  const pal = (Laya as unknown as { PAL?: { browser?: { getPixelRatio?: () => number } } }).PAL;
  const host = pal?.browser;
  if (host === undefined || typeof host.getPixelRatio !== 'function') {
    return;
  }
  const original = host.getPixelRatio;
  host.getPixelRatio = function patchedPixelRatio(this: unknown): number {
    return original.call(host) * renderScaleFactor;
  };
  pixelRatioPatched = true;
}

/**
 * Re-runs the engine's canvas sizing so a new render scale becomes visible
 * immediately.
 *
 * `Stage.updateCanvasSize` is the engine's own entry point (it is what the
 * window `resize` handler calls); we hit it directly because a synthetic
 * `resize` event is not guaranteed to reach `PAL.browser`'s listener. The
 * event dispatch is kept as the fallback for runtimes that only react to the
 * real thing.
 */
function requestCanvasResize(): void {
  const stage = (Laya as unknown as { stage?: { updateCanvasSize?: (delay?: boolean) => void } }).stage;
  if (typeof stage?.updateCanvasSize === 'function') {
    stage.updateCanvasSize(true);
    return;
  }
  const win = Laya.Browser.window as {
    dispatchEvent?: (event: unknown) => void;
    Event?: new (type: string) => unknown;
  } | null;
  const EventCtor = win?.Event;
  if (win?.dispatchEvent === undefined || EventCtor === undefined) {
    return;
  }
  try {
    win.dispatchEvent(new EventCtor('resize'));
  } catch {
    // A runtime that rejects synthetic events is not a reason to fail a
    // settings change.
  }
}

/** Handle for the optional frame-rate readout. */
export interface FpsOverlayHandle {
  readonly sprite: Laya.Text;
  /** Adds the readout to a parent and starts sampling. */
  attach(parent: Laya.Sprite): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

/** How often the readout is recomputed, in milliseconds. */
const FPS_SAMPLE_MS = 500;

/**
 * Builds the corner frame-rate counter.
 *
 * Sampling on a frame loop and only repainting twice a second keeps the
 * readout from measuring its own cost — a counter that redrew every frame
 * would report the frame rate it caused.
 */
export function createFpsOverlay(): FpsOverlayHandle {
  const label = new Laya.Text();
  label.text = '';
  label.fontSize = 13;
  label.color = '#ffe36e';
  label.mouseEnabled = false;
  label.x = 6;
  label.y = 4;

  let frames = 0;
  let lastSampleMs = 0;
  let running = false;

  const tick = (): void => {
    frames += 1;
    const now = Laya.Browser.now();
    if (lastSampleMs === 0) {
      lastSampleMs = now;
      return;
    }
    const elapsed = now - lastSampleMs;
    if (elapsed < FPS_SAMPLE_MS) {
      return;
    }
    label.text = `${Math.round((frames * 1000) / elapsed)} FPS`;
    frames = 0;
    lastSampleMs = now;
  };

  return {
    sprite: label,
    attach(parent: Laya.Sprite): void {
      if (running) {
        return;
      }
      parent.addChild(label);
      running = true;
      Laya.timer.frameLoop(1, tick, tick);
    },
    setVisible(visible: boolean): void {
      label.visible = visible;
      // Stop sampling while hidden: a counter nobody can see should not cost
      // anything, and a stale reading is meaningless after the gap anyway.
      if (!visible) {
        frames = 0;
        lastSampleMs = 0;
      }
    },
    destroy(): void {
      if (running) {
        Laya.timer.clear(tick, tick);
        running = false;
      }
      label.removeSelf();
    },
  };
}
