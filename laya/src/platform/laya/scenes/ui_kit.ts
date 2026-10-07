/**
 * UI kit for the LayaAir scenes.
 *
 * The prototype screens are built from clickable `Laya.Sprite` panels and
 * `Laya.Text` labels so the client has no dependency on the LayaAir UI package
 * or any imported scene/atlas yet. Replacing these with `laya.ui` widgets later
 * only touches this file plus the scene layout code.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE (kept backwards compatible — all four scene files still call
 * the original signatures below):
 *
 *   createTitle(text, width, subtitle?)            -> Laya.Text
 *   createLabel(text, width, y, fontSize?, opts?)  -> Laya.Text
 *   createButton(text, x, y, width, onClick)       -> ButtonHandle
 *   createPanel(x, y, width, height, opts?)        -> Laya.Sprite
 *
 * NEW REUSABLE WIDGETS (added for the scene agents — A3 etc.):
 *
 *   createCaption(text, width, y)                  -> Laya.Text
 *        Small dim helper text. Same layout rules as `createLabel`.
 *
 *   createProgressBar(x, y, width, height, opts?)  -> ProgressBarHandle
 *        Handle exposes `.sprite` (addChild it) and `.setRatio(0..1)`.
 *        opts: { fill?, track?, showLabel? } — label shows a percentage.
 *
 *   createDivider(x, y, length, horizontal?)       -> Laya.Sprite
 *        Hairline rule; `horizontal` defaults to true.
 *
 *   createBadge(text, x, y, opts?)                 -> BadgeHandle
 *        Pill-shaped status chip ("READY" / "WAITING"). Handle exposes
 *        `.sprite`, `.setText(t)`, `.setTone('neutral'|'success'|'warning'|'danger')`.
 *
 *   createCard(x, y, width, height, title?)        -> CardHandle
 *        Rounded panel with an optional title bar (room list rows).
 *        Handle exposes `.sprite` and `.body` (a container for row children,
 *        already offset below the title bar).
 *
 * All colours/spacing/font sizes come from `view/theme`, rounded shapes from
 * `view/sprites`'s `VectorPainter`. Nothing here hard-codes a hex string.
 */

import * as theme from '../view/theme';
import { VectorPainter, mix } from '../view/sprites';

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

export interface ButtonHandle {
  readonly sprite: Laya.Sprite;
  readonly label: Laya.Text;
  setEnabled(enabled: boolean): void;
  setText(text: string): void;
  /** Optional visual tone; defaults to 'primary'. Never required by old callers. */
  setVariant?(variant: ButtonVariant): void;
}

export type ButtonVariant = 'primary' | 'ghost' | 'danger';

export interface ProgressBarHandle {
  readonly sprite: Laya.Sprite;
  setRatio(ratio: number): void;
  readonly ratio: number;
}

