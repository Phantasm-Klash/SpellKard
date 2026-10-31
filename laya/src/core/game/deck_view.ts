/**
 * Deck-editor state — pure, engine-free, unit-testable.
 *
 * The lobby is authoritative for decks (`decks.list` / `decks.save`): it stores
 * an ordered `card_ids` list per deck and validates it in
 * `validateDeckRecordForUser` (`Gensoulkyo/runtime/core/service.go:5368`). This
 * module mirrors **that** contract, not a simplified "at most 20 cards" one:
 *
 *   1. the deck must hold **exactly 20** cards (`len(deck.CardIDs) != deckSize`);
 *   2. a single card may appear at most **2** times (`maxCopiesPerCard`);
 *   3. a card may not appear more often than the inventory holds it;
 *   4. at most **6** high-rarity cards (`maxHighRareCards`; `rare` / `epic` /
 *      `legendary` — `isHighRareCard`);
 *   5. at most **4** strong-interference cards (`maxInterferenceCards`);
 *   6. `format` is required (the lobby defaults it to `local_practice`) and the
 *      `ranked` format bans `last_arc` / `finale_arc`.
 *
 * Because the pool is exactly 20 cards and a deck is exactly 20 cards, building
 * a deck is *allocation*, not selection: every card goes in 0, 1 or 2 times and
 * the totals have to add up to 20.
 *
 * The card table is 20 cards, so {@link DECK_SIZE} equals the catalogue size —
 * that is a coincidence of the current set, not a rule; keep the two separate.
 *
 * The UI uses these checks only as a **pre-warning** (it greys out Save and says
 * what is wrong). The lobby re-validates on every save and its `deck_invalid`
 * answer is what decides.
 *
 * NOTE: `core/` only — no Laya, no DOM, no storage.
 */

import type { DecksView, InventoryView } from '../net/lobby_client';
import { cardEffectDefinition, describeCardEffect, rarityLabel, type CardRarity } from '../sim/card_effects';

// ---------------------------------------------------------------------------
// Server mirror constants
// ---------------------------------------------------------------------------

/** `deckSize` — a deck must hold exactly this many cards. */
export const DECK_SIZE = 20;

/** `maxCopiesPerCard` — copies of one card allowed in a single deck. */
export const MAX_COPIES_PER_CARD = 2;

/** `maxHighRareCards` — cap on `rare` / `epic` / `legendary` copies combined. */
export const MAX_HIGH_RARE_CARDS = 6;

/** `maxInterferenceCards` — cap on {@link STRONG_INTERFERENCE_CARDS} copies. */
export const MAX_INTERFERENCE_CARDS = 4;

/** `defaultDeckFormat` — what the lobby stores when `format` is blank. */
export const DEFAULT_DECK_FORMAT = 'local_practice';

/** The one format with extra bans. */
export const RANKED_DECK_FORMAT = 'ranked';

/** Rarities `isHighRareCard` counts towards {@link MAX_HIGH_RARE_CARDS}. */
export const HIGH_RARITIES: readonly CardRarity[] = ['rare', 'epic', 'legendary'];

/**
 * Mirror of the lobby's `serverStrongInterferenceCards` (`service.go:532`).
 *
 * The client has no other source for this list — the card definitions in
 * `core/sim/card_effects.ts` carry rarity but not "interference" — so it is
 * copied here as data. **The server is authoritative**: this table only drives
 * the pre-save warning, and a server-side change that is not mirrored here
 * degrades to "the lobby rejects the save", never to a wrongly accepted deck.
 */
export const STRONG_INTERFERENCE_CARDS: readonly string[] = ['density_surge', 'aim_baffle', 'mirror_lance'];

/**
 * Mirror of the lobby's `serverRankedBannedCards` (`service.go:538`), applied
 * only when the deck's format is {@link RANKED_DECK_FORMAT}. Same caveat as
 * {@link STRONG_INTERFERENCE_CARDS}: pre-warning only.
 */
