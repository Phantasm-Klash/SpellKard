/**
 * Hand bar: the local player's hand as a strip of cast slots, plus the energy
 * readout and (when the hand is snapshot-driven) the draw / use buttons.
 *
 * ## Official widgets
 *
 * The controls are the engine's own prefabs (`internal/UI/Button.lh`, via
 * `ui/official_widgets`), re-skinned into the TNA palette by
 * `ui/official_skin.skinButton`. This engine build has no `Laya.Button` /
 * `laya.ui` (see `ui/official_widgets.ts` for the verified details), so the
 * prefab library is the official component set; hand-painting a clickable
 * sprite is exactly what we must not do. When the prefab has not loaded yet
 * (or a build ships without `internal/UI`), each control falls back to the
 * previous vector slot so the bar is never blank or dead.
 *
 * ## What this file owns
 *
 * Only *how* the bar looks and where a click lands. The core model
 * (`core/game/card_hand_view`) owns what the slots are, whether a draw is
 * allowed yet, and what a click means; the scene turns those callbacks into
 * `cardDraw` / `cardSelect` / `cardUse` on the next input packet.
 *
 * NOTE: `platform/laya/` only. Never import from `core/`'s engine-free layer
 * except the models it exposes.
 */

import { HAND_DECK_UNKNOWN, type HandBarView, type HandSlotView } from '../../../core/game/card_hand_view';
import { BOSS_RACE_TICK_RATE_HZ } from '../../../core/sim/boss_race';
import { t } from '../../../core/game/i18n';
import { createOfficialWidget } from '../ui/official_widgets';
import { skinButton } from '../ui/official_skin';
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
/** Width of the draw / use buttons on the right. */
const ACTION_WIDTH = 52;
/** Gap between the energy readout and the slots, and between slots. */
const GAP = theme.SPACE_SM;
/** Characters a slot label shows before it is truncated with an ellipsis. */
const LABEL_MAX_CHARS = 10;

/** One slot's widgets: the clickable control plus its selection marker. */
interface SlotControl {
  root: Laya.Sprite;
  /** Official prefab instance, or `null` when the vector fallback is in use. */
  official: Laya.Sprite | null;
  /** Accent underline shown while the slot is selected. */
  marker: Laya.Sprite;
  /** 1-based slot number (matches the keyboard's number keys). */
  indexText: Laya.Text;
}

export class HandBar {
  readonly root: Laya.Sprite;
  /** Called with the 0-based slot index when a filled slot is clicked. */
  onSlotClick: ((index: number) => void) | null = null;
  /** Called when the draw button is clicked (snapshot-driven hands only). */
  onDraw: (() => void) | null = null;
  /** Called when the use button is clicked (snapshot-driven hands only). */
  onUse: (() => void) | null = null;

  private readonly slotLayer: Laya.Sprite;
  private readonly actionLayer: Laya.Sprite;
  private readonly energyText: Laya.Text;
  private readonly slotControls: SlotControl[] = [];
  private drawButton: Laya.Sprite | null = null;
  private useButton: Laya.Sprite | null = null;
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

    this.actionLayer = new Laya.Sprite();
    this.actionLayer.mouseEnabled = false;
    this.root.addChild(this.actionLayer);

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

    const actionWidth = view.showActions ? ACTION_WIDTH * 2 + GAP * 2 : 0;
    const slots = view.slots;
    const slotWidth = this.slotWidth(slots.length, actionWidth);
    for (let i = 0; i < slots.length; i += 1) {
      const control = this.slotControl(i);
      const x = ENERGY_WIDTH + GAP + i * (slotWidth + GAP);
      const y = (BAR_HEIGHT - SLOT_HEIGHT) / 2;
      control.root.visible = true;
      control.root.pos(x, y);
      control.root.size(slotWidth, SLOT_HEIGHT);
      this.paintSlot(control, slots[i], slotWidth, view.selectedSlot === slots[i].index);
    }
    for (let i = slots.length; i < this.slotControls.length; i += 1) {
      this.slotControls[i].root.visible = false;
    }

