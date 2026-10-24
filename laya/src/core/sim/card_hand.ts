/**
 * In-match hand state and cast validation — the TypeScript port of the battle
 * server's `phk/battle/card_hand.hpp` / `card_hand.cpp`.
 *
 * ★ This is the **authoritative rule source** for card casting in the C++
 * battle server, and every number below is transcribed from it (the C++ file
 * header itself names the Go lobby as the original source of truth):
 *
 * | rule | C++ |
 * | --- | --- |
 * | hand limit 4 | `card_hand.hpp:42` (`kCardHandLimit`) |
 * | deck limit 20 | `card_hand.hpp:47` (`kCardDeckLimit`) |
 * | energy cap 10.0 | `card_hand.hpp:48` (`kCardMaxEnergy`) |
 * | energy +0.0025 / tick | `card_hand.hpp:52` (`kCardEnergyPerTick`) |
 * | 20-card catalog | `card_hand.cpp:22-43` (`kCatalog`) |
 * | `ValidateCast` | `card_hand.cpp:66-111` |
 * | `DrawServerCard` | `card_hand.cpp:113-124` |
 * | `ApplyCast` | `card_hand.cpp:126-138` |
 * | `BuildCardActivation` | `card_hand.cpp:140-149` |
 *
 * ★ The **sentinel** convention matters more than anything else here:
 * `slot === -1` means "no card this tick" (it is the `BattleInput.card_slot`
 * struct default, `protocol.hpp:52`) and is **not** a rejection — it neither
 * produces a `card_rejected` row nor changes any ledger field. See
 * {@link validateCast}.
 *
 * The catalog itself lives in {@link module:core/sim/card_effects} (the shared
 * 20-card table); this module only adds the fields the C++ `CardDefinition`
 * carries and the lobby semantics the effect table does not model
 * (`energy_gain` / `draw_cards` / `pattern_id`).
 *
 * Copyright: 东方同人逆向成果，仅用于自研玩法。
 */

import { cardEffectDefinition, type CardEffectKind } from './card_effects';
import type { CardActivation } from './card_effects';

/** `kCardHandLimit` — `card_hand.hpp:42` (the lobby's `cardHandLimit`). */
export const CARD_HAND_LIMIT = 4;

/** `kCardDeckLimit` — `card_hand.hpp:47` (signed ticket's deck size cap). */
export const CARD_DECK_LIMIT = 20;

/** `kCardMaxEnergy` — `card_hand.hpp:48`. */
export const CARD_MAX_ENERGY = 10;

/** `kCardEnergyPerTick` — `card_hand.hpp:52` (per-tick energy regen). */
export const CARD_ENERGY_PER_TICK = 0.0025;

/**
 * One catalog card, mirroring the C++ `CardDefinition` (`card_hand.hpp:55-68`)
 * field for field.
 *
 * `energyGain` / `drawCards` only the lobby's own simulation applies; the
 * battle server's ledger ignores them, but the catalog carries them so the
 * client can describe a card without guessing.
 */
export interface CardDefinition {
  cardId: string;
  effectKind: CardEffectKind;
  cost: number;
  cooldownTicks: number;
  durationTicks: number;
  damage: number;
  scoreBonus: number;
  /** `energy_gain` — `draw_sigil` grants 0.75 (`card_hand.cpp:30`). */
  energyGain: number;
  /** `draw_cards` — `draw_sigil` draws 1 (`card_hand.cpp:30`). */
  drawCards: number;
  /** `pattern_id` — the opponent-pattern curtain's pattern (empty for others). */
  patternId: string;
  /** `purge_radius` in playfield pixels (`bullet_purge` only). */
  purgeRadius: number;
  /** `purge_count` (`bullet_purge` only). */
  purgeCount: number;
}

/**
 * The in-match hand state, mirroring the C++ `HandState`
 * (`card_hand.hpp:74-80`) — the card subset of the lobby's player state.
 */
export interface HandState {
  /** `player.Hand` — the card ids currently held, in slot order. */
  cardIds: string[];
  /** `player.Energy`. */
  energy: number;
  /** card id → the first tick it may be cast again. */
  cooldowns: Map<string, number>;
  /** `player.DrawCursor` — the deck cursor, continued from the lobby's. */
  drawCursor: number;
  /** `DeckSnapshot.CardIDs` — the signed ticket's deck. */
  deck: string[];
}

