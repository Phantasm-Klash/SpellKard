/**
 * Settings panel widget vocabulary.
 *
 * The settings card is a stack of *rows*. Every row is the same shape — a
 * rounded panel with a label (and optional description) on the left and one
 * control on the right — so the five sections are written purely as data:
 * build rows, stack them, hand back the height.
 *
 * Kept deliberately dependency-light: `Laya` primitives, the shared `theme`
 * tokens, the `ui_kit` button and the pure text-measurement helpers below.
 *
 * ## Why not `laya.ui`'s stock widgets
 *
 * The two runtimes this client ships on load **different, incompatible** UI
 * libraries, so there is no single official widget API to write against:
 *
 *  - the browser build (`index.html`) loads `engine/libs/laya.ui.js`, the
 *    classic set (`Laya.Button`, `Laya.CheckBox`, `Laya.Slider`, …);
 *  - the Windows native build (`resource/index.js`) loads
 *    `resource/libs/laya.ui2.js`, which is **FairyGUI** — it exports
 *    `Laya.UIPackage` / `Laya.GButton` / `Laya.GSlider` / … and none of the
 *    classic names (verified live: `typeof Laya.Button === 'undefined'` on
 *    the native runtime).
 *
 * Reaching for either set would therefore crash the other runtime, and
 * FairyGUI's default skins would replace the TNA art language this UI is
 * built from (see `docs/ART_POLICY.md`). The engine-side pieces that *are*
 * shared — `Laya.Sprite` hit-testing, `Laya.Event`, `Laya.Input` — are used
 * directly instead.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` except plain data.
 */

import * as theme from '../../view/theme';
import { VectorPainter, mix } from '../../view/sprites';
import { TnaUiImage } from '../../view/tna_ui';
import { createOfficialWidget } from '../../ui/official_widgets';
import { skinButton, skinCheckBox, skinSliderH } from '../../ui/official_skin';
import {
  UI_SLIDER_PROGRESS,
  UI_SLIDER_THUMB,
  UI_SLIDER_TRACK,
} from '../../../../core/game/ui_assets';
import { createButton, type ButtonHandle } from '../ui_kit';
import { attachCaretPlacement } from '../../text_input';

/**
 * 请求一张 TNA 条状贴图并把它非等比拉伸到给定尺寸。
 *
 * 先 `setImage` 触发加载、再 `setStretched` 设定拉伸目标——`setImage` 会清掉
 * 之前的拉伸（保证「后调用者生效」），所以顺序不能反。
 */
function stretchArt(image: TnaUiImage, name: string, width: number, height: number): void {
  image.setImage(name, 0);
  image.setStretched(width, height);
}

/**
 * Minimum row height, used when the text fits on one line.
 *
 * These are *floors*, not fixed heights: a row grows to fit a description that
 * wraps, so a long explanation is never clipped or overpainted by the control.
 */
export const ROW_HEIGHT = 54;
export const ROW_HEIGHT_COMPACT = 40;
/** Gap between stacked rows. */
export const ROW_GAP = 8;

/** Horizontal padding inside a row panel. */
const ROW_PAD = 12;
/** Vertical padding inside a row panel. */
const ROW_PAD_V = 7;
/** Line boxes: a font's size plus a little leading. */
const LABEL_LINE_H = theme.FONT_SIZE_LABEL + 2;
const DESC_LINE_H = theme.FONT_SIZE_CAPTION + 3;
/** Width of the toggle pill. */
const TOGGLE_W = 46;
// Every control in a row is the same height: the segmented control, the
// toggle and the slider's hit box. They were 26 / 24 / 26, which made the
// rows look ragged — and the toggle, being the shortest, read as the one that
// was slightly wrong.
const TOGGLE_H = 30;
/** Width of the slider control (its hit box; the bar drawn inside is thinner). */
const SLIDER_W = 108;
const SLIDER_HIT_H = 30;
const SLIDER_BAR_H = 4;
const SLIDER_KNOB_R = 6;
/** Width of the value readout next to a slider. */
const SLIDER_VALUE_W = 40;
/** Horizontal padding inside one segmented option button. */
const OPTION_PAD = 8;
const OPTION_H = 30;

// ---------------------------------------------------------------------------
// text measurement (shared with the About / note rows)
// ---------------------------------------------------------------------------

/**
 * Whether a code point renders at full width.
 *
 * CJK, Hangul and the fullwidth forms occupy a square em; Latin and the
 * punctuation around it average ~0.55em. Wrapping needs the distinction twice:
 * to measure a line, and to decide where a line may break at all (Chinese
 * carries no spaces, so a space-only rule would never wrap it).
 */
export function isWideChar(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/** Rough advance width of one character at `fontSize`. */
export function charWidth(codePoint: number, fontSize: number): number {
  return isWideChar(codePoint) ? fontSize : fontSize * 0.55;
}

/** Estimated rendered width of `text` at `fontSize`. */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    width += charWidth(char.codePointAt(0) ?? 0, fontSize);
  }
  return width;
}