    this.redrawActions(view, actionWidth);
  }

  /** Slot width that fits `count` slots in the space right of the readout. */
  private slotWidth(count: number, actionWidth: number): number {
    if (count <= 0) {
      return SLOT_WIDTH_MAX;
    }
    const available = this.layout.width - ENERGY_WIDTH - actionWidth - GAP * (count + 1);
    return Math.max(24, Math.min(SLOT_WIDTH_MAX, available / count));
  }

  /**
   * Draws (or updates) the draw / use buttons.
   *
   * Both are official Button prefabs. The draw button doubles as the deck /
   * cooldown readout — digits only, so no prose has to be translated — and is
   * greyed (`mouseEnabled = false`, alpha 0.45) while the server's
   * `draw_cooldown_ticks` has not elapsed. The use button carries the existing
   * `ui.use` string from the shared table (no new i18n key, no hard-coded copy).
   */
  private redrawActions(view: HandBarView, actionWidth: number): void {
    if (!view.showActions || actionWidth <= 0) {
      if (this.drawButton !== null) {
        this.drawButton.visible = false;
      }
      if (this.useButton !== null) {
        this.useButton.visible = false;
      }
      return;
    }
    const y = (BAR_HEIGHT - SLOT_HEIGHT) / 2;
    const drawX = this.layout.width - actionWidth + GAP;
    const useX = this.layout.width - ACTION_WIDTH;

    const draw = this.ensureActionButton('draw', drawX, y);
    if (draw !== null) {
      draw.visible = true;
      draw.pos(drawX, y);
      draw.size(ACTION_WIDTH, SLOT_HEIGHT);
      setWidgetText(draw, this.drawLabel(view));
      setWidgetEnabled(draw, view.canDraw);
    }

    const use = this.ensureActionButton('use', useX, y);
    if (use !== null) {
      use.visible = true;
      use.pos(useX, y);
      use.size(ACTION_WIDTH, SLOT_HEIGHT);
      setWidgetText(use, t('ui.use'));
      setWidgetEnabled(use, view.canUse);
    }
  }

  /**
   * Draw button label: deck count while ready, remaining seconds while cooling
   * down. Both are numeric (plus a `+` / `s` glyph), which keeps the control
   * language-neutral.
   */
  private drawLabel(view: HandBarView): string {
    if (view.drawCooldownTicks > 0) {
      const seconds = Math.ceil(view.drawCooldownTicks / BOSS_RACE_TICK_RATE_HZ);
      return `${seconds}s`;
    }
    if (view.deckRemaining === HAND_DECK_UNKNOWN) {
      return '+';
    }
    return `+${view.deckRemaining}`;
  }

  private ensureActionButton(kind: 'draw' | 'use', x: number, y: number): Laya.Sprite | null {
    const existing = kind === 'draw' ? this.drawButton : this.useButton;
    if (existing !== null) {
      return existing;
    }
    const button = createOfficialWidget('button');
    if (button === null) {
      // No prefab (yet): the buttons are the one part with no vector fallback,
      // because a draw/use control that looks hand-painted would be worse than
      // one that appears a moment later.
      return null;
    }
    button.size(ACTION_WIDTH, SLOT_HEIGHT);
    button.pos(x, y);
    button.mouseEnabled = true;
    skinButton(button);
    button.on(Laya.Event.CLICK, undefined, () => {
      if (kind === 'draw') {
        this.onDraw?.();
      } else {
        this.onUse?.();
      }
    });
    this.actionLayer.addChild(button);
    if (kind === 'draw') {
      this.drawButton = button;
    } else {
      this.useButton = button;
    }
    return button;
  }

  private paintSlot(control: SlotControl, slot: HandSlotView, width: number, selected: boolean): void {
    if (control.official !== null) {
      control.official.size(width, SLOT_HEIGHT);
      // Repaint after sizing: the plate is drawn at the part's own box, so
      // skinning once at the creation width would leave the border short when
      // the bar shrinks its slots.
      skinButton(control.official);
      setWidgetText(control.official, truncate(slot.cardId, LABEL_MAX_CHARS));
      // Selection reads as "full brightness + accent underline"; the prefab's
      // own plate stays the same so the row does not jump.
      control.official.alpha = selected ? 1 : 0.82;
    } else {
      const g = control.root.graphics;
      g.clear();
      VectorPainter.roundedPanel(
        g,
        0,
        0,
        width,
        SLOT_HEIGHT,
        theme.RADIUS_SM,
        selected ? theme.COLOR_PANEL : theme.COLOR_PANEL_DEEP,
        selected ? theme.COLOR_ACCENT : theme.COLOR_PANEL_BORDER,
        selected ? 2 : 1,
      );
      const size = theme.FONT_SIZE_CAPTION;
      g.fillText(
        truncate(slot.cardId, LABEL_MAX_CHARS),
        width / 2,
        theme.SPACE_SM,
        theme.font(size, true),
        theme.COLOR_TEXT,
        'center',
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

    const marker = control.marker;
    marker.visible = selected;
    if (selected) {
      const mg = marker.graphics;
      mg.clear();
      mg.drawRect(0, SLOT_HEIGHT - 3, width, 3, theme.COLOR_ACCENT);
    }
    // The slot number is a real text node in both paths, so the official prefab
    // (which owns its own label) can still show which number key casts it.
    control.indexText.text = String(slot.index + 1);
  }

  private slotControl(index: number): SlotControl {
    const existing = this.slotControls[index];
    if (existing !== undefined) {
      return existing;
    }
    const root = new Laya.Sprite();
    root.mouseEnabled = true;
    const official = createOfficialWidget('button');
    if (official !== null) {
      official.size(SLOT_WIDTH_MAX, SLOT_HEIGHT);
      // The root is the single hit target, so a click can never be swallowed by
      // the prefab's own children (and the slot index is bound exactly once).
      official.mouseEnabled = false;
      root.addChild(official);
    }
    const marker = new Laya.Sprite();
    marker.mouseEnabled = false;
    marker.visible = false;
    root.addChild(marker);
    const indexText = new Laya.Text();
    indexText.fontSize = theme.FONT_SIZE_CAPTION;
    indexText.color = theme.COLOR_ACCENT;
    indexText.pos(theme.SPACE_XS, SLOT_HEIGHT - theme.FONT_SIZE_CAPTION - theme.SPACE_XS);
    root.addChild(indexText);
    const slotIndex = index;
    root.on(Laya.Event.CLICK, undefined, () => this.onSlotClick?.(slotIndex));
    this.slotLayer.addChild(root);
    const control: SlotControl = { root, official, marker, indexText };
    this.slotControls.push(control);
    return control;
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

/**
 * Writes the prefab's own label child.
 *
 * The engine's Button carries a text child (the same one `settings/widgets.ts`
 * writes); the project's typings do not expose it, so it is reached through a
 * widened shape and skipped when absent.
 */
function setWidgetText(widget: Laya.Sprite, text: string): void {
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

/** Grey-out for an unavailable official widget (same idiom as the settings rows). */
function setWidgetEnabled(widget: Laya.Sprite, enabled: boolean): void {
  widget.mouseEnabled = enabled;
  widget.alpha = enabled ? 1 : 0.45;
}
