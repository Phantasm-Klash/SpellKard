/**
 * TNA skinning for the official LayaAir widgets.
 *
 * ## Why this file exists
 *
 * The settings controls are the engine's own prefabs (`internal/UI/*.lh` — see
 * `ui_prefabs.ts` for why those and not `Laya.Button`). They bring the right
 * structure and behaviour: a CheckBox with a real `selected` state, a ScrollBar
 * with `bg`/`bar`/`grip`/`up`/`down` parts, a Slider with a draggable grip.
 *
 * What they do **not** bring is this project's look: their skins come from
 * `comp.atlas`, the engine's light, rounded default art, which sits badly next
 * to the dark violet TNA palette. The project rule is to use the engine's
 * official widget set but keep our own art direction, so the prefabs are
 * re-skinned here — each part's graphics are cleared and repainted from
 * `view/theme`, the same colours the hand-painted controls use.
 *
 * The result is an official widget — real state, real hit box, real state
 * changes — wearing the TNA palette.
 *
 * ## What is *not* touched
 *
 * Behaviour. Nothing here binds events, stores values or decides geometry: the
 * panel owns the scroll offset and each row owns its value, exactly as before.
 * Skinning only repaints.
 *
 * NOTE: `platform/laya/` only.
 */

import * as theme from '../view/theme';
import { VectorPainter } from '../view/sprites';

/**
 * A prefab part seen through the properties skinning needs.
 *
 * The engine sets `name` on every prefab child (`bg`, `bar`, `grip`, …) and
 * every part is a sprite with `graphics`, but the project's Laya typings
 * declare neither `name` on `Sprite` nor a `getChildByName` helper, so both are
 * reached through this widened shape.
 */
interface Part {
  readonly name?: unknown;
  readonly graphics?: unknown;
  readonly width?: number;
  readonly height?: number;
  visible: boolean;
}

/** The graphics object skinning paints into. */
type Painter = {
  clear: () => void;
  drawCircle: (x: number, y: number, radius: number, fill: string) => void;
};

function partAt(widget: Laya.Sprite, name: string): Laya.Sprite | null {
  for (let i = 0; i < widget.numChildren; i += 1) {
    const child = widget.getChildAt(i);
    if (child === null || child === undefined) {
      continue;
    }
    if ((child as unknown as Part).name === name) {
      return child;
    }
  }
  return null;
}

/**
 * Repaints one named part of a prefab.
 *
 * `draw` receives the part and its own box, so the part keeps its layout and
 * only its paint changes. A missing part (or one without graphics) is skipped
 * rather than throwing: a renamed part in a future engine version must degrade
 * to an unskinned widget, not to a broken panel.
 */
function paintPart(
  widget: Laya.Sprite,
  name: string,
  draw: (part: Laya.Sprite, graphics: Painter, w: number, h: number) => void,
): void {
  const part = partAt(widget, name);
  if (part === null) {
    return;
  }
  const shape = part as unknown as Part;
  const graphics = shape.graphics as Painter | null | undefined;
  if (graphics === null || graphics === undefined || typeof graphics.clear !== 'function') {
    return;
  }
  graphics.clear();
  draw(part, graphics, Number(shape.width) || 0, Number(shape.height) || 0);
}

/** Hides a named part. */
function hidePart(widget: Laya.Sprite, name: string): void {
  const part = partAt(widget, name);
  if (part !== null) {
    part.visible = false;
  }
}

/** A rounded plate in the TNA palette — the base for tracks and buttons. */
function plate(
  graphics: Painter,
  w: number,
  h: number,
  radius: number,
  fill: string,
  border?: string,
): void {
  VectorPainter.roundedPanel(graphics as never, 0, 0, w, h, radius, fill, border, border ? 1 : 0);
}

/**
 * Skins the official CheckBox.
 *
 * The prefab's two art children are its off and on states (`normal`,
 * `selected`); the knob is painted into whichever state is showing, which keeps
 * the two aligned without a third part.
 */
export function skinCheckBox(widget: Laya.Sprite): void {
  // Derived from each part's own box rather than the widget's, because the row
  // sizes the widget before skinning and the parts are what actually get
  // painted. Reading the widget here would use a stale box.
  const radiusFor = (w: number, h: number): number => Math.min(w, h) / 2;
  paintPart(widget, 'normal', (_p, graphics, w, h) => {
    plate(graphics, w, h, radiusFor(w, h), theme.COLOR_PANEL_DEEP, theme.COLOR_PANEL_BORDER);
    const knobR = Math.max(2, h / 2 - 3);
    graphics.drawCircle(knobR + 3, h / 2, knobR, theme.COLOR_TEXT_DISABLED);
  });
  paintPart(widget, 'selected', (_p, graphics, w, h) => {
    // Blue, like the option rows and the hand-painted fallback: green read as
    // "something else is on" rather than "this one is on".
    plate(graphics, w, h, radiusFor(w, h), theme.COLOR_INFO, theme.COLOR_INFO);
    const knobR = Math.max(2, h / 2 - 3);
    graphics.drawCircle(w - knobR - 3, h / 2, knobR, theme.COLOR_VOID);
  });
}

/**
 * Skins the official Button: a TNA-tinted plate behind its own label.
 *
 * The label child keeps its text — buttons need one, unlike the CheckBox whose
 * label the row already paints.
 */