export const RANKED_BANNED_CARDS: readonly string[] = ['last_arc', 'finale_arc'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Why a save would be refused; `''` means "the lobby should accept it".
 *
 * Values are stable ids: the scene maps each one to an i18n key, so a new
 * reason is a compile error at the mapping site rather than a silent no-op.
 */
export type DeckProblem =
  | ''
  | 'deck_incomplete'
  | 'deck_overflow'
  | 'card_not_owned'
  | 'copy_cap'
  | 'copy_limit'
  | 'high_rarity_limit'
  | 'interference_limit'
  | 'ranked_banned'
  | 'slot_invalid';

/** Full verdict: the first problem found plus the numbers behind it. */
export interface DeckValidation {
  /** `''` when the deck would be accepted. */
  problem: DeckProblem;
  /** Offending card, when the problem is about one card (`''` otherwise). */
  cardId: string;
  /** Cards still missing to reach {@link DECK_SIZE} (`0` when complete). */
  missing: number;
  /** Copies of high-rarity cards in the deck. */
  highRarity: number;
  /** Copies of strong-interference cards in the deck. */
  interference: number;
}

/** The deck a draft was loaded from (`decks.list`'s active entry). */
export interface DeckSource {
  deckId: string;
  name: string;
  format: string;
  cardIds: string[];
}

/** One card the player owns, with the number of copies available. */
export interface DeckPoolEntry {
  cardId: string;
  owned: number;
}

/** One of the {@link DECK_SIZE} slots of the draft, resolved for rendering. */
export interface DeckSlotView {
  /** 0-based slot index; the screen prints `index + 1`. */
  index: number;
  /** Card in the slot, or `''` when the slot is empty. */
  cardId: string;
  /** Display name — the card id, the only name the wire carries. */
  name: string;
  /** Rarity label, or `''` for an unknown card / an empty slot. */
  rarity: string;
  /** One-line effect summary, or `''` for an unknown card / an empty slot. */
  effect: string;
}

/** One row of the "my cards" list. */
export interface DeckCandidateView {
  cardId: string;
  name: string;
  rarity: string;
  effect: string;
  /** Copies the inventory holds. */
  owned: number;
  /** Copies currently in the draft. */
  used: number;
  /** Highest number of copies this card may contribute. */
  cap: number;
  /** True while another copy may be added. */
  canAdd: boolean;
  /** True while a copy may be taken out. */
  canRemove: boolean;
  /** True when the card is banned in the draft's format. */
  banned: boolean;
}

/** Everything a deck screen renders in one pass. */
export interface DeckDraftView {
  deckId: string;
  name: string;
  format: string;
  count: number;
  maxSize: number;
  /** Cards still missing to reach `maxSize`. */
  missing: number;
  highRarity: number;
  maxHighRarity: number;
  interference: number;
  maxInterference: number;
  slots: DeckSlotView[];
  candidates: DeckCandidateView[];
  /** True when the draft differs from the deck it was loaded from. */
  dirty: boolean;
  canSave: boolean;
  canClear: boolean;
  /** The first reason saving is refused (`''` when it is allowed). */
  problem: DeckProblem;
  /** Offending card for a card-specific problem. */
  problemCardId: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Candidate pool from the inventory: one entry per owned card, copies summed.
 *
 * Duplicate stacks for the same card are folded together (the lobby sends one
 * entry per card, but a merged payload must not double-count and let the player
 * save more copies than they own). Cards with no copies are dropped: they can
 * never be added to a deck.
 */
export function deckPoolFromInventory(inventory: InventoryView | null): DeckPoolEntry[] {
  if (inventory === null) {
    return [];
  }
  const totals = new Map<string, number>();
  for (const item of inventory.items) {
    if (item.cardId === '' || item.copies <= 0) {
      continue;
    }
    totals.set(item.cardId, (totals.get(item.cardId) ?? 0) + item.copies);
  }
  return [...totals].map(([cardId, owned]) => ({ cardId, owned }));
}

/**
 * The deck a draft starts from: the active one, or an empty source.
 *
 * `activeDeckId` is the server's own pointer; when it is missing or names a
 * deck that is not in the list, the `active` flag on the entries decides. A
 * player with no decks gets an empty draft they can fill and save.
 */
export function deckSourceFromDecks(decks: DecksView | null): DeckSource {
  if (decks === null) {
    return { deckId: '', name: '', format: '', cardIds: [] };
  }
  const active =
    decks.decks.find((deck) => deck.deckId !== '' && deck.deckId === decks.activeDeckId) ??
    decks.decks.find((deck) => deck.active) ??
    null;
  if (active === null) {
    return { deckId: '', name: '', format: '', cardIds: [] };
  }
  return {
    deckId: active.deckId,
    name: active.name,
    format: active.format,
    cardIds: [...active.cardIds],
  };
}

/** Blank → `local_practice`, anything else trimmed and kept verbatim. */
export function normalizeDeckFormat(format: string): string {
  const trimmed = format.trim();
  return trimmed === '' ? DEFAULT_DECK_FORMAT : trimmed;
}

/** True when `cardId` counts towards {@link MAX_HIGH_RARE_CARDS}. */
export function isHighRarityCard(cardId: string): boolean {
  const definition = cardEffectDefinition(cardId);
  return definition !== null && HIGH_RARITIES.includes(definition.rarity);
}

/** True when `cardId` is one of the strong-interference cards. */
export function isInterferenceCard(cardId: string): boolean {
  return STRONG_INTERFERENCE_CARDS.includes(cardId);
}

/** True when `cardId` is banned in `format`. */
export function isBannedInFormat(cardId: string, format: string): boolean {
  return normalizeDeckFormat(format) === RANKED_DECK_FORMAT && RANKED_BANNED_CARDS.includes(cardId);
}

// ---------------------------------------------------------------------------
// Pure legality check
// ---------------------------------------------------------------------------

/**
 * Legality of an arbitrary ordered card-id list, mirroring the lobby's
 * `validateDeckRecordForUser` in the same order, so the client reports the same
 * first failure the server would.
 */
export function validateDeck(
  cardIds: readonly string[],
  pool: readonly DeckPoolEntry[],
  format = DEFAULT_DECK_FORMAT,
): DeckValidation {
  const normalizedFormat = normalizeDeckFormat(format);
  const owned = new Map(pool.map((entry) => [entry.cardId, entry.owned]));
  const counts = new Map<string, number>();
  let highRarity = 0;
  let interference = 0;
  const verdict = (problem: DeckProblem, cardId = ''): DeckValidation => ({
    problem,
    cardId,
    missing: Math.max(0, DECK_SIZE - cardIds.length),
    highRarity,
    interference,
  });

  if (cardIds.length < DECK_SIZE) {
    return verdict('deck_incomplete');
  }
  if (cardIds.length > DECK_SIZE) {
    return verdict('deck_overflow');
  }
  for (const cardId of cardIds) {
    if (cardId.trim() === '') {
      return verdict('card_not_owned', cardId);
    }
    if (cardEffectDefinition(cardId) === null) {
      // The lobby rejects an id outside `serverCardCatalog` outright.
      return verdict('card_not_owned', cardId);
    }
    const count = (counts.get(cardId) ?? 0) + 1;
    counts.set(cardId, count);
    if (count > MAX_COPIES_PER_CARD) {
      return verdict('copy_cap', cardId);
    }
    const limit = owned.get(cardId) ?? 0;
    if (count > limit) {
      return verdict('copy_limit', cardId);
    }
    if (isHighRarityCard(cardId)) {
      highRarity += 1;
    }
    if (isInterferenceCard(cardId)) {
      interference += 1;
    }
    if (isBannedInFormat(cardId, normalizedFormat)) {
      return verdict('ranked_banned', cardId);
    }
  }
  if (highRarity > MAX_HIGH_RARE_CARDS) {
    return verdict('high_rarity_limit');
  }
  if (interference > MAX_INTERFERENCE_CARDS) {
    return verdict('interference_limit');
  }
  return { problem: '', cardId: '', missing: 0, highRarity, interference };
}

/** Convenience: just the problem id, for callers that do not need the numbers. */
export function deckProblem(
  cardIds: readonly string[],
  pool: readonly DeckPoolEntry[],
  format = DEFAULT_DECK_FORMAT,
): DeckProblem {
  return validateDeck(cardIds, pool, format).problem;
}

/** How many copies of `cardId` a legal deck may take, given ownership. */
export function copyCapFor(cardId: string, pool: readonly DeckPoolEntry[]): number {
  const owned = pool.find((entry) => entry.cardId === cardId)?.owned ?? 0;
  return Math.min(MAX_COPIES_PER_CARD, Math.max(0, owned));
}

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

/** Mutable deck draft: the ordered card list plus the owned pool behind it. */
export class DeckDraft {
  private cards: string[];
  private saved: string[];
  private source: DeckSource;
  private pool: DeckPoolEntry[];

  constructor(source: DeckSource, pool: readonly DeckPoolEntry[]) {
    this.source = { ...source, cardIds: [...source.cardIds] };
    this.cards = [...source.cardIds];
    this.saved = [...source.cardIds];
    this.pool = pool.map((entry) => ({ ...entry }));
  }

  /** The draft, in slot order (a copy — mutate through the methods). */
  get cardIds(): string[] {
    return [...this.cards];
  }

  get deckId(): string {
    return this.source.deckId;
  }

  get name(): string {
    return this.source.name;
  }

  /** The deck's format, normalised (`''` → `local_practice`). */
  get format(): string {
    return normalizeDeckFormat(this.source.format);
  }

  get count(): number {
    return this.cards.length;
  }

  get maxSize(): number {
    return DECK_SIZE;
  }

  /** True when the draft no longer matches the deck it was loaded from. */
  get dirty(): boolean {
    return !sameCards(this.cards, this.saved);
  }

  /** Owned copies of a card (`0` when the player has none). */
  owned(cardId: string): number {
    return this.pool.find((entry) => entry.cardId === cardId)?.owned ?? 0;
  }

  /** Copies of a card currently in the draft. */
  countOf(cardId: string): number {
    return this.cards.filter((card) => card === cardId).length;
  }

  /** Highest number of copies this card may contribute (2, or what is owned). */
  capOf(cardId: string): number {
    return copyCapFor(cardId, this.pool);
  }

  /**
   * Appends one copy of `cardId`.
   *
   * Refuses when the deck is already full, the card is not owned, or the copy
   * cap is reached — the same conditions the lobby rejects, checked in the same
   * order the player would hit them.
   */
  add(cardId: string): DeckProblem {
    const cap = this.capOf(cardId);
    if (cap <= 0) {
      return 'card_not_owned';
    }
    if (this.cards.length >= DECK_SIZE) {
      return 'deck_overflow';
    }
    const used = this.countOf(cardId);
    if (used >= MAX_COPIES_PER_CARD) {
      return 'copy_cap';
    }
    if (used >= cap) {
      return 'copy_limit';
    }
    this.cards.push(cardId);
    return '';
  }

  /** Removes the last copy of `cardId` (the one most recently added). */
  removeLast(cardId: string): DeckProblem {
    for (let index = this.cards.length - 1; index >= 0; index -= 1) {
      if (this.cards[index] === cardId) {
        this.cards.splice(index, 1);
        return '';
      }
    }
    return 'card_not_owned';
  }

  /** Empties one slot. */
  removeAt(index: number): DeckProblem {
    if (!this.validIndex(index)) {
      return 'slot_invalid';
    }
    this.cards.splice(index, 1);
    return '';
  }

  /**
   * Swaps the card in one slot for `cardId` (or empties it when `cardId` is
   * `''`). The replaced copy is taken out *before* the caps are checked, so
   * swapping a card for another copy of itself is always legal.
   */
  replaceAt(index: number, cardId: string): DeckProblem {
    if (!this.validIndex(index)) {
      return 'slot_invalid';
    }
    if (cardId === '') {
      this.cards.splice(index, 1);
      return '';
    }
    const cap = this.capOf(cardId);
    if (cap <= 0) {
      return 'card_not_owned';
    }
    const others = this.countOf(cardId) - (this.cards[index] === cardId ? 1 : 0);
    if (others + 1 > MAX_COPIES_PER_CARD) {
      return 'copy_cap';
    }
    if (others + 1 > cap) {
      return 'copy_limit';
    }
    this.cards[index] = cardId;
    return '';
  }

  /** Moves the card at `from` so it lands at `to`; the rest keeps its order. */
  move(from: number, to: number): DeckProblem {
    if (!this.validIndex(from) || !this.validIndex(to)) {
      return 'slot_invalid';
    }
    if (from === to) {
      return '';
    }
    const [card] = this.cards.splice(from, 1);
    this.cards.splice(to, 0, card);
    return '';
  }

  /** Empties the whole deck (still unsaved — call {@link reset} to commit). */
  clear(): void {
    this.cards = [];
  }

  /**
   * Replaces the draft wholesale, e.g. after a save or a fresh `decks.list`.
   * Both the current list and the "saved" baseline move, so `dirty` goes false.
   */
  reset(source: DeckSource): void {
    this.source = { ...source, cardIds: [...source.cardIds] };
    this.cards = [...source.cardIds];
    this.saved = [...source.cardIds];
  }

  /** Replaces the owned pool (after an inventory refresh) without touching the draft. */
  setPool(pool: readonly DeckPoolEntry[]): void {
    this.pool = pool.map((entry) => ({ ...entry }));
  }

  /**
   * Whole-deck tallies, independent of the first problem found.
   *
   * {@link validate} stops at the first violation (like the lobby), so its
   * counters describe only the prefix it walked. The screen's cap readouts must
   * describe the *whole* deck — otherwise a deck with 8 high-rarity cards shows
   * "6/6" just because a copy cap tripped first.
   */
  tally(): { highRarity: number; interference: number } {
    let highRarity = 0;
    let interference = 0;
    for (const cardId of this.cards) {
      if (isHighRarityCard(cardId)) {
        highRarity += 1;
      }
      if (isInterferenceCard(cardId)) {
        interference += 1;
      }
    }
    return { highRarity, interference };
  }

  /** Full verdict: the first problem plus the counters behind it. */
  validate(): DeckValidation {
    return validateDeck(this.cards, this.pool, this.format);
  }

  get canSave(): boolean {
    return this.validate().problem === '';
  }

  /** Payload for `LobbyClient.saveDeck`, always marking the deck active. */
  toSavePayload(): { deckId: string; name: string; format: string; cardIds: string[]; active: boolean } {
    return {
      deckId: this.source.deckId,
      name: this.source.name,
      format: this.format,
      cardIds: [...this.cards],
      active: true,
    };
  }

  /** The {@link DECK_SIZE} slots, in order, with the empty tail included. */
  slots(): DeckSlotView[] {
    const views: DeckSlotView[] = [];
    for (let index = 0; index < DECK_SIZE; index += 1) {
      const cardId = this.cards[index] ?? '';
      views.push(slotView(index, cardId));
    }
    return views;
  }

  /** One row per owned card, in pool order. */
  candidates(): DeckCandidateView[] {
    const full = this.cards.length >= DECK_SIZE;
    return this.pool.map((entry) => {
      const used = this.countOf(entry.cardId);
      const cap = copyCapFor(entry.cardId, this.pool);
      const definition = cardEffectDefinition(entry.cardId);
      const banned = isBannedInFormat(entry.cardId, this.format);
      return {
        cardId: entry.cardId,
        name: entry.cardId,
        rarity: definition === null ? '' : rarityLabel(definition.rarity),
        effect: describeCardEffect(entry.cardId),
        owned: entry.owned,
        used,
        cap,
        // A banned card may not be added at all: the deck would be unsavable.
        canAdd: used < cap && !full && !banned,
        canRemove: used > 0,
        banned,
      };
    });
  }

  /** Everything the screen renders, in one object. */
  view(): DeckDraftView {
    const validation = this.validate();
    const tally = this.tally();
    return {
      deckId: this.source.deckId,
      name: this.source.name,
      format: this.format,
      count: this.cards.length,
      maxSize: DECK_SIZE,
      missing: validation.missing,
      highRarity: tally.highRarity,
      maxHighRarity: MAX_HIGH_RARE_CARDS,
      interference: tally.interference,
      maxInterference: MAX_INTERFERENCE_CARDS,
      slots: this.slots(),
      candidates: this.candidates(),
      dirty: this.dirty,
      canSave: validation.problem === '',
      canClear: this.cards.length > 0,
      problem: validation.problem,
      problemCardId: validation.cardId,
    };
  }

  private validIndex(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.cards.length;
  }
}

/** Slot view for one index; `''` renders as an empty slot. */
function slotView(index: number, cardId: string): DeckSlotView {
  if (cardId === '') {
    return { index, cardId: '', name: '', rarity: '', effect: '' };
  }
  const definition = cardEffectDefinition(cardId);
  return {
    index,
    cardId,
    name: cardId,
    rarity: definition === null ? '' : rarityLabel(definition.rarity),
    effect: describeCardEffect(cardId),
  };
}

/** Order-sensitive equality of two card lists. */
function sameCards(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}
