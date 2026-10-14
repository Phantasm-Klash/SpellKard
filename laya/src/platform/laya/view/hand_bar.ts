/**
 * Hand bar: the local player's opening hand as a strip of cast slots plus the
 * opening-energy readout, laid along the bottom of the playfield.
 *
 * The view is a thin adapter over `core/game/card_hand_view`: the core model
 * owns *what* the slots are (and refuses a click on an empty slot); this file
 * owns only *how* they look and where a click lands. Clicking a filled slot
 * reports its 0-based index to `onSlotClick`, which the scene turns into a
 * one-shot cast intent — the bar itself never decides whether a cast is legal.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`.
 */

import type { HandBarView, HandSlotView } from '../../../core/game/card_hand_view';
import { VectorPainter } from './sprites';
import * as theme from './theme';

/** Where the bar sits: spanning the playfield width, hugging its bottom edge. */
export interface HandBarLayout {
  /** Left edge of the playfield. */
  x: number;
  /** Bottom edge of the playfield (the bar sits directly above it). */
  bottom: number;
  /** Width of the playfield. */
  width: number;
}

/** Bar height in pixels. */
const BAR_HEIGHT = 56;
/** Slot box height in pixels. */
const SLOT_HEIGHT = 44;
/** Width reserved on the left for the energy readout. */
const ENERGY_WIDTH = 56;
/** Preferred slot width; shrunk when the playfield is narrow. */
const SLOT_WIDTH_MAX = 84;
/** Gap between the energy readout and the slots, and between slots. */
const GAP = theme.SPACE_SM;
/** Characters a slot label shows before it is truncated with an ellipsis. */
const LABEL_MAX_CHARS = 10;

export class HandBar {
  readonly root: Laya.Sprite;
  /** Called with the 0-based slot index when a filled slot is clicked. */
  onSlotClick: ((index: number) => void) | null = null;

  private readonly slotLayer: Laya.Sprite;
  private readonly energyText: Laya.Text;
  private readonly slotSprites: Laya.Sprite[] = [];
  private layout: HandBarLayout = { x: 0, bottom: 0, width: 0 };
  private view: HandBarView | null = null;

  constructor() {
    this.root = new Laya.Sprite();
    // The bar is a passive strip: only its slot sprites are click targets, so a
    // click between them falls through to whatever is underneath.
    this.root.mouseEnabled = false;

    this.slotLayer = new Laya.Sprite();
    this.slotLayer.mouseEnabled = false;
    this.root.addChild(this.slotLayer);

    this.energyText = new Laya.Text();
    this.energyText.fontSize = theme.FONT_SIZE_CAPTION;
    this.energyText.bold = true;
    this.energyText.color = theme.COLOR_ACCENT;
    this.energyText.align = 'center';
    this.energyText.valign = 'middle';
    this.energyText.visible = false;
    this.root.addChild(this.energyText);

    this.root.visible = false;
  }

  /** Re-tiles the bar for a new playfield box (called on every relayout). */
  relayout(layout: HandBarLayout): void {
    this.layout = layout;
    this.root.pos(layout.x, layout.bottom - BAR_HEIGHT);
    this.root.size(layout.width, BAR_HEIGHT);
    this.redraw();
  }

  /** Installs the latest model; a hidden view draws nothing. */
  setView(view: HandBarView): void {
    this.view = view;
    this.redraw();
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private redraw(): void {
    const view = this.view;
    const visible = view !== null && view.visible && this.layout.width > 0;
    this.root.visible = visible;
    if (!visible || view === null) {
      return;
    }

    const g = this.root.graphics;
    g.clear();
    // Backing strip so the slots read against the playfield art.
    VectorPainter.roundedPanel(
      g,
      0,
      0,
      this.layout.width,
      BAR_HEIGHT,
      theme.RADIUS_SM,
      theme.COLOR_PANEL_DEEP,
      theme.COLOR_PANEL_BORDER,
      1,
    );

    this.energyText.text = `EN ${formatEnergy(view.energy)}`;
    this.energyText.pos(0, 0);
    this.energyText.size(ENERGY_WIDTH, BAR_HEIGHT);
    this.energyText.visible = true;

    const slots = view.slots;
    const slotWidth = this.slotWidth(slots.length);
    for (let i = 0; i < slots.length; i += 1) {
      const sprite = this.slotSprite(i);
      sprite.visible = true;
      sprite.pos(ENERGY_WIDTH + GAP + i * (slotWidth + GAP), (BAR_HEIGHT - SLOT_HEIGHT) / 2);
      sprite.size(slotWidth, SLOT_HEIGHT);
      this.drawSlot(sprite, slots[i], slotWidth);
    }
    for (let i = slots.length; i < this.slotSprites.length; i += 1) {
      this.slotSprites[i].visible = false;
    }
  }

  /** Slot width that fits `count` slots in the space right of the readout. */
  private slotWidth(count: number): number {
    if (count <= 0) {
      return SLOT_WIDTH_MAX;
    }
    const available = this.layout.width - ENERGY_WIDTH - GAP * (count + 1);
    return Math.max(24, Math.min(SLOT_WIDTH_MAX, available / count));
  }

  private drawSlot(sprite: Laya.Sprite, slot: HandSlotView, width: number): void {
    const g = sprite.graphics;
    g.clear();
    VectorPainter.roundedPanel(g, 0, 0, width, SLOT_HEIGHT, theme.RADIUS_SM, theme.COLOR_PANEL, theme.COLOR_PANEL_BORDER, 1);
    const size = theme.FONT_SIZE_CAPTION;
    g.fillText(
      truncate(slot.cardId, LABEL_MAX_CHARS),
      width / 2,
      theme.SPACE_SM,
      theme.font(size, true),
      theme.COLOR_TEXT,
      'center',
    );
    // The slot number matches the wire value the click sends (1-based on screen
    // so it lines up with the keyboard's number keys).
    g.fillText(
      String(slot.index + 1),
      theme.SPACE_XS,
      SLOT_HEIGHT - size - theme.SPACE_XS,
      theme.font(size),
      theme.COLOR_ACCENT,
      'left',
    );
    if (slot.rarity !== '') {
      g.fillText(
        rarityShort(slot.rarity),
        width - theme.SPACE_XS,
        SLOT_HEIGHT - size - theme.SPACE_XS,
        theme.font(size),
        theme.COLOR_TEXT_MUTED,
        'right',
      );
    }
  }

  private slotSprite(index: number): Laya.Sprite {
    const existing = this.slotSprites[index];
    if (existing !== undefined) {
      return existing;
    }
    const sprite = new Laya.Sprite();
    const slotIndex = index;
    sprite.on(Laya.Event.CLICK, undefined, () => this.onSlotClick?.(slotIndex));
    this.slotLayer.addChild(sprite);
    this.slotSprites.push(sprite);
    return sprite;
  }
}

/** Energy is a server number; show integers plainly and fractions with one digit. */
function formatEnergy(energy: number): string {
  return Number.isInteger(energy) ? String(energy) : energy.toFixed(1);
}

/** First letter(s) of a rarity, so the badge fits a narrow slot. */
function rarityShort(rarity: string): string {
  return rarity.slice(0, 3).toUpperCase();
}

/** Truncates a label to `max` characters with a trailing ellipsis. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