export function skinButton(widget: Laya.Sprite, danger = false): void {
  const fill = danger ? theme.COLOR_DANGER : theme.COLOR_PANEL;
  const border = danger ? theme.COLOR_DANGER : theme.COLOR_PANEL_BORDER;
  paintPart(widget, 'bg', (_p, graphics, w, h) => {
    plate(graphics, w, h, theme.RADIUS_SM, fill, border);
  });
}

/**
 * Skins the official vertical ScrollBar.
 *
 * The `up`/`down` arrow buttons are hidden: the panel drives scrolling through
 * `scrollTop` (drag, wheel and keyboard), and leaving the arrows live would add
 * a second, competing scroll driver.
 */
export function skinScrollBarV(widget: Laya.Sprite): void {
  paintPart(widget, 'bg', (_p, graphics, w, h) => {
    plate(graphics, w, h, w / 2, theme.COLOR_PANEL_DEEP);
  });
  paintPart(widget, 'bar', (_p, graphics, w, h) => {
    plate(graphics, w, h, w / 2, theme.COLOR_PANEL_BORDER);
  });
  hidePart(widget, 'up');
  hidePart(widget, 'down');
}

/**
 * Skins the official horizontal Slider with the TNA track, fill and thumb.
 *
 * The prefab's `title` (its own percentage readout) is hidden: the row paints a
 * formatted value next to the control, and two readouts would disagree whenever
 * `format` is overridden.
 */
export function skinSliderH(widget: Laya.Sprite): void {
  // The prefab's parts carry their own boxes (200x32) and **do not** follow the
  // parent's `size()`, so a row that shrinks the control would leave the track
  // painted at the prefab's height — sticking out of the container — and the
  // knob at its natural size. Paint from the *widget's* box instead, and scale
  // the knob to match.
  const trackW = Number(widget.width) || 0;
  const trackH = Number(widget.height) || 0;
  const barH = trackH > 0 ? Math.max(3, Math.min(8, Math.round(trackH * 0.25))) : 4;
  const knobSize = trackH > 0 ? Math.max(8, Math.min(16, Math.round(trackH * 0.6))) : 12;

  // Resize the repainted parts to the widget's box as well, so their own
  // geometry matches what is drawn. `paintPart` clears and redraws them, so
  // this is safe — and it keeps a later reader (or a debug probe) from seeing
  // the prefab's original 200x32 frame.
  for (const name of ['bg', 'bar']) {
    const part = partAt(widget, name);
    if (part !== null && trackW > 0 && trackH > 0) {
      part.size(trackW, trackH);
    }
  }

  // The knob is a child sprite, not a repainted part: scale it to the track.
  const grip = partAt(widget, 'grip');
  if (grip !== null) {
    const natural = Number(grip.height) || Number(grip.width) || 0;
    if (natural > 0 && knobSize > 0) {
      const scale = knobSize / natural;
      // No `Sprite.scale` in this project's typings — set the axes directly.
      grip.scaleX = scale;
      grip.scaleY = scale;
      grip.size(knobSize, knobSize);
    }
  }

  paintPart(widget, 'bg', (_p, graphics, w, h) => {
    // Paint across the widget's box, ignoring the part's own (stale) one: the
    // part is a 200x32 frame whose art is being replaced anyway.
    void w;
    void h;
    VectorPainter.roundedPanel(
      graphics as never,
      0,
      (trackH - barH) / 2,
      trackW,
      barH,
      barH / 2,
      theme.COLOR_PANEL_DEEP,
      theme.COLOR_DIVIDER,
      1,
    );
  });
  paintPart(widget, 'bar', (_p, graphics, w, h) => {
    void w;
    void h;
    VectorPainter.roundedPanel(
      graphics as never,
      0,
      (trackH - barH) / 2,
      trackW,
      barH,
      barH / 2,
      theme.COLOR_ACCENT,
      undefined,
      0,
    );
  });
  hidePart(widget, 'title');
}

/**
 * Skins the official ProgressBar.
 *
 * `bg` is the track and `bar` the fill. The fill is driven by the caller
 * through `scaleX` (see `ui_kit.createProgressBar`), so here it is only
 * repainted at full width — scaling a part that was already painted is what
 * keeps the cost off every frame.
 */
export function skinProgressBar(widget: Laya.Sprite, fill: string, track: string): void {
  paintPart(widget, 'bg', (_p, graphics, w, h) => {
    VectorPainter.roundedPanel(graphics as never, 0, 0, w, h, Math.min(w, h) / 2, track, undefined, 0);
  });
  paintPart(widget, 'bar', (_p, graphics, w, h) => {
    VectorPainter.roundedPanel(graphics as never, 0, 0, w, h, Math.min(w, h) / 2, fill, undefined, 0);
  });
  // The prefab's own percentage readout would duplicate whatever the caller
  // paints, and the two disagree whenever the caller formats the value.
  hidePart(widget, 'title');
}

/**
 * Skins the official TextInput: a TNA field behind the engine's own caret and
 * selection handling.
 *
 * The engine's text input is worth keeping rather than re-implementing — caret
 * blinking, selection and IME are exactly the "business beyond the client" that
 * belongs to the engine — so only its plate is repainted.
 */
export function skinTextInput(widget: Laya.Sprite): void {
  paintPart(widget, 'bg', (_p, graphics, w, h) => {
    VectorPainter.roundedPanel(
      graphics as never,
      0,
      0,
      w,
      h,
      theme.RADIUS_SM,
      theme.COLOR_PANEL_DEEP,
      theme.COLOR_PANEL_BORDER,
      1,
    );
  });
}
