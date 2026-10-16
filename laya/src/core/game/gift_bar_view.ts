/**
 * Gift-bar view model: the pure part of the in-match gift interaction.
 *
 * The scene owns the drawing; this module owns the *decisions* — which slots a
 * player may spend energy on, and how a sent gift is announced. Keeping it free
 * of Laya imports is what makes the interaction testable without a canvas.
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import { giftCatalog, giftDefinition, type GiftDefinition, type GiftGlyphKind } from './gift_catalog';

/** One gift-bar slot, ready to draw. */
export interface GiftSlotView {
  readonly definition: GiftDefinition;
  /** False when the local player's energy cannot cover the gift's cost. */
  readonly affordable: boolean;
  /** True when this slot is the one the pointer/keyboard last selected. */
  readonly selected: boolean;
}

export interface GiftBarView {
  readonly slots: readonly GiftSlotView[];
  /** The selected slot's index, or -1 when nothing is selected. */
  readonly selectedIndex: number;
}

/**
 * Builds the bar for `energy`. A gift whose cost exceeds the energy is still
 * listed (greyed by the scene) so the player can see what exists; only the
 * *affordable* flag changes.
 */
export function giftBarView(energy: number, selectedIndex: number): GiftBarView {
  const catalog = giftCatalog();
  const clamped = selectedIndex < 0 || selectedIndex >= catalog.length ? -1 : selectedIndex;
  return {
    selectedIndex: clamped,
    slots: catalog.map((definition, index) => ({
      definition,
      affordable: energy >= definition.cost,
      selected: index === clamped,
    })),
  };
}

/** The gift the player can actually send at `selectedIndex`, or `null`. */
export function affordableGiftAt(view: GiftBarView, energy: number): GiftDefinition | null {
  if (view.selectedIndex < 0 || view.selectedIndex >= view.slots.length) {
    return null;
  }
  const slot = view.slots[view.selectedIndex];
  if (!slot.affordable || energy < slot.definition.cost) {
    return null;
  }
  return slot.definition;
}

/**
 * The announcement line a `gift_sent` event produces, e.g.
 * `Marisa 送出了 心愿`. Sender/recipient fall back to a placeholder so the line
 * never reads as empty, and an unknown gift id renders with its raw id rather
 * than being dropped.
 */
export function giftAnnouncement(giftId: string, fromName: string, toName: string): string {
  const definition = giftDefinition(giftId);
  const label = definition === null ? giftId : definition.name;
  const from = fromName === '' ? '对手' : fromName;
  const to = toName === '' ? '对手' : toName;
  return `${from} 向 ${to} 送出了 ${label}`;
}

/**
 * Draws a gift glyph with the scene's vector primitives — no bitmap assets.
 * `size` is the icon box in pixels and the glyph is centred on (x, y).
 *
 * The shapes are deliberately simple and distinct at 24 px: a heart, a star, a
 * bow, a lantern, a wand and a cup, each in the gift's accent colour.
 */
export function giftGlyphPath(kind: GiftGlyphKind): readonly (readonly [number, number])[] {
  switch (kind) {
    case 'heart':
      return [
        [0, 0.35],
        [-0.5, -0.1],
        [-0.32, -0.5],
        [0, -0.22],
        [0.32, -0.5],
        [0.5, -0.1],
      ];
    case 'star':
      return [
        [0, -0.5],
        [0.15, -0.15],
        [0.5, -0.15],
        [0.22, 0.08],
        [0.32, 0.45],
        [0, 0.22],
        [-0.32, 0.45],
        [-0.22, 0.08],
        [-0.5, -0.15],
        [-0.15, -0.15],
      ];
    case 'ribbon':
      return [
        [-0.45, -0.35],
        [-0.1, 0],
        [-0.45, 0.35],
        [-0.12, 0.12],
        [0.12, 0.12],
        [0.45, 0.35],
        [0.1, 0],
        [0.45, -0.35],
        [0.12, -0.12],
        [-0.12, -0.12],
      ];
    case 'lantern':
      return [
        [-0.32, -0.4],
        [0.32, -0.4],
        [0.32, 0.3],
        [-0.32, 0.3],
      ];
    case 'wand':
      return [
        [-0.4, 0.4],
        [0.3, -0.3],
        [0.42, -0.18],
        [-0.28, 0.42],
      ];
    case 'cup':
      return [
        [-0.3, -0.25],
        [0.3, -0.25],
        [0.22, 0.4],
        [-0.22, 0.4],
      ];
    default:
      return [];
  }
}