export interface BadgeHandle {
  readonly sprite: Laya.Sprite;
  /**
   * Current pill width in pixels. The pill hugs its text, so callers that lay
   * badges out right-to-left need this to position the next one — `sprite.width`
   * works too, but this stays correct even if the sprite is never measured.
   */
  readonly width: number;
  setText(text: string): void;
  setTone(tone: BadgeTone): void;
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface CardHandle {
  readonly sprite: Laya.Sprite;
  /** Container placed below the (optional) title bar; add row children here. */
  readonly body: Laya.Sprite;
  setTitle(text: string): void;
}

export interface LabelOptions {
  color?: string;
  bold?: boolean;
  leading?: number;
  align?: string;
}

export interface PanelOptions {
  /** Optional title bar drawn across the top of the panel. */
  title?: string;
  /** Override the outer fill (defaults to theme.COLOR_PANEL). */
  fill?: string;
  /** Override the border colour (defaults to theme.COLOR_PANEL_BORDER). */
  border?: string;
  /** Corner radius (defaults to theme.RADIUS_MD). */
  radius?: number;
}

export interface ProgressBarOptions {
  fill?: string;
  track?: string;
  /** Show a centred percentage label. Defaults to false. */
  showLabel?: boolean;
}

export interface BadgeOptions {
  tone?: BadgeTone;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Heading-sized title text, optionally with a subtitle and accent rule. */
export function createTitle(text: string, width: number, subtitle?: string): Laya.Text {
  const label = new Laya.Text();
  label.text = text;
  label.fontSize = theme.FONT_SIZE_TITLE;
  label.color = theme.COLOR_TITLE;
  label.bold = true;
  label.align = 'center';
  label.width = width;
  label.pos(0, theme.SPACE_LG);
  if (subtitle) {
    // `Laya.Text` has no multi-line decoration, so the subtitle rides along in
    // the same node after a line break; the accent rule is painted by the
    // caller via `createDivider` where a separated layout is wanted.
    label.text = `${text}\n${subtitle}`;
    label.leading = theme.SPACE_XS;
  }
  return label;
}

/** Body/label text. `fontSize` keeps the legacy positional API. */
export function createLabel(
  text: string,
  width: number,
  y: number,
  fontSize = theme.FONT_SIZE_LABEL,
  opts?: LabelOptions,
): Laya.Text {
  const label = new Laya.Text();
  label.text = text;
  label.fontSize = fontSize;
  label.color = opts?.color ?? theme.COLOR_TEXT;
  label.bold = opts?.bold ?? false;
  if (opts?.align) {
    label.align = opts.align;
  }
  label.width = width;
  label.wordWrap = true;
  label.leading = opts?.leading ?? theme.SPACE_XS;
  label.pos(theme.SPACE_MD, y);
  return label;
}

/** Small, dim caption text — same layout rules as `createLabel`. */
export function createCaption(text: string, width: number, y: number): Laya.Text {
  return createLabel(text, width, y, theme.FONT_SIZE_CAPTION, { color: theme.COLOR_TEXT_MUTED });
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

interface VariantPalette {
  base: string;
  border: string;
  text: string;
  disabled: string;
}

function variantPalette(variant: ButtonVariant): VariantPalette {
  switch (variant) {
    case 'ghost':
      return {
        base: theme.COLOR_PANEL_DEEP,
        border: theme.COLOR_PANEL_BORDER,
        text: theme.COLOR_TEXT,
        disabled: theme.COLOR_PANEL_DEEP,
      };
    case 'danger':
      return {
        base: theme.COLOR_DANGER,
        border: theme.COLOR_DANGER,
        text: theme.COLOR_TEXT,
        disabled: theme.COLOR_PANEL_DEEP,
      };
    case 'primary':
    default:
      return {
        base: theme.COLOR_PANEL,
        border: theme.COLOR_PANEL_BORDER,
        text: theme.COLOR_TEXT,
        disabled: theme.COLOR_PANEL_DEEP,
      };
  }
}

function createButtonInternal(
  text: string,
  x: number,
  y: number,
  width: number,
  onClick: () => void,
  variant: ButtonVariant,
  height: number,
): ButtonHandle {
  const sprite = new Laya.Sprite();
  sprite.pos(x, y);
  sprite.mouseEnabled = true;

  const label = new Laya.Text();
  label.text = text;
  label.fontSize = theme.FONT_SIZE_BODY;
  label.align = 'center';
  label.valign = 'middle';
  label.width = width;
  label.height = height;
  label.pos(0, 0);

  const palette = variantPalette(variant);
  let enabled = true;
  let hover = false;
  let pressed = false;

  const redraw = (): void => {
    const g = sprite.graphics;
    g.clear();
    const radius = theme.RADIUS_SM;
    if (!enabled) {
      VectorPainter.roundedPanel(
        g,
        0,
        0,
        width,
        height,
        radius,
        palette.disabled,
        theme.COLOR_DIVIDER,
        1,
      );
      label.color = theme.COLOR_TEXT_DISABLED;
      return;
    }
    // Lighten on hover, darken while pressed.
    let base = palette.base;
    let border = palette.border;
    if (pressed) {
      base = mix(palette.base, theme.COLOR_VOID, 0.28);
      border = mix(palette.border, theme.COLOR_VOID, 0.18);
    } else if (hover) {
      base = mix(palette.base, theme.COLOR_ACCENT, 0.14);
      border = mix(palette.border, theme.COLOR_ACCENT, 0.5);
    }
    VectorPainter.roundedPanel(g, 0, 0, width, height, radius, base, border, 2);
    label.color = palette.text;
  };
  redraw();

  sprite.on(Laya.Event.MOUSE_OVER, undefined, () => {
    if (!enabled || hover) {
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
    if (!enabled || pressed) {
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
  sprite.on(Laya.Event.CLICK, undefined, () => {
    if (enabled) {
      onClick();
    }
  });

  sprite.addChild(label);

  return {
    sprite,
    label,
    setEnabled(value: boolean): void {
      enabled = value;
      sprite.mouseEnabled = value;
      if (!value) {
        hover = false;
        pressed = false;
      }
      redraw();
    },
    setText(value: string): void {
      label.text = value;
    },
  };
}

/** Kept signature — primary variant, standard height. */
export function createButton(
  text: string,
  x: number,
  y: number,
  width: number,
  onClick: () => void,
): ButtonHandle {
  return createButtonInternal(text, x, y, width, onClick, 'primary', theme.BUTTON_HEIGHT);
}

/** Extended builder: pick a variant and/or a custom height. */
export function createButtonEx(
  text: string,
  x: number,
  y: number,
  width: number,
  onClick: () => void,
  variant: ButtonVariant = 'primary',
  height = theme.BUTTON_HEIGHT,
): ButtonHandle {
  return createButtonInternal(text, x, y, width, onClick, variant, height);
}

// ---------------------------------------------------------------------------
// Panel / card
// ---------------------------------------------------------------------------

const TITLE_BAR_HEIGHT = 34;

/** Rounded panel, legacy signature. Extra options are optional. */
export function createPanel(x: number, y: number, width: number, height: number, opts?: PanelOptions): Laya.Sprite {
  const panel = new Laya.Sprite();
  panel.pos(x, y);
  const g = panel.graphics;
  const fill = opts?.fill ?? theme.COLOR_PANEL;
  const border = opts?.border ?? theme.COLOR_PANEL_BORDER;
  const radius = opts?.radius ?? theme.RADIUS_MD;

  VectorPainter.roundedPanel(g, 0, 0, width, height, radius, fill, border, 2);
  // A slightly inset, deeper wash gives the panel some depth without a texture.
  g.drawRect(
    theme.RADIUS_SM,
    theme.RADIUS_SM,
    width - theme.RADIUS_SM * 2,
    height - theme.RADIUS_SM * 2,
    theme.COLOR_PANEL_DEEP,
    null,
  );

  if (opts?.title) {
    const bar = new Laya.Sprite();
    const barG = bar.graphics;
    VectorPainter.roundedPanel(
      barG,
      0,
      0,
      width,
      TITLE_BAR_HEIGHT,
      radius,
      mix(fill, theme.COLOR_ACCENT, 0.08),
      border,
      2,
    );
    barG.drawRect(0, TITLE_BAR_HEIGHT - 1, width, 1, theme.COLOR_DIVIDER);
    const title = new Laya.Text();
    title.text = opts.title;
    title.fontSize = theme.FONT_SIZE_LABEL;
    title.bold = true;
    title.color = theme.COLOR_TITLE;
    title.valign = 'middle';
    title.height = TITLE_BAR_HEIGHT;
    title.pos(theme.SPACE_MD, 0);
    bar.addChild(title);
    panel.addChild(bar);
  }

  return panel;
}

/** Card-style panel for list rows. `body` is offset below the title bar. */
export function createCard(
  x: number,
  y: number,
  width: number,
  height: number,
  title?: string,
): CardHandle {
  const sprite = createPanel(x, y, width, height);
  const g = sprite.graphics;

  // Title bar (fixed child, created once) is drawn first so `body` sits on top.
  const hasTitleBar = title !== undefined;
  const titleText = new Laya.Text();
  if (hasTitleBar) {
    VectorPainter.roundedPanel(
      g,
      0,
      0,
      width,
      TITLE_BAR_HEIGHT,
      theme.RADIUS_MD,
      mix(theme.COLOR_PANEL, theme.COLOR_ACCENT, 0.08),
      theme.COLOR_PANEL_BORDER,
      2,
    );
    g.drawRect(0, TITLE_BAR_HEIGHT - 1, width, 1, theme.COLOR_DIVIDER);
    titleText.text = title;
    titleText.fontSize = theme.FONT_SIZE_LABEL;
    titleText.bold = true;
    titleText.color = theme.COLOR_TITLE;
    titleText.valign = 'middle';
    titleText.height = TITLE_BAR_HEIGHT;
    titleText.pos(theme.SPACE_MD, 0);
    sprite.addChild(titleText);
  }

  const body = new Laya.Sprite();
  body.pos(0, hasTitleBar ? TITLE_BAR_HEIGHT : 0);
  sprite.addChild(body);

  return {
    sprite,
    body,
    setTitle(text: string): void {
      titleText.text = text;
    },
  };
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

export function createDivider(x: number, y: number, length: number, horizontal = true): Laya.Sprite {
  const sprite = new Laya.Sprite();
  sprite.pos(x, y);
  VectorPainter.divider(sprite.graphics, 0, 0, length, horizontal, theme.COLOR_DIVIDER);
  // `Graphics` lines are unstroked sprites; give the divider a hit-free box so
  // callers can position siblings relative to it if needed.
  sprite.size(horizontal ? length : 1, horizontal ? 1 : length);
  return sprite;
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

export function createProgressBar(
  x: number,
  y: number,
  width: number,
  height: number,
  opts?: ProgressBarOptions,
): ProgressBarHandle {
  const sprite = new Laya.Sprite();
  sprite.pos(x, y);
  const fill = opts?.fill ?? theme.COLOR_SUCCESS;
  const track = opts?.track ?? theme.COLOR_HP_BACK;
  let current = 0;

  const label = new Laya.Text();
  if (opts?.showLabel) {
    label.fontSize = theme.FONT_SIZE_CAPTION;
    label.color = theme.COLOR_HUD;
    label.align = 'center';
    label.valign = 'middle';
    label.width = width;
    label.height = height;
    label.pos(0, 0);
    sprite.addChild(label);
  }

  const redraw = (): void => {
    sprite.graphics.clear();
    VectorPainter.progressBar(sprite.graphics, 0, 0, width, height, current, fill, track);
    if (opts?.showLabel) {
      label.text = `${Math.round(current * 100)}%`;
      label.color = current > 0.5 ? theme.COLOR_VOID : theme.COLOR_HUD;
    }
  };
  redraw();

  return {
    sprite,
    get ratio(): number {
      return current;
    },
    setRatio(ratio: number): void {
      current = Math.max(0, Math.min(1, ratio));
      redraw();
    },
  };
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

interface BadgePalette {
  fill: string;
  text: string;
}

function badgePalette(tone: BadgeTone): BadgePalette {
  switch (tone) {
    case 'success':
      return { fill: theme.COLOR_SUCCESS, text: theme.COLOR_VOID };
    case 'warning':
      return { fill: theme.COLOR_WARNING, text: theme.COLOR_VOID };
    case 'danger':
      return { fill: theme.COLOR_DANGER, text: theme.COLOR_VOID };
    case 'neutral':
    default:
      return { fill: theme.COLOR_PANEL_BORDER, text: theme.COLOR_TEXT };
  }
}

const BADGE_HEIGHT = 20;

export function createBadge(text: string, x: number, y: number, opts?: BadgeOptions): BadgeHandle {
  const sprite = new Laya.Sprite();
  sprite.pos(x, y);
  let tone: BadgeTone = opts?.tone ?? 'neutral';

  const label = new Laya.Text();
  label.text = text;
  label.fontSize = theme.FONT_SIZE_CAPTION;
  label.align = 'center';
  label.valign = 'middle';
  label.height = BADGE_HEIGHT;
  sprite.addChild(label);

  let currentWidth = 0;

  const redraw = (): void => {
    const palette = badgePalette(tone);
    // Measure the text so the pill hugs its content. `Laya.Text.textWidth` is
    // not in the shim, so estimate from glyph count at caption size.
    const textWidth = Math.max(BADGE_HEIGHT, label.text.length * theme.FONT_SIZE_CAPTION * 0.62);
    const width = textWidth + theme.SPACE_MD;
    currentWidth = width;
    // Size the sprite to its paint. Without this the sprite reports width 0 and
    // any caller laying badges out right-to-left positions them wrongly.
    sprite.size(width, BADGE_HEIGHT);
    sprite.graphics.clear();
    VectorPainter.roundedPanel(
      sprite.graphics,
      0,
      0,
      width,
      BADGE_HEIGHT,
      BADGE_HEIGHT / 2,
      palette.fill,
      palette.fill,
      0,
    );
    label.width = width;
    label.pos(0, 0);
    label.color = palette.text;
  };
  redraw();

  return {
    sprite,
    get width(): number {
      return currentWidth;
    },
    setText(value: string): void {
      label.text = value;
      redraw();
    },
    setTone(value: BadgeTone): void {
      tone = value;
      redraw();
    },
  };
}
