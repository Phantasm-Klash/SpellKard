/**
 * Hand-bar presentation model (engine-agnostic).
 *
 * The battle HUD shows the local player's hand as a small strip of cast slots
 * plus the opening energy. The hand starts as the **signed battle ticket's**
 * opening loadout (`BattleOpeningState`, `core/net/lobby_client.ts`) and only
 * ever grows through a server `draft_grant` — the client owns no hand state of
 * its own, it renders what the server dealt and turns a slot click into a
 * one-shot cast intent for the next input packet.
 *
 * Two deliberate non-features, because the server is authoritative:
 *
 *  - no cost / cooldown / turn gating. Energy is displayed, never compared
 *    against a card's cost; whether a cast is legal is the server's decision.
 *  - no hand mutation beyond a server grant. The hand changes only when a
 *    `draft_grant` row says so, never because the UI felt like it.
 *
 * NOTE: `core/` only — never import Laya or platform code from here.
 */

import type { BattleOpeningState } from '../net/lobby_client';
import { cardEffectDefinition, describeCardEffect, type CardRarity } from '../sim/card_effects';
import { CardCastIntent, MAX_CARD_SLOTS } from './input';

/** One cast slot: a card from the server's hand, in server order. */
export interface HandSlotView {
  /** 0-based cast slot, i.e. the value sent on the wire for this card. */
  index: number;
  cardId: string;
  /** Rarity tier when the card is in the client's mirror table, else `''`. */
  rarity: CardRarity | '';
  /** One-line effect summary for a known card, else `''` (the raw id still shows). */
  summary: string;
}

/** Everything the hand bar draws for one redraw. */
export interface HandBarView {
  slots: HandSlotView[];
  /** Opening energy, shown verbatim; never a gate. */
  energy: number;
  /** False for an empty hand: the bar draws nothing. */
  visible: boolean;
}

/**
 * Projects a hand onto the hand bar.
 *
 * An empty hand yields an invisible bar with no slots — never a placeholder
 * slot, which a click could otherwise arm. Slots are the server's own order,
 * capped at the cast-slot limit so a malformed ticket cannot produce an
 * uncastable slot index. Never throws.
 */
export function buildHandBar(
  handCardIds: readonly string[] | null | undefined,
  energy: number,
  maxSlots: number = MAX_CARD_SLOTS,
): HandBarView {
  const hand = handCardIds ?? [];
  const limit = Math.max(0, Math.trunc(maxSlots));
  const slots: HandSlotView[] = [];
  for (let index = 0; index < hand.length && index < limit; index += 1) {
    const cardId = hand[index];
    if (typeof cardId !== 'string' || cardId === '') {
      // Keep the index aligned with the server's slot numbering.
      continue;
    }
    const definition = cardEffectDefinition(cardId);
    slots.push({
      index,
      cardId,
      rarity: definition?.rarity ?? '',
      summary: describeCardEffect(cardId),
    });
  }
  return {
    slots,
    energy: Number.isFinite(energy) ? energy : 0,
    visible: slots.length > 0,
  };
}

/** Convenience: the hand bar for a ticket opening loadout (or `null`). */
export function openingHandBar(
  opening: BattleOpeningState | null | undefined,
  maxSlots: number = MAX_CARD_SLOTS,
): HandBarView {
  return buildHandBar(opening?.handCardIds ?? [], opening?.initialEnergy ?? 0, maxSlots);
}

/**
 * The hand bar's state machine: it owns the current hand and the one-shot cast
 * intent, so a click can never cast a slot the server did not deal.
 *
 * `click` arms a cast only for a slot that actually holds a card; `take`
 * consumes it for exactly one input packet. Installing a *different* opening
 * cancels any pending cast, so a click that raced a fresh ticket cannot fire a
 * stale slot; a grant only appends, so it leaves an in-flight click alone.
 */
export class HandBarController {
  private hand: string[] = [];
  private energyValue = 0;
  /** Signature of the opening last installed, so an unchanged ticket is a no-op. */
  private openingKey = '\u0001';
  private readonly intent = new CardCastIntent();

  /** Installs the server's opening loadout; `null` clears the bar. */
  setOpening(opening: BattleOpeningState | null | undefined): void {
    const next = opening ?? null;
    const ids = (next?.handCardIds ?? []).slice(0, MAX_CARD_SLOTS);
    const key = ids.join('\u0000');
    if (key !== this.openingKey) {
      // The opening changed under a pending click: drop it rather than fire a
      // slot that may no longer hold that card.
      this.intent.cancel();
      this.openingKey = key;
    }
    this.hand = ids.slice();
    this.energyValue = next?.initialEnergy ?? 0;
  }

  /**
   * Appends a card the server granted to this player (`draft_grant`).
   *
   * Returns whether the hand changed. A duplicate id, a blank id, or a full
   * hand is ignored — the client mirrors the server's `cardHandLimit` for
   * display and never invents a fifth slot.
   */
  applyGrant(cardId: string): boolean {
    const id = cardId.trim();
    if (id === '' || this.hand.includes(id) || this.hand.length >= MAX_CARD_SLOTS) {
      return false;
    }
    this.hand.push(id);
    return true;
  }

  get view(): HandBarView {
    return buildHandBar(this.hand, this.energyValue);
  }

  get energy(): number {
    return this.energyValue;
  }

  get handCardIds(): readonly string[] {
    return this.hand;
  }

  get armed(): boolean {
    return this.intent.armed;
  }

  /** The slot at `index`, or `null` when the hand has no such card. */
  slot(index: number): HandSlotView | null {
    return this.view.slots.find((entry) => entry.index === index) ?? null;
  }

  /** Arms a cast for the clicked slot; `false` when the slot holds no card. */
  click(index: number): boolean {
    if (this.slot(index) === null) {
      return false;
    }
    return this.intent.request(index);
  }

  /** Consumes the armed slot for one packet; `-1` when nothing is armed. */
  take(): number {
    return this.intent.take();
  }

  cancel(): void {
    this.intent.cancel();
  }
}
