/**
 * The gear button that opens the settings panel.
 *
 * Icon-only on purpose: a corner affordance reads at a glance, and the main
 * menu stays at its fixed five *text* buttons (see `lobby_scene`).
 *
 * The cog is drawn with `Graphics` rather than a font glyph: the native runtime
 * renders with Arial, which has no `⚙`, so a glyph button would be invisible
 * there. Eight radial teeth around an open ring reads as a cog at 40px.
 *
 * NOTE: `platform/laya/` only.
 */

import * as theme from '../../view/theme';
import { VectorPainter, mix } from '../../view/sprites';

/** Side of the square gear button, in pixels. */
export const SETTINGS_BUTTON_SIZE = 40;

export interface SettingsButtonHandle {
  readonly sprite: Laya.Sprite;
  /** Moves the button; the scenes call this from their relayout path. */
  setPosition(x: number, y: number): void;
}

/**
 * Square gear button. `onClick` opens the panel; the button owns its own
 * hover / pressed visuals so it needs no external state.
 */
export function createSettingsButton(
  x: number,
  y: number,
  size: number,
  onClick: () => void,
): SettingsButtonHandle {
  const sprite = new Laya.Sprite();
  sprite.pos(x, y);
  // Laya hit-tests a Sprite against its width/height, and drawing into
  // `graphics` does not update those — without this the button is unclickable.
  sprite.size(size, size);
  sprite.mouseEnabled = true;

  let hover = false;
  let pressed = false;

  const redraw = (): void => {
    const g = sprite.graphics;
    g.clear();
    const base = pressed
      ? mix(theme.COLOR_PANEL, theme.COLOR_VOID, 0.28)
      : hover
        ? mix(theme.COLOR_PANEL, theme.COLOR_ACCENT, 0.14)
        : theme.COLOR_PANEL;
    const border = hover
      ? mix(theme.COLOR_PANEL_BORDER, theme.COLOR_ACCENT, 0.5)
      : theme.COLOR_PANEL_BORDER;
    VectorPainter.roundedPanel(g, 0, 0, size, size, theme.RADIUS_SM, base, border, 2);
    drawGear(g, size / 2, size / 2, size * 0.3, hover ? theme.COLOR_TITLE : theme.COLOR_TEXT);
  };
  redraw();

  sprite.on(Laya.Event.MOUSE_OVER, undefined, () => {
    if (hover) {
      return;
    }
    hover = true;
    redraw();
  });
  sprite.on(Laya.Event.MOUSE_OUT, undefined, () => {
    if (!hover && !pressed) {
      return;
    }
    hover = false;
    pressed = false;
    redraw();
  });
  sprite.on(Laya.Event.MOUSE_DOWN, undefined, () => {
    if (pressed) {
      return;
    }
    pressed = true;
    redraw();
  });
  sprite.on(Laya.Event.MOUSE_UP, undefined, () => {
    if (!pressed) {
      return;
    }
    pressed = false;
    redraw();
  });
  sprite.on(Laya.Event.CLICK, undefined, onClick);

  return {
    sprite,
    setPosition(nextX: number, nextY: number): void {
      sprite.pos(nextX, nextY);
    },
  };
}

/** Paints a cog: eight radial teeth around an open ring. */
function drawGear(g: Laya.Graphics, cx: number, cy: number, radius: number, color: string): void {
  const teeth = 8;
  const spoke = Math.max(2, radius * 0.4);
  for (let i = 0; i < teeth; i += 1) {
    const a = (Math.PI * 2 * i) / teeth;
    g.drawLine(
      cx + Math.cos(a) * radius * 0.6,
      cy + Math.sin(a) * radius * 0.6,
      cx + Math.cos(a) * radius * 1.12,
      cy + Math.sin(a) * radius * 1.12,
      color,
      spoke,
    );
  }
  g.drawCircle(cx, cy, radius * 0.64, null, color, Math.max(2, radius * 0.28));
}