/**
 * Greedy wrap to `maxWidth`, preferring word boundaries.
 *
 * A line may break *before* a space, or between two full-width glyphs (which is
 * how Chinese wraps without spaces). Breaking mid-word is only a last resort,
 * for a single token wider than the line — otherwise an English paragraph would
 * come out as `...restar` / `t.`, which reads as a typo.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  if (maxWidth <= 0) {
    return [];
  }
  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;
  /** Offset in `line` where the next break may fall; -1 when there is none. */
  let breakAt = -1;
  let previousWide = false;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const width = charWidth(codePoint, fontSize);
    const wide = isWideChar(codePoint);
    const mayBreakBefore = char === ' ' || (previousWide && wide);

    if (lineWidth + width > maxWidth && line !== '') {
      if (breakAt > 0) {
        // Push the trailing word onto the next line instead of splitting it.
        const rest = line.slice(breakAt);
        lines.push(line.slice(0, breakAt).replace(/\s+$/, ''));
        line = rest.replace(/^\s+/, '');
        lineWidth = estimateTextWidth(line, fontSize);
      } else {
        lines.push(line);
        line = '';
        lineWidth = 0;
      }
      breakAt = -1;
    }

    // Recorded *before* the append, so the offset points at the gap rather
    // than at the character that follows it.
    if (mayBreakBefore && line !== '') {
      breakAt = line.length;
    }
    line += char;
    lineWidth += width;
    previousWide = wide;
  }
  if (line !== '') {
    lines.push(line);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// handles
// ---------------------------------------------------------------------------

export interface RowHandle {
  readonly sprite: Laya.Sprite;
  /** Painted height; the caller advances its cursor by this plus `ROW_GAP`. */
  readonly height: number;
  setEnabled(enabled: boolean): void;
}

export interface ToggleRowHandle extends RowHandle {
  setValue(value: boolean): void;
}

export interface OptionRowHandle<T extends string | number> extends RowHandle {
  setSelected(id: T): void;
}

export interface SliderRowHandle extends RowHandle {
  setValue(value: number): void;
}

export interface TextRowHandle extends RowHandle {
  setValue(text: string): void;
}

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

function makeText(text: string, size: number, color: string, bold: boolean): Laya.Text {
  const label = new Laya.Text();
  label.text = text;
  label.fontSize = size;
  label.color = color;
  label.bold = bold;
  return label;
}

// ---------------------------------------------------------------------------
// The little "?" marker and the hint it shows
// ---------------------------------------------------------------------------

/** Diameter of the drawn marker, in pixels. */
const HINT_MARKER_D = 15;

/** The square the marker is hit-tested over, in pixels. */
const HINT_MARKER_HIT = 32;

/** The shared hint layer: one box, reused, parented to the stage. */
let hintLayer: Laya.Sprite | null = null;
let hintBox: Laya.Sprite | null = null;
let hintText: Laya.Text | null = null;

/** Which marker the hint is currently for, so a tap can toggle it off. */
let hintShownFor: Laya.Sprite | null = null;

/** The widest a hint may be before it wraps, in pixels. */
const HINT_MAX_W = 300;

/** Inset between the hint box's edge and its text, in pixels. */
const HINT_PAD = 8;

/**
 * Hides the hint, if one is showing.
 *
 * Exported so the panel can call it when it closes: a hint left on screen over
 * a hidden panel would look like a bug.
 */
export function hideSettingsHint(): void {
  if (hintLayer !== null) {
    hintLayer.visible = false;
  }
  hintShownFor = null;
}

/** Global position of a sprite, in stage coordinates. */
function globalPosition(sprite: Laya.Sprite): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: Laya.Sprite | null = sprite;
  while (node !== null) {
    x += node.x;
    y += node.y;
    // `parent` is not in this project's Sprite typing, so it is read through a
    // narrow cast rather than by widening the whole type.
    node = (node as unknown as { parent: Laya.Sprite | null }).parent;
  }
  return { x, y };
}

/**
 * Shows the hint text next to the marker.
 *
 * The box lives on the stage rather than inside the row: the settings panel
 * clips its content to the scroll viewport, so a hint parented to the row
 * would be cut off the moment the row sat near the edge.
 */
function showSettingsHint(anchor: Laya.Sprite, text: string): void {
  if (Laya.stage === undefined || Laya.stage === null) {
    return;
  }
  if (hintLayer === null || hintBox === null || hintText === null) {
    hintLayer = new Laya.Sprite();
    hintBox = new Laya.Sprite();
    hintText = makeText('', theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT, false);
    // `Text` has no padding in this project's typing, so the inset is done by
    // placing the text inside the box.
    hintText.pos(HINT_PAD, HINT_PAD);
    // Nothing in the hint may take the pointer: a box that swallows the mouse
    // stops the MOUSE_OUT that is supposed to close the hint, and the hint
    // then sticks to the screen.
    hintText.mouseEnabled = false;
    hintBox.mouseEnabled = false;
    hintBox.addChild(hintText);
    hintLayer.addChild(hintBox);
    hintLayer.mouseEnabled = false;
    hintLayer.visible = false;
    Laya.stage.addChild(hintLayer);
  }

  const lines = wrapText(text, HINT_MAX_W - HINT_PAD * 2, theme.FONT_SIZE_CAPTION);
  const widest = lines.reduce((max, line) => Math.max(max, estimateTextWidth(line, theme.FONT_SIZE_CAPTION)), 0);
  const boxW = Math.min(HINT_MAX_W, widest + HINT_PAD * 2);
  const boxH = lines.length * DESC_LINE_H + HINT_PAD * 2;
  // The text is sized to the box, not the other way round: the box is as wide
  // as the text needs, and the text has to fit *inside* it.
  hintText.text = lines.join('\n');
  hintText.width = boxW - HINT_PAD * 2;
  hintText.height = lines.length * DESC_LINE_H;
  hintBox.size(boxW, boxH);
  hintBox.graphics.clear();
  VectorPainter.roundedPanel(hintBox.graphics, 0, 0, boxW, boxH, theme.RADIUS_SM,
    theme.COLOR_PANEL_DEEP, theme.COLOR_INFO, 1);

  const at = globalPosition(anchor);
  const stageW = Laya.stage.width;
  const stageH = Laya.stage.height;
  // Below the marker, centred on it, and nudged back inside the stage when it
  // would hang off an edge.
  let x = at.x + anchor.width / 2 - boxW / 2;
  let y = at.y + anchor.height + 6;
  if (x + boxW > stageW - 8) {
    x = Math.max(8, stageW - boxW - 8);
  }
  if (x < 8) {
    x = 8;
  }
  if (y + boxH > stageH - 8) {
    y = Math.max(8, at.y - boxH - 6);
  }
  hintLayer.pos(x, y);
  hintLayer.visible = true;
  hintShownFor = anchor;
}