/**
 * The outcome of a cast attempt, mirroring the C++ `CastValidationResult`
 * (`card_hand.hpp:85-94`).
 *
 * `accepted === false` → `reason` is the rejection code. `accepted === true`
 * **and** `playsNoCard === true` → the `-1` sentinel: no card was played, no
 * definition, no ledger change and **no** `card_rejected` row.
 */
export interface CastValidationResult {
  accepted: boolean;
  /** Rejection code (`cast_card_*`), empty when accepted. */
  reason: string;
  /** The catalog entry (only when accepted and a card was actually played). */
  definition: CardDefinition | null;
  /** The trimmed card id (only when accepted and a card was actually played). */
  cardId: string;
  /** The slot the card was removed from. */
  removedSlot: number;
  /** The energy after paying the cost (floored at 0). */
  energyAfter: number;
  /** `tick + cooldown_ticks` — the tick the card may be cast again. */
  cooldownUntil: number;
  /** `slot === -1`: "no card this tick" — a sentinel, **not** a rejection. */
  playsNoCard: boolean;
}

/** A fresh, empty hand state. */
export function createHandState(): HandState {
  return {
    cardIds: [],
    energy: 0,
    cooldowns: new Map<string, number>(),
    drawCursor: 0,
    deck: [],
  };
}

/**
 * The catalog entry for `cardId`, or `null` when the id is unknown.
 *
 * Mirrors C++ `FindCardDefinition` (`card_hand.cpp:47-54`): the 20-card
 * whitelist, looked up by id.
 */
export function findCardDefinition(cardId: string): CardDefinition | null {
  const table = cardEffectDefinition(cardId);
  if (table === null) {
    return null;
  }
  return {
    cardId: table.cardId,
    effectKind: table.effectKind,
    cost: table.cost,
    cooldownTicks: table.cooldownTicks,
    durationTicks: table.durationTicks,
    damage: table.damage,
    scoreBonus: table.scoreBonus,
    energyGain: table.energyGain ?? 0,
    drawCards: table.drawCards ?? 0,
    // Every `opponent_pattern` card in the server's catalog names itself as its
    // pattern (`card_hand.cpp:35`/`:40`), so the id is the pattern id — the
    // same value the C++ catalog carries in `pattern_id`.
    patternId: table.patternId ?? (table.effectKind === 'opponent_pattern' ? table.cardId : ''),
    purgeRadius: table.purgeRadius ?? 0,
    purgeCount: table.purgeCount ?? 0,
  };
}

/**
 * `TrimCardId` — the C++ port of Go's `strings.TrimSpace` ASCII subset
 * (`card_hand.cpp:56-64`): strips space, `\t`, `\n`, `\r`, `\v` and `\f`.
 */
export function trimCardId(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isAsciiSpace(value.charCodeAt(start))) {
    start += 1;
  }
  while (end > start && isAsciiSpace(value.charCodeAt(end - 1))) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isAsciiSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0b || code === 0x0c;
}

/**
 * `ValidateCast` — the pure cast validation, mirroring C++
 * `card_hand.cpp:66-111` **step for step, in the same order**:
 *
 *  0. `slot === -1` → the sentinel: accepted, `playsNoCard`, no definition,
 *     no ledger change, no rejection code.
 *  1. `slot < 0` or `slot >= hand.cardIds.length` →
 *     `cast_card_slot_out_of_range`. ★ The authoritative bound is the **actual
 *     hand size**, not the fixed limit 4: the lobby's two-stage errors ("card
 *     slot is outside hand" / "card slot is empty") are deliberately merged
 *     into this one code (C++ `card_hand.hpp:13-18`).
 *  2. the trimmed id is not in the 20-card catalog →
 *     `cast_card_unknown_card`.
 *  3. `tick < cooldowns[cardId]` → `cast_card_on_cooldown`.
 *  4. `energy + 0.0001 < cost` → `cast_card_insufficient_energy`.
 *
 * The `0.0001` epsilon is the C++ float slack (`card_hand.cpp:100`) — the
 * energy ledger accumulates in doubles, so an exact comparison would reject
 * casts that are affordable by a hair.
 */
