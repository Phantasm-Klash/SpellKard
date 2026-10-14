/**
 * Hand-bar presentation model (engine-agnostic).
 *
 * The battle HUD shows the local player's opening hand as a small strip of cast
 * slots plus the opening energy. Both come from the **signed battle ticket**
 * (`BattleOpeningState`, `core/net/lobby_client.ts`): the client owns no hand
 * state of its own — it renders what the ticket dealt and turns a slot click
 * into a one-shot cast intent for the next input packet.
 *
 * Two deliberate non-features, because the server is authoritative:
 *
 *  - no cost / cooldown / turn gating. Energy is displayed, never compared
 *    against a card's cost; whether a cast is legal is the server's decision.
 *  - no candidate or hand mutation. The hand only changes when a `draft_grant`
 *    row says so (see the draft panel), never because the UI felt like it.
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
  /** False for a missing or empty hand: the bar draws nothing. */
  visible: boolean;
}

/**
 * Projects an opening loadout onto the hand bar.
 *
 * A missing opening (older server) and an empty hand both yield an invisible
 * bar with no slots — never a placeholder slot, which a click could otherwise
 * arm. Slots are the server's own order, capped at the cast-slot limit so a
 * malformed ticket cannot produce an uncastable slot index. Never throws.
 */
export function buildHandBar(
  opening: BattleOpeningState | null | undefined,
  maxSlots: number = MAX_CARD_SLOTS,
): HandBarView {
  const hand = opening?.handCardIds ?? [];
  const limit = Math.max(0, Math.trunc(maxSlots));
  const slots: HandSlotView[] = [];
  for (let index = 0; index < hand.length && index < limit; index += 1) {
    const cardId = hand[index];
    if (typeof cardId !== 'string' || cardId === '') {
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
  const energy = opening?.initialEnergy ?? 0;
  return {
    slots,
    energy: Number.isFinite(energy) ? energy : 0,
    visible: slots.length > 0,
  };
}

/**
 * The hand bar's state machine: it owns the current hand and the one-shot cast
 * intent, so a click can never cast a slot the server did not deal.
 *
 * `click` arms a cast only for a slot that actually holds a card; `take`
 * consumes it for exactly one input packet. A change of hand cancels any
 * pending cast, so a click that raced a `draft_grant` cannot fire a stale slot.
 */
export class HandBarController {
  private opening: BattleOpeningState | null = null;
  private handKey = '';
  private readonly intent = new CardCastIntent();

  /** Installs the server's opening loadout; `null` clears the bar. */
  setOpening(opening: BattleOpeningState | null | undefined): void {
    const next = opening ?? null;
    const nextKey = (next?.handCardIds ?? []).join('\u0000');
    if (nextKey !== this.handKey) {
      // The hand changed under a pending click: drop it rather than fire a slot
      // that may no longer hold that card.
      this.intent.cancel();
      this.handKey = nextKey;
    }
    this.opening = next;
  }

  get view(): HandBarView {
    return buildHandBar(this.opening);
  }

  get energy(): number {
    return this.opening?.initialEnergy ?? 0;
  }

  get handCardIds(): readonly string[] {
    return this.opening?.handCardIds ?? [];
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
