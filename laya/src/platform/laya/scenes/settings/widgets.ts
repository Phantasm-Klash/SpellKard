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
 * There is no `laya.ui` here on purpose — the native runtime does not load it.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` except plain data.
 */

import * as theme from '../../view/theme';
import { VectorPainter, mix } from '../../view/sprites';
import { TnaUiImage } from '../../view/tna_ui';
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
const TOGGLE_H = 24;
/** Width of the slider control (its hit box; the bar drawn inside is thinner). */
const SLIDER_W = 150;
const SLIDER_HIT_H = 34;
const SLIDER_BAR_H = 6;
const SLIDER_KNOB_R = 8;
/** Width of the value readout next to a slider. */
const SLIDER_VALUE_W = 46;
/** Horizontal padding inside one segmented option button. */
const OPTION_PAD = 8;
const OPTION_H = 26;

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
  readonly description: Laya.Text | null;
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
  const descLines = hasDescription
    ? wrapText(description as string, textWidth, theme.FONT_SIZE_CAPTION)
    : [];
  const textHeight =
    labelLines.length * LABEL_LINE_H + (descLines.length > 0 ? 2 + descLines.length * DESC_LINE_H : 0);

  const height = Math.round(
    Math.max(
      hasDescription ? ROW_HEIGHT : ROW_HEIGHT_COMPACT,
      textHeight + ROW_PAD_V * 2,
      stacked ? textHeight + theme.SPACE_SM + stackedControlHeight + ROW_PAD_V * 2 : 0,
    ),
  );

  const sprite = new Laya.Sprite();
  sprite.size(width, height);
  // The row itself is not a target: the control inside it is. Leaving the
  // background click-through keeps a stray tap from being swallowed.
  sprite.mouseEnabled = false;

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

  let descriptionText: Laya.Text | null = null;
  if (hasDescription) {
    descriptionText = makeText(descLines.join('\n'), theme.FONT_SIZE_CAPTION, theme.COLOR_TEXT_MUTED, false);
    descriptionText.x = ROW_PAD;
    descriptionText.width = textWidth;
    descriptionText.y = textTop + labelLines.length * LABEL_LINE_H + 2;
    descriptionText.leading = 3;
    sprite.addChild(descriptionText);
  }

  return {
    sprite,
    height,
    label: labelText,
    description: descriptionText,
    controlRight: width - ROW_PAD,
    textWidth,
    controlTop: textTop + textHeight + theme.SPACE_SM,
    setEnabled(value: boolean): void {
      enabled = value;
      paintRow(sprite, width, height, value);
      labelText.color = value ? theme.COLOR_TEXT : theme.COLOR_TEXT_DISABLED;
      if (descriptionText !== null) {
        descriptionText.color = value ? theme.COLOR_TEXT_MUTED : theme.COLOR_TEXT_DISABLED;
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
  const button = createButton(buttonLabel, row.controlRight - buttonWidth, 0, buttonWidth, onClick);
  const buttonH = theme.BUTTON_HEIGHT - 8;
  button.setSize(buttonWidth, buttonH);
  button.sprite.y = Math.round((row.height - buttonH) / 2);
  if (tone === 'danger') {
    button.setVariant?.('danger');
  }
  row.sprite.addChild(button.sprite);
  return { sprite: row.sprite, height: row.height, setEnabled: (v) => button.setEnabled(v) };
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

  const track = new Laya.Sprite();
  track.size(TOGGLE_W, TOGGLE_H);
  track.x = row.controlRight - TOGGLE_W;
  track.y = Math.round((row.height - TOGGLE_H) / 2);
  track.mouseEnabled = true;
  row.sprite.addChild(track);

  let value = options.value;
  let enabled = true;

  const paint = (): void => {
    const g = track.graphics;
    g.clear();
    const on = value;
    const fill = !enabled
      ? theme.COLOR_PANEL_DEEP
      : on
        ? mix(theme.COLOR_SUCCESS, theme.COLOR_VOID, 0.15)
        : theme.COLOR_PANEL_DEEP;
    const border = !enabled ? theme.COLOR_DIVIDER : on ? theme.COLOR_SUCCESS : theme.COLOR_PANEL_BORDER;
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
      const fill = !enabled
        ? theme.COLOR_PANEL_DEEP
        : active
          ? mix(theme.COLOR_PANEL, theme.COLOR_ACCENT, 0.3)
          : theme.COLOR_PANEL_DEEP;
      const border = !enabled ? theme.COLOR_DIVIDER : active ? theme.COLOR_ACCENT : theme.COLOR_PANEL_BORDER;
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
  const track = new Laya.Sprite();
  track.size(SLIDER_W, SLIDER_HIT_H);
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

  const paint = (): void => {
    const g = track.graphics;
    g.clear();
    const barY = (SLIDER_HIT_H - SLIDER_BAR_H) / 2;
    const filled = Math.round(SLIDER_W * value);
    const knobX = Math.min(SLIDER_W - SLIDER_KNOB_R, Math.max(SLIDER_KNOB_R, filled));
    // TNA 美术优先：轨道 + 已填充段 + 滑块都就绪时不再画矢量条。
    if (trackArt.isReady && fillArt.isReady && knobArt.isReady) {
      const centerY = barY + SLIDER_BAR_H / 2;
      trackArt.sprite.pos(0, centerY);
      fillArt.sprite.pos(0, centerY);
      fillArt.setCrop(value);
      fillArt.sprite.visible = value > 0;
      fillArt.sprite.alpha = enabled ? 1 : 0.45;
      knobArt.sprite.pos(knobX, SLIDER_HIT_H / 2);
      knobArt.sprite.alpha = enabled ? 1 : 0.45;
      valueText.text = format(value);
      return;
    }
    VectorPainter.roundedPanel(g, 0, barY, SLIDER_W, SLIDER_BAR_H, SLIDER_BAR_H / 2, theme.COLOR_PANEL_DEEP, theme.COLOR_DIVIDER, 1);
    if (filled > 0) {
      const fill = enabled ? theme.COLOR_ACCENT : theme.COLOR_TEXT_DISABLED;
      VectorPainter.roundedPanel(g, 0, barY, Math.max(SLIDER_BAR_H, filled), SLIDER_BAR_H, SLIDER_BAR_H / 2, fill, undefined, 0);
    }
    g.drawCircle(knobX, SLIDER_HIT_H / 2, SLIDER_KNOB_R, enabled ? theme.COLOR_TEXT : theme.COLOR_TEXT_DISABLED);
    valueText.text = format(value);
  };
  paint();
  // 美术是异步到的：到位后重画一次，把矢量条换成 TNA 条。
  void Promise.all([trackArt.whenSettled(), fillArt.whenSettled(), knobArt.whenSettled()]).then(() => paint());

  /** Maps a local x inside the track onto a quantised 0..1 value. */
  const applyFromLocalX = (localX: number): void => {
    const raw = Math.min(1, Math.max(0, localX / SLIDER_W));
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
  track.on(Laya.Event.MOUSE_DOWN, undefined, () => {
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
