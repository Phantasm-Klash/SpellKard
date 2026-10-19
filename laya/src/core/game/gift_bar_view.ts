/**
 * Gift-bar view model: the pure part of the in-match gift interaction.
 *
 * The scene owns the drawing; this module owns the *decisions* — which slots a
 * player may spend **gift charges** on, how a sent gift is announced, and how
 * many charges the match-event stream says the local player has already spent.
 * Keeping it free of Laya imports is what makes the interaction testable
 * without a canvas.
 *
 * Gift charges are an independent per-match pool (see
 * {@link ./gift_catalog#GIFT_CHARGE_BUDGET}), NOT card energy: the lobby
 * debits them per *sender* and never touches the card economy. The client has
 * no push channel for the remaining count, so it derives one from the event
 * stream — {@link giftChargesSpentFrom} sums the catalog price of every
 * `gift_sent` the local player emitted. That is a preview, not authority: the
 * server refuses an overspend and the scene shows the refusal as text, so a
 * stale count costs at most one greyed slot.
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import {
  GIFT_CHARGE_BUDGET,
  giftCatalog,
  giftDefinition,
  type GiftDefinition,
  type GiftGlyphKind,
} from './gift_catalog';
import type { MatchEventView } from './battle_events';
import { t } from './i18n';

/** One gift-bar slot, ready to draw. */
export interface GiftSlotView {
  readonly definition: GiftDefinition;
  /** Resolved in the active language; re-resolved every frame the bar rebuilds. */
  readonly name: string;
  readonly blurb: string;
  /** False when the local player's remaining gift charges cannot cover the cost. */
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
 * Builds the bar for `chargesLeft` — the local player's remaining gift charges
 * (see {@link GIFT_CHARGE_BUDGET}), NOT card energy. A gift whose cost exceeds
 * what is left is still listed (greyed by the scene) so the player can see what
 * exists; only the *affordable* flag changes.
 */
export function giftBarView(chargesLeft: number, selectedIndex: number): GiftBarView {
  const catalog = giftCatalog();
  const clamped = selectedIndex < 0 || selectedIndex >= catalog.length ? -1 : selectedIndex;
  return {
    selectedIndex: clamped,
    slots: catalog.map((definition, index) => ({
      definition,
      // Resolved in the active language; the scene rebuilds the bar every frame,
      // so a language switch takes effect on the next tick.
      name: t(definition.nameKey),
      blurb: t(definition.blurbKey),
      affordable: chargesLeft >= definition.cost,
      selected: index === clamped,
    })),
  };
}

/** The gift the player can actually send at `selectedIndex`, or `null`. */
export function affordableGiftAt(view: GiftBarView, chargesLeft: number): GiftDefinition | null {
  if (view.selectedIndex < 0 || view.selectedIndex >= view.slots.length) {
    return null;
  }
  const slot = view.slots[view.selectedIndex];
  if (!slot.affordable || chargesLeft < slot.definition.cost) {
    return null;
  }
  return slot.definition;
}

/**
 * Gift charges the local player has already spent, derived from the match
 * event stream.
 *
 * The server writes one `gift_sent` row per accepted gift with `user_id` =
 * sender and `card_id` = gift id, and debits charges per sender (the recipient
 * is never charged). Summing the catalog price of the local player's own rows
 * therefore reproduces the server's debit exactly for ids this build knows;
 * an unknown id (a newer server's catalog) falls back to the event's `value`,
 * which the server sets to the charges spent. Anything else contributes 0.
 *
 * `localUserId === ''` (pre-sign-in) yields 0 rather than counting every
 * sender's gifts.
 */
export function giftChargesSpentFrom(
  events: readonly MatchEventView[],
  localUserId: string,
): number {
  if (localUserId === '') {
    return 0;
  }
  let spent = 0;
  for (const event of events) {
    if (event.type !== 'gift_sent' || event.userId !== localUserId) {
      continue;
    }
    const giftId = (event.cardId ?? '').trim();
    const definition = giftDefinition(giftId);
    if (definition !== null) {
      spent += definition.cost;
    } else if (giftId !== '' && event.value !== undefined && event.value > 0) {
      spent += event.value;
    }
  }
  return spent;
}

/**
 * Remaining gift charges after `spent`, clamped to `0..GIFT_CHARGE_BUDGET`.
 * The clamp matters because the event stream is a log, not a ledger: a gap
 * resync replays rows and a hostile server could repeat one, so an overspent
 * count must read as "none left" instead of a negative number.
 */
export function giftChargesLeft(spent: number): number {
  if (!Number.isFinite(spent) || spent <= 0) {
    return GIFT_CHARGE_BUDGET;
  }
  return Math.max(0, GIFT_CHARGE_BUDGET - spent);
}

/**
 * The announcement line a `gift_sent` event produces, e.g.
 * `Marisa 送出了 心愿`. Sender/recipient fall back to a placeholder so the line
 * never reads as empty, and an unknown gift id renders with its raw id rather
 * than being dropped.
 */
export function giftAnnouncement(giftId: string, fromName: string, toName: string): string {
  const definition = giftDefinition(giftId);
  const label = definition === null ? giftId : t(definition.nameKey);
  // The word used when a side is unnamed is its own string, not something to be
  // scraped out of the sentence template (word order differs per language).
  const side = t('ui.opponent');
  const from = fromName === '' ? side : fromName;
  const to = toName === '' ? side : toName;
  return t('gift.announce', { from, to, gift: label });
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