/**
 * The "?" marker that stands in for a row's small print.
 *
 * The small print used to be a second line of text under the label, which made
 * every row with an explanation twice as tall and left the explanation to be
 * read rather than looked up. Now the label carries a small marker and the
 * explanation appears when the pointer rests on it.
 */
function createHintMarker(text: string): Laya.Sprite {
  const marker = new Laya.Sprite();
  // The marker is drawn small, but it is hit-tested over a larger square: a
  // 15px circle is a hard target, and a hint that only shows when the pointer
  // happens to be exactly on the stroke reads as a broken hover.
  marker.size(HINT_MARKER_HIT, HINT_MARKER_HIT);
  const dot = new Laya.Sprite();
  dot.pos(Math.round((HINT_MARKER_HIT - HINT_MARKER_D) / 2), Math.round((HINT_MARKER_HIT - HINT_MARKER_D) / 2));
  dot.size(HINT_MARKER_D, HINT_MARKER_D);
  dot.graphics.drawCircle(HINT_MARKER_D / 2, HINT_MARKER_D / 2, HINT_MARKER_D / 2 - 1,
    null, theme.COLOR_INFO, 1);
  const question = makeText('?', 11, theme.COLOR_INFO, true);
  question.align = 'center';
  question.valign = 'middle';
  question.width = HINT_MARKER_D;
  question.height = HINT_MARKER_D;
  question.mouseEnabled = false;
  dot.addChild(question);
  marker.addChild(dot);
  marker.mouseEnabled = true;
  marker.on(Laya.Event.MOUSE_OVER, undefined, () => {
    showSettingsHint(marker, text);
  });
  marker.on(Laya.Event.MOUSE_OUT, undefined, () => {
    hideSettingsHint();
  });
  // A click **toggles** the hint rather than only closing it.
  //
  // A hover-only hint is unreachable without a pointer: a touch screen never
  // hovers, so the explanation would be gone for everyone playing on one.
  // Tapping the marker shows it, tapping again (or moving away) dismisses it.
  marker.on(Laya.Event.CLICK, undefined, () => {
    if (hintShownFor === marker) {
      hideSettingsHint();
      return;
    }
    showSettingsHint(marker, text);
  });
  return marker;
}


/** Paints the row's own rounded background. */
function paintRow(sprite: Laya.Sprite, width: number, height: number, enabled: boolean): void {
  const g = sprite.graphics;
  g.clear();
  if (width <= 0 || height <= 0) {
    return;
  }
  VectorPainter.roundedPanel(
    g,
    0,
    0,
    width,
    height,
    theme.RADIUS_SM,
    enabled ? theme.COLOR_PANEL : theme.COLOR_PANEL_DEEP,
    enabled ? theme.COLOR_PANEL_BORDER : theme.COLOR_DIVIDER,
    1,
  );
}

interface RowScaffold {
  readonly sprite: Laya.Sprite;
  readonly height: number;
  readonly label: Laya.Text;
  readonly hintMarker: Laya.Sprite | null;
  /** Right edge of the row, i.e. where a control aligns to. */
  readonly controlRight: number;
  /** Available width for the label / description block. */
  readonly textWidth: number;
  /**
   * y at which a *stacked* control starts. Only meaningful when the caller
   * asked for stacking; ignored otherwise.
   */
  readonly controlTop: number;
  setEnabled(enabled: boolean): void;
}

/**
 * Builds the shared label / description / background part of a row. The caller
 * then positions its own control against `controlRight` (inline) or
 * `controlTop` (stacked).
 *
 * The text block is wrapped to the width it actually has and the row grows to
 * fit it. Without that, a description longer than the gap left by a wide
 * control would simply be painted over by that control — which is exactly what
 * happened to the option rows before this.
 *
 * `stackedControlHeight > 0` switches the row to the stacked layout: the text
 * block gets the full row width and the control sits on its own line beneath
 * it. Wide controls (a four-way segmented button) use this, because squeezing
 * them inline leaves the text an unusably narrow column.
 */