export function validateCast(hand: HandState, slot: number, tick: number): CastValidationResult {
  const result: CastValidationResult = {
    accepted: false,
    reason: '',
    definition: null,
    cardId: '',
    removedSlot: 0,
    energyAfter: 0,
    cooldownUntil: 0,
    playsNoCard: false,
  };
  // Step 0 — the `-1` sentinel is the wire's struct default, not an error.
  if (slot === -1) {
    result.accepted = true;
    result.playsNoCard = true;
    result.energyAfter = hand.energy;
    return result;
  }
  // Step 1 — the authoritative bound is the hand's actual size.
  if (slot < 0 || slot >= hand.cardIds.length) {
    result.reason = 'cast_card_slot_out_of_range';
    return result;
  }
  const cardId = trimCardId(hand.cardIds[slot]);
  const definition = findCardDefinition(cardId);
  // Step 2 — unknown card id.
  if (definition === null) {
    result.reason = 'cast_card_unknown_card';
    return result;
  }
  // Step 3 — still on cooldown.
  const cooldown = hand.cooldowns.get(cardId);
  if (cooldown !== undefined && tick < cooldown) {
    result.reason = 'cast_card_on_cooldown';
    return result;
  }
  // Step 4 — not enough energy.
  if (hand.energy + 0.0001 < definition.cost) {
    result.reason = 'cast_card_insufficient_energy';
    return result;
  }
  result.accepted = true;
  result.definition = definition;
  result.cardId = cardId;
  result.removedSlot = slot;
  result.energyAfter = Math.max(0, hand.energy - definition.cost);
  result.cooldownUntil = tick + definition.cooldownTicks;
  return result;
}

/**
 * `DrawServerCard` — mirrors C++ `card_hand.cpp:113-124`.
 *
 * Draws one card when the hand is not full (4) and the deck is not empty. The
 * deck is walked with a **modulo cursor**, so it rotates; a blank card id is
 * consumed (the cursor still advances) but is **not** added to the hand.
 */
export function drawServerCard(hand: HandState): boolean {
  if (hand.cardIds.length >= CARD_HAND_LIMIT || hand.deck.length === 0) {
    return false;
  }
  const cardId = trimCardId(hand.deck[hand.drawCursor % hand.deck.length]);
  hand.drawCursor += 1;
  if (cardId === '') {
    return false;
  }
  hand.cardIds.push(cardId);
  return true;
}

/**
 * `ApplyCast` — mirrors C++ `card_hand.cpp:126-138`.
 *
 * Validates, then books the ledger: pay the energy, write the cooldown,
 * remove the played slot and draw one replacement card. A rejection **and** the
 * `-1` sentinel leave the hand state untouched.
 */
export function applyCast(hand: HandState, slot: number, tick: number): CastValidationResult {
  const result = validateCast(hand, slot, tick);
  if (!result.accepted || result.playsNoCard || result.definition === null) {
    return result;
  }
  hand.energy = result.energyAfter;
  hand.cooldowns.set(result.cardId, result.cooldownUntil);
  hand.cardIds.splice(result.removedSlot, 1);
  drawServerCard(hand);
  return result;
}

/**
 * `BuildCardActivation` — mirrors C++ `card_hand.cpp:140-149`: the bridge from
 * the catalog into the effect layer.
 */
export function buildCardActivation(definition: CardDefinition, tick: number): CardActivation {
  return {
    cardId: definition.cardId,
    effectKind: definition.effectKind,
    patternId: definition.patternId,
    expiresTick: tick + definition.durationTicks,
    purgeRadius: definition.purgeRadius,
    purgeCount: definition.purgeCount,
  };
}

/**
 * The per-tick energy regen — C++ `BattleSimulation::Tick`
 * (`simulation.cpp:1168-1169`): `min(kCardMaxEnergy, energy + kCardEnergyPerTick)`
 * for every connected player, accrued **before** the tick's cast is charged.
 */
export function accrueCardEnergy(hand: HandState): number {
  hand.energy = Math.min(CARD_MAX_ENERGY, hand.energy + CARD_ENERGY_PER_TICK);
  return hand.energy;
}