function buildRow(
  width: number,
  label: string,
  description: string | undefined,
  controlWidth: number,
  stackedControlHeight = 0,
): RowScaffold {
  const hasDescription = description !== undefined && description !== '';
  const stacked = stackedControlHeight > 0;

  const textWidth = Math.max(
    0,
    stacked ? width - ROW_PAD * 2 : width - ROW_PAD * 2 - controlWidth - theme.SPACE_MD,
  );
  const labelLines = wrapText(label, textWidth, theme.FONT_SIZE_LABEL);
  // The explanation is a hover hint now, so it does not take up a line of its
  // own: the row is as tall as its label and its control.
  const textHeight = labelLines.length * LABEL_LINE_H;

  const height = Math.round(
    Math.max(
      hasDescription ? ROW_HEIGHT : ROW_HEIGHT_COMPACT,
      textHeight + ROW_PAD_V * 2,
      stacked ? textHeight + theme.SPACE_SM + stackedControlHeight + ROW_PAD_V * 2 : 0,
    ),
  );

  const sprite = new Laya.Sprite();
  sprite.size(width, height);
  // ★ The row MUST stay mouse-enabled (the default state). Setting
  // `mouseEnabled = false` here looks like the right way to keep the
  // background click-through, but in LayaAir 3 it is what made every
  // settings control dead: `InputManager.getSpriteUnderPoint` only descends
  // into a child whose `_mouseState` is `2` (explicitly enabled) or `0`
  // (untouched) with `CHECK_INPUT` set — an explicitly *disabled* container
  // hides its whole subtree from hit-testing. The toggle track, the option
  // segments and the slider track are all children of the row, so the row
  // being `mouseEnabled = false` swallowed every tap. Leaving the row at its
  // default lets the control's own `mouseEnabled = true` mark the ancestor
  // chain (`setMouseEnabledUp`), and a press on bare row space simply falls
  // through to the panel's drag-scroll, which is the intended behaviour.

  let enabled = true;
  paintRow(sprite, width, height, enabled);

  // Stacked rows anchor the text at the top; inline rows centre it against the
  // control so the label and the control share a baseline.
  const textTop = stacked ? ROW_PAD_V : Math.round((height - textHeight) / 2);

  const labelText = makeText(labelLines.join('\n'), theme.FONT_SIZE_LABEL, theme.COLOR_TEXT, false);
  labelText.x = ROW_PAD;
  labelText.width = textWidth;
  labelText.y = textTop;
  labelText.leading = 2;
  sprite.addChild(labelText);

  // The small print is a "?" marker next to the label; the text itself shows
  // when the pointer rests on it.
  let hintMarker: Laya.Sprite | null = null;
  if (hasDescription) {
    hintMarker = createHintMarker(description as string);
    const labelWidth = labelLines.length > 0
      ? estimateTextWidth(labelLines[0], theme.FONT_SIZE_LABEL)
      : 0;
    hintMarker.x = ROW_PAD + labelWidth + 6;
    hintMarker.y = textTop + Math.round((LABEL_LINE_H - HINT_MARKER_HIT) / 2);
    sprite.addChild(hintMarker);
  }

  return {
    sprite,
    height,
    label: labelText,
    hintMarker,
    controlRight: width - ROW_PAD,
    textWidth,
    controlTop: textTop + textHeight + theme.SPACE_SM,
    setEnabled(value: boolean): void {
      enabled = value;
      paintRow(sprite, width, height, value);
      labelText.color = value ? theme.COLOR_TEXT : theme.COLOR_TEXT_DISABLED;
      if (hintMarker !== null) {
        // The marker dims with the row; its text only shows on hover.
        hintMarker.alpha = value ? 1 : 0.45;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// heading / static rows
// ---------------------------------------------------------------------------

/** A section group heading (small, gold, left aligned). */
export function createGroupHeading(text: string, width: number): RowHandle {
  const sprite = new Laya.Sprite();
  const height = theme.SPACE_LG;
  sprite.size(width, height);
  const label = makeText(text, theme.FONT_SIZE_LABEL, theme.COLOR_TITLE, true);
  label.x = 2;
  label.y = theme.SPACE_SM;
  sprite.addChild(label);
  return { sprite, height, setEnabled: () => undefined };
}

/** Static `label .......... value` row (About page). */
export function createInfoRow(width: number, label: string, value: string): RowHandle {
  // Size the value column to the value itself: the product line
  // ("纷争幻想 · Phantasm Klash") is much wider than "MIT", and a fixed split
  // would either clip the long one or starve the label of the short one.
  const valueWidth = Math.min(
    Math.round(width * 0.6),
    Math.max(90, Math.ceil(estimateTextWidth(value, theme.FONT_SIZE_LABEL)) + 8),
  );
  const row = buildRow(width, label, undefined, valueWidth);
  const valueText = makeText(value, theme.FONT_SIZE_LABEL, theme.COLOR_INFO, false);
  valueText.align = 'right';
  valueText.width = valueWidth;
  valueText.x = row.controlRight - valueWidth;
  valueText.y = Math.round((row.height - theme.FONT_SIZE_LABEL) / 2);
  row.sprite.addChild(valueText);
  return { sprite: row.sprite, height: row.height, setEnabled: () => undefined };
}

/** Wrapped, muted explanatory paragraph. Height follows the wrapped line count. */
export function createNoteRow(width: number, text: string): RowHandle {
  const innerWidth = Math.max(0, width - ROW_PAD * 2);
  const lines = wrapText(text, innerWidth, theme.FONT_SIZE_CAPTION);
  const height = Math.max(
    theme.SPACE_LG,
    lines.length * DESC_LINE_H + ROW_PAD_V * 2,
  );
  const sprite = new Laya.Sprite();
  sprite.size(width, height);
  sprite.mouseEnabled = false;
  const label = makeText(lines.join('\n'), theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_DISABLED, false);
  label.x = ROW_PAD;
  label.y = ROW_PAD_V;
  label.width = innerWidth;
  label.leading = 3;
  sprite.addChild(label);
  return { sprite, height, setEnabled: () => undefined };
}

/** Row with a button on the right (used for actions and external links). */
export function createActionRow(
  width: number,
  label: string,
  description: string | undefined,
  buttonLabel: string,
  onClick: () => void,
  tone: 'primary' | 'ghost' | 'danger' = 'ghost',
): RowHandle {
  const buttonWidth = Math.min(150, Math.max(96, Math.round(width * 0.32)));
  const row = buildRow(width, label, description, buttonWidth);
  const buttonH = theme.BUTTON_HEIGHT - 8;

  // The official `Button.lh` prefab when it has loaded; the TNA-styled button
  // otherwise. Unlike the toggle, a button *needs* its label, so the prefab's
  // own text child is written rather than cleared.
  const official = createOfficialWidget('button');
  if (official !== null) {
    official.size(buttonWidth, buttonH);
    official.x = row.controlRight - buttonWidth;
    official.y = Math.round((row.height - buttonH) / 2);
    official.mouseEnabled = true;
    setOfficialText(official, buttonLabel);
    // Repaint the prefab's plate in the TNA palette (and the danger tone when
    // asked). Sprite has no `tint` in this engine build — verified live — so
    // the tone is carried by the fill colour instead.
    skinButton(official, tone === 'danger');
    official.on(Laya.Event.CLICK, undefined, () => onClick());
    row.sprite.addChild(official);
    return {
      sprite: row.sprite,
      height: row.height,
      setEnabled(enabled: boolean): void {
        official.mouseEnabled = enabled;
        official.alpha = enabled ? 1 : 0.45;
      },
    };
  }

  const button = createButton(buttonLabel, row.controlRight - buttonWidth, 0, buttonWidth, onClick);
  button.setSize(buttonWidth, buttonH);
  button.sprite.y = Math.round((row.height - buttonH) / 2);
  if (tone === 'danger') {
    button.setVariant?.('danger');
  }
  row.sprite.addChild(button.sprite);
  return { sprite: row.sprite, height: row.height, setEnabled: (v) => button.setEnabled(v) };
}

// ---------------------------------------------------------------------------
// official-widget helpers
// ---------------------------------------------------------------------------

/**
 * Clears the text a prefab ships with.
 *
 * The engine's `CheckBox.lh` / `Button.lh` carry their own label child, and a
 * settings row already paints its own (translated) label to the left — leaving
 * the prefab's copy would double the text. Only text-bearing children are
 * touched, so the skin graphics survive.
 */
function stripOfficialLabel(widget: Laya.Sprite): void {
  for (let i = 0; i < widget.numChildren; i += 1) {
    const child = widget.getChildAt(i);
    if (child === null || child === undefined) {
      continue;
    }
    const text = child as Laya.Sprite & { text?: unknown };
    if (typeof text.text === 'string') {
      text.text = '';
    }
  }
}

/**
 * Drives a prefab's `selected` state, when it has one.
 *
 * Defensive on purpose: the property is read off a runtime object, and a
 * future prefab that renames it must not throw — it would take the whole
 * settings panel down.
 */
function setOfficialSelected(widget: Laya.Sprite, selected: boolean): void {
  const state = widget as Laya.Sprite & { selected?: unknown };
  if ('selected' in state) {
    state.selected = selected;
  }
}

/** Reads a prefab's `selected` state; `false` when it has none. */
function officialSelected(widget: Laya.Sprite): boolean {
  const state = widget as Laya.Sprite & { selected?: unknown };
  return state.selected === true;
}

/**
 * Finds a direct child of an official widget by name.
 *
 * `name` is read through a widened record: the project's Laya typings do not
 * declare it on `Sprite`, though the engine sets it for every prefab part
 * (`SliderH.lh` names its parts `bg` / `bar` / `grip` / `title`).
 */
function childByName(widget: Laya.Sprite, name: string): Laya.Sprite | null {
  for (let i = 0; i < widget.numChildren; i += 1) {
    const child = widget.getChildAt(i);
    if (child === null || child === undefined) {
      continue;
    }
    if ((child as unknown as { name?: unknown }).name === name) {
      return child;
    }
  }
  return null;
}

/**
 * Writes a prefab's label text, when it has one.
 *
 * Buttons keep their text (the row's own label sits to the left), so this is
 * the counterpart to {@link stripOfficialLabel}. Only the first text-bearing
 * child is written: the engine's button prefab has exactly one, and writing
 * every text child would clobber a future subtitle.
 */
function setOfficialText(widget: Laya.Sprite, text: string): void {
  for (let i = 0; i < widget.numChildren; i += 1) {
    const child = widget.getChildAt(i);
    if (child === null || child === undefined) {
      continue;
    }
    const labelled = child as Laya.Sprite & { text?: unknown };
    if (typeof labelled.text === 'string') {
      labelled.text = text;
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// toggle
// ---------------------------------------------------------------------------

export interface ToggleRowOptions {
  width: number;
  label: string;
  description?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

export function createToggleRow(options: ToggleRowOptions): ToggleRowHandle {
  const row = buildRow(options.width, options.label, options.description, TOGGLE_W + theme.SPACE_MD);

  // The official `CheckBox.lh` prefab (`internal/UI/`) when it has loaded; the
  // hand-painted track otherwise. See `ui_prefabs.ts` for why the prefab — not
  // `Laya.CheckBox`, which does not exist on this engine version — is the
  // official widget here.
  const official = createOfficialWidget('checkbox');
  const track = official ?? new Laya.Sprite();
  track.size(TOGGLE_W, TOGGLE_H);
  if (official !== null) {
    stripOfficialLabel(official);
    // The prefab's skin comes from `comp.atlas` (the engine's light default
    // art); repaint it in the TNA palette so it matches the rest of the panel.
    // Skinned after `size` because the paint derives its corner radius and
    // knob geometry from the widget's own box.
    skinCheckBox(official);
  }
  track.x = row.controlRight - TOGGLE_W;
  track.y = Math.round((row.height - TOGGLE_H) / 2);
  track.mouseEnabled = true;
  row.sprite.addChild(track);

  let value = options.value;
  let enabled = true;

  const paint = (): void => {
    if (official !== null) {
      setOfficialSelected(official, value);
      // The prefab has no "disabled" skin state we can drive, so the greyed
      // look comes from alpha plus hit-testing being switched off.
      official.alpha = enabled ? 1 : 0.45;
      return;
    }
    const g = track.graphics;
    g.clear();
    const on = value;
    // Blue like the option rows and the official checkbox: green read as a
    // different kind of state rather than the same state in another colour.
    const fill = !enabled
      ? theme.COLOR_PANEL_DEEP
      : on
        ? mix(theme.COLOR_INFO, theme.COLOR_VOID, 0.32)
        : theme.COLOR_PANEL_DEEP;
    const border = !enabled
      ? theme.COLOR_DIVIDER
      : on
        ? theme.COLOR_INFO
        : theme.COLOR_PANEL_BORDER;
    VectorPainter.roundedPanel(g, 0, 0, TOGGLE_W, TOGGLE_H, TOGGLE_H / 2, fill, border, 1);
    const knobR = TOGGLE_H / 2 - 3;
    const knobX = on ? TOGGLE_W - knobR - 3 : knobR + 3;
    g.drawCircle(knobX, TOGGLE_H / 2, knobR, enabled ? theme.COLOR_TEXT : theme.COLOR_TEXT_DISABLED);
  };
  paint();

  const flip = (): void => {
    if (!enabled) {
      return;
    }
    // On the official prefab the widget owns the state: **it toggles
    // `selected` itself on CLICK** (verified live: false → true → false over
    // two clicks), so the value is only read back. Toggling it here as well
    // would cancel the widget's own change and leave the switch dead.
    if (official !== null) {
      value = officialSelected(official);
      options.onChange(value);
      return;
    }
    value = !value;
    paint();
    options.onChange(value);
  };
  track.on(Laya.Event.CLICK, undefined, flip);

  return {
    sprite: row.sprite,
    height: row.height,
    setEnabled(next: boolean): void {
      enabled = next;
      track.mouseEnabled = next;
      row.setEnabled(next);
      paint();
    },
    setValue(next: boolean): void {
      value = next;
      paint();
    },
  };
}

// ---------------------------------------------------------------------------
// segmented option
// ---------------------------------------------------------------------------

export interface OptionChoice<T extends string | number> {
  id: T;
  label: string;
}

export interface OptionRowOptions<T extends string | number> {
  width: number;
  label: string;
  description?: string;
  choices: readonly OptionChoice<T>[];
  value: T;
  onChange: (value: T) => void;
}

interface Segment<T extends string | number> {
  readonly id: T;
  readonly sprite: Laya.Sprite;
  readonly label: Laya.Text;
}

export function createOptionRow<T extends string | number>(options: OptionRowOptions<T>): OptionRowHandle<T> {
  // Size every segment to the widest label so nothing is clipped. A fixed
  // per-segment width would truncate "Uncapped" while "1×" wasted its box.
  const widestLabel = options.choices.reduce(
    (widest, choice) => Math.max(widest, estimateTextWidth(choice.label, theme.FONT_SIZE_CAPTION)),
    0,
  );
  const segmentWidth = Math.ceil(widestLabel + OPTION_PAD * 2);

  // Always stacked: a four-way segmented control eats ~300px, which would leave
  // the description an unreadably narrow column beside it. On its own line the
  // text gets the full row width and the segments read as a proper control.
  const row = buildRow(options.width, options.label, options.description, 0, OPTION_H);

  const segments: Segment<T>[] = [];
  let selected = options.value;
  let enabled = true;
  const startX = ROW_PAD;
  const y = row.controlTop;

  const paint = (): void => {
    for (const segment of segments) {
      const active = segment.id === selected;
      const g = segment.sprite.graphics;
      g.clear();
      // The selected segment is **blue**, not gold. Gold was the panel's
      // accent, and next to the blue toggles it read as a different kind of
      // control; blue is the colour the panel uses for "this one is on".
      const fill = !enabled
        ? theme.COLOR_PANEL_DEEP
        : active
          ? mix(theme.COLOR_PANEL, theme.COLOR_INFO, 0.38)
          : theme.COLOR_PANEL_DEEP;
      const border = !enabled
        ? theme.COLOR_DIVIDER
        : active
          ? theme.COLOR_INFO
          : theme.COLOR_PANEL_BORDER;
      VectorPainter.roundedPanel(g, 0, 0, segmentWidth, OPTION_H, theme.RADIUS_SM, fill, border, active ? 2 : 1);
      segment.label.color = !enabled
        ? theme.COLOR_TEXT_DISABLED
        : active
          ? theme.COLOR_TITLE
          : theme.COLOR_TEXT;
    }
  };

  options.choices.forEach((choice, index) => {
    const sprite = new Laya.Sprite();
    sprite.size(segmentWidth, OPTION_H);
    sprite.pos(startX + index * segmentWidth, y);
    sprite.mouseEnabled = true;
    const label = makeText(choice.label, theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT, false);
    label.align = 'center';
    label.valign = 'middle';
    label.width = segmentWidth;
    label.height = OPTION_H;
    sprite.addChild(label);
    sprite.on(Laya.Event.CLICK, undefined, () => {
      if (!enabled || selected === choice.id) {
        return;
      }
      selected = choice.id;
      paint();
      options.onChange(choice.id);
    });
    row.sprite.addChild(sprite);
    segments.push({ id: choice.id, sprite, label });
  });
  paint();

  return {
    sprite: row.sprite,
    height: row.height,
    setEnabled(next: boolean): void {
      enabled = next;
      for (const segment of segments) {
        segment.sprite.mouseEnabled = next;
      }
      row.setEnabled(next);
      paint();
    },
    setSelected(id: T): void {
      selected = id;
      paint();
    },
  };
}

// ---------------------------------------------------------------------------
// slider
// ---------------------------------------------------------------------------

export interface SliderRowOptions {
  width: number;
  label: string;
  description?: string;
  /** 0..1 */
  value: number;
  /** Quantisation step, default 0.05. */
  step?: number;
  /** Formats the readout; defaults to a percentage. */
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

export function createSliderRow(options: SliderRowOptions): SliderRowHandle {
  const controlWidth = SLIDER_W + theme.SPACE_SM + SLIDER_VALUE_W;
  const row = buildRow(options.width, options.label, options.description, controlWidth + theme.SPACE_MD);
  const step = options.step !== undefined && options.step > 0 ? options.step : 0.05;
  const format = options.format ?? ((value: number): string => `${Math.round(value * 100)}%`);

  // The hit box is taller than the painted bar so a drag does not fall out of
  // the control the moment the pointer drifts vertically.
  //
  // The official `SliderH.lh` prefab is used when it has loaded: it ships
  // `bg`/`bar`/`grip` parts, which are repainted in the TNA palette. The row
  // still owns the value (quantisation, `format`, `onChange`), so the prefab is
  // the control's body and hit box, not a second source of truth.
  const officialSlider = createOfficialWidget('sliderH');
  const track = officialSlider ?? new Laya.Sprite();
  track.size(SLIDER_W, SLIDER_HIT_H);
  // Skin *after* the size is set: `skinSliderH` scales the knob from the track
  // height, so it has to see the final box rather than the prefab's own 32.
  if (officialSlider !== null) {
    skinSliderH(officialSlider);
  }
  track.x = row.controlRight - controlWidth;
  track.y = Math.round((row.height - SLIDER_HIT_H) / 2);
  track.mouseEnabled = true;
  row.sprite.addChild(track);

  // TNA 滑杆三件套（`ui/sliderTrack|Progress|Thumb.png`）：轨道与已填充段
  // 用非等比拉伸 + 左裁（不压扁胶囊端头），滑块等比缩放。三者都到位才替换
  // 矢量轨道；缺图时保留原来的矢量绘制（`docs/ART_POLICY.md` 的骨架例外）。
  const trackArt = new TnaUiImage();
  trackArt.setAnchor(0, 0.5);
  track.addChild(trackArt.sprite);
  const fillArt = new TnaUiImage();
  fillArt.setAnchor(0, 0.5);
  track.addChild(fillArt.sprite);
  const knobArt = new TnaUiImage();
  track.addChild(knobArt.sprite);
  stretchArt(trackArt, UI_SLIDER_TRACK, SLIDER_W, SLIDER_BAR_H);
  stretchArt(fillArt, UI_SLIDER_PROGRESS, SLIDER_W, SLIDER_BAR_H);
  knobArt.setImage(UI_SLIDER_THUMB, SLIDER_KNOB_R * 2);

  const valueText = makeText(format(options.value), theme.FONT_SIZE_CAPTION, theme.COLOR_INFO, false);
  valueText.align = 'right';
  valueText.width = SLIDER_VALUE_W;
  valueText.x = row.controlRight - SLIDER_VALUE_W;
  valueText.y = Math.round((row.height - theme.FONT_SIZE_CAPTION) / 2);
  row.sprite.addChild(valueText);

  let value = clamp01(options.value);
  let enabled = true;
  let dragging = false;

  /**
   * 只在文本真的变化时写回。
   *
   * `Text.text` 的赋值会重排并重建这行字的纹理，而 `paint()` 在拖动时由每个
   * `MOUSE_MOVE` 触发 —— 无条件赋值等于每帧重建一次读数纹理。
   */
  const setReadout = (text: string): void => {
    if (valueText.text !== text) {
      valueText.text = text;
    }
  };

  const paint = (): void => {
    const barY = (SLIDER_HIT_H - SLIDER_BAR_H) / 2;
    const filled = Math.round(SLIDER_W * value);
    // The knob's centre travels within `[KNOB_R, W - KNOB_R]` so it stays inside
    // the track at both ends, while the fill still spans the full width —
    // clamping to `W - KNOB_R` would leave the last `KNOB_R` pixels unfilled.
    const travel = SLIDER_W - SLIDER_KNOB_R * 2;
    const knobX = SLIDER_KNOB_R + Math.round(travel * value);

    // ★ 两套视觉，二选一 —— 不能都画。
    //
    // 官方 `SliderH.lh` 预制体自带 bg/bar/grip 三个部件（bar 被 `skinSliderH`
    // 重绘成金色），而上面又叠了 TNA 三件套（轨道 / 蓝色进度段 / 滑块）。
    // 两套都画的话，同一条轨道上会出现一金一蓝两条填充段；更糟的是原来走到
    // 官方分支就 `return`，TNA 那套永远得不到定位与裁剪，于是两条都留在屏幕上。
    //
    // 所以：TNA 美术到位就用 TNA（官方部件隐藏），否则退回官方部件。任何时刻
    // 只有一条填充段。
    const useTna = trackArt.isReady && fillArt.isReady && knobArt.isReady;
    if (officialSlider !== null) {
      for (const name of ['bg', 'bar', 'grip']) {
        const part = childByName(officialSlider, name);
        if (part !== null && part.visible !== !useTna) {
          part.visible = !useTna;
        }
      }
      if (!useTna) {
        // The parts are scaled/positioned rather than repainted each frame —
        // their art was already replaced with the TNA paint by `skinSliderH`.
        const bar = childByName(officialSlider, 'bar');
        if (bar !== null) {
          // The part's own box is the prefab's 200-wide frame, so scale from the
          // track the row actually sized — otherwise the fill overruns it.
          const width = Math.max(0.001, SLIDER_W * value);
          if (bar.width !== width) {
            bar.width = width;
          }
          const visible = value > 0;
          if (bar.visible !== visible) {
            bar.visible = visible;
          }
        }
        const grip = childByName(officialSlider, 'grip');
        if (grip !== null) {
          grip.x = knobX - grip.width / 2;
          const alpha = enabled ? 1 : 0.45;
          if (grip.alpha !== alpha) {
            grip.alpha = alpha;
          }
        }
      }
    }
    // TNA 美术优先：轨道 + 已填充段 + 滑块都就绪时不再画矢量条。
    if (useTna) {
      const centerY = barY + SLIDER_BAR_H / 2;
      trackArt.sprite.pos(0, centerY);
      fillArt.sprite.pos(0, centerY);
      fillArt.setCrop(value);
      const visible = value > 0;
      if (fillArt.sprite.visible !== visible) {
        fillArt.sprite.visible = visible;
      }
      const alpha = enabled ? 1 : 0.45;
      if (fillArt.sprite.alpha !== alpha) {
        fillArt.sprite.alpha = alpha;
      }
      knobArt.sprite.pos(knobX, SLIDER_HIT_H / 2);
      if (knobArt.sprite.alpha !== alpha) {
        knobArt.sprite.alpha = alpha;
      }
      setReadout(format(value));
      return;
    }
    if (officialSlider !== null) {
      // 官方部件已经在画轨道、填充和滑块，别再叠一层矢量。
      setReadout(format(value));
      return;
    }
    // 只有真的要画矢量时才清：无条件的 `clear()` 会把这个 sprite 的图形标记
    // 为失效，而 TNA / 官方部件两条路径根本不往里画东西。
    const g = track.graphics;
    g.clear();
    VectorPainter.roundedPanel(g, 0, barY, SLIDER_W, SLIDER_BAR_H, SLIDER_BAR_H / 2, theme.COLOR_PANEL_DEEP, theme.COLOR_DIVIDER, 1);
    if (filled > 0) {
      const fill = enabled ? theme.COLOR_INFO : theme.COLOR_TEXT_DISABLED;
      VectorPainter.roundedPanel(g, 0, barY, Math.max(SLIDER_BAR_H, filled), SLIDER_BAR_H, SLIDER_BAR_H / 2, fill, undefined, 0);
    }
    g.drawCircle(knobX, SLIDER_HIT_H / 2, SLIDER_KNOB_R, enabled ? theme.COLOR_TEXT : theme.COLOR_TEXT_DISABLED);
    setReadout(format(value));
  };
  paint();
  // 美术是异步到的：到位后重画一次，把矢量条换成 TNA 条。
  void Promise.all([trackArt.whenSettled(), fillArt.whenSettled(), knobArt.whenSettled()]).then(() => paint());

  /** Maps a local x inside the track onto a quantised 0..1 value. */
  const applyFromLocalX = (localX: number): void => {
    // Same travel the knob uses, so a click lands on the value it appears to.
    const travel = SLIDER_W - SLIDER_KNOB_R * 2;
    const raw = Math.min(1, Math.max(0, (localX - SLIDER_KNOB_R) / travel));
    const quantised = clamp01(Math.round(raw / step) * step);
    if (quantised === value) {
      return;
    }
    value = quantised;
    paint();
    options.onChange(value);
  };

  // `Sprite.mouseX` is the pointer in the sprite's own space, so no global
  // coordinate maths is needed (see the shim's note on `mouseX`).
  //
  // `stopPropagation` matters: mouse events bubble up the ancestor chain, and
  // the panel's viewport listens for `MOUSE_DOWN` to start a drag-scroll. A
  // slider drag that also scrolled the list would make the control unusable,
  // so the press is claimed here. `CLICK` is a separate dispatch and still
  // reaches the control.
  track.on(Laya.Event.MOUSE_DOWN, undefined, (...args: unknown[]) => {
    // `Sprite.on` types the handler as `(...args: unknown[]) => void`, so the
    // event is narrowed here rather than declared in the signature — a
    // parameter typed `MouseEventLike` is not assignable to `unknown`.
    const event = args[0] as Laya.MouseEventLike | undefined;
    event?.stopPropagation?.();
    if (!enabled) {
      return;
    }
    dragging = true;
    applyFromLocalX(track.mouseX);
    armRelease();
  });
  track.on(Laya.Event.MOUSE_MOVE, undefined, () => {
    if (!enabled || !dragging) {
      return;
    }
    applyFromLocalX(track.mouseX);
  });
  track.on(Laya.Event.MOUSE_UP, undefined, () => {
    dragging = false;
  });

  // Releasing outside the control (or outside the row) must still end the drag,
  // otherwise the next hover would silently keep editing the value. The listener
  // is armed per drag and removes itself, so nothing leaks.
  let releaseArmed = false;
  const armRelease = (): void => {
    if (releaseArmed) {
      return;
    }
    releaseArmed = true;
    const onRelease = (): void => {
      dragging = false;
      releaseArmed = false;
      Laya.stage.off(Laya.Event.MOUSE_UP, undefined, onRelease);
    };
    Laya.stage.on(Laya.Event.MOUSE_UP, undefined, onRelease);
  };

  return {
    sprite: row.sprite,
    height: row.height,
    setEnabled(next: boolean): void {
      enabled = next;
      track.mouseEnabled = next;
      row.setEnabled(next);
      paint();
    },
    setValue(next: number): void {
      value = clamp01(next);
      paint();
    },
  };
}

// ---------------------------------------------------------------------------
// text field
// ---------------------------------------------------------------------------

export interface TextRowOptions {
  width: number;
  label: string;
  description?: string;
  value: string;
  placeholder?: string;
  maxChars?: number;
  onChange: (value: string) => void;
}

export function createTextRow(options: TextRowOptions): TextRowHandle {
  const fieldWidth = Math.min(220, Math.max(120, Math.round(options.width * 0.42)));
  const row = buildRow(options.width, options.label, options.description, fieldWidth + theme.SPACE_MD);

  const fieldH = theme.BUTTON_HEIGHT - 8;
  const frame = new Laya.Sprite();
  frame.size(fieldWidth, fieldH);
  frame.x = row.controlRight - fieldWidth;
  frame.y = Math.round((row.height - fieldH) / 2);
  VectorPainter.roundedPanel(
    frame.graphics,
    0,
    0,
    fieldWidth,
    fieldH,
    theme.RADIUS_SM,
    theme.COLOR_FIELD_BG,
    theme.COLOR_FIELD_BORDER,
    1,
  );
  row.sprite.addChild(frame);

  // `Laya.Input` (not `Laya.TextInput`) — the native runtime does not ship the
  // latter. See `client-notes.md` §5.
  const input = new Laya.Input();
  input.editable = true;
  input.type = 'text';
  input.prompt = options.placeholder ?? '';
  input.promptColor = theme.COLOR_TEXT_DISABLED;
  input.maxChars = options.maxChars ?? 128;
  input.color = theme.COLOR_TEXT;
  input.fontSize = theme.FONT_SIZE_CAPTION;
  input.valign = 'middle';
  input.align = 'left';
  input.mouseEnabled = true;
  input.x = frame.x + theme.SPACE_SM;
  input.y = frame.y;
  input.size(fieldWidth - theme.SPACE_SM * 2, fieldH);
  input.text = options.value;
  row.sprite.addChild(input);

  // Same click-to-caret fix the login form uses: without it, clicking the middle
  // of a long endpoint URL drops the caret at the end of the string.
  attachCaretPlacement(input);

  input.on(Laya.Event.CHANGE, undefined, () => {
    options.onChange(input.text);
  });

  return {
    sprite: row.sprite,
    height: row.height,
    setEnabled(next: boolean): void {
      input.mouseEnabled = next;
      row.setEnabled(next);
      frame.graphics.clear();
      VectorPainter.roundedPanel(
        frame.graphics,
        0,
        0,
        fieldWidth,
        fieldH,
        theme.RADIUS_SM,
        theme.COLOR_FIELD_BG,
        next ? theme.COLOR_FIELD_BORDER : theme.COLOR_DIVIDER,
        1,
      );
    },
    setValue(next: string): void {
      if (input.text !== next) {
        input.text = next;
      }
    },
  };
}

/** Re-exported so sections do not each import `ui_kit` just for the type. */
export type { ButtonHandle };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
