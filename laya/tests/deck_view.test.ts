/**
 * Deck-editor coverage: the pure draft model behind the deck screen.
 *
 * The rules asserted here are the lobby's, read from
 * `validateDeckRecordForUser` (`Gensoulkyo/runtime/core/service.go:5368`):
 * **exactly** 20 cards, at most 2 copies per card, no more copies than the
 * inventory holds, at most 6 high-rarity copies, at most 4 strong-interference
 * copies, and `last_arc` / `finale_arc` banned in the `ranked` format.
 *
 * `DeckDraft` is engine-free, so these run without a stage.
 */

import {
  DECK_SIZE,
  DeckDraft,
  MAX_COPIES_PER_CARD,
  MAX_HIGH_RARE_CARDS,
  MAX_INTERFERENCE_CARDS,
  STRONG_INTERFERENCE_CARDS,
  copyCapFor,
  deckPoolFromInventory,
  deckProblem,
  deckSourceFromDecks,
  isBannedInFormat,
  isHighRarityCard,
  normalizeDeckFormat,
  validateDeck,
  type DeckPoolEntry,
} from '../src/core/game/deck_view';
import type { DecksView, InventoryView } from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

/** Inventory fixture: `[cardId, copies]` pairs. */
function inventoryOf(entries: ReadonlyArray<readonly [string, number]>): InventoryView {
  return {
    userId: 'u-1',
    rulesetVersion: 'rs-1',
    items: entries.map(([cardId, copies], index) => ({
      cardId,
      copies,
      level: 1,
      firstObtainedAtMs: index,
    })),
    serverAuthoritative: true,
    wallet: {},
    serverTimeMs: 0,
    raw: {},
  };
}

/** Decks fixture from `[deckId, cardIds, active]` triples. */
function decksOf(
  entries: ReadonlyArray<readonly [string, string[], boolean]>,
  activeDeckId = '',
): DecksView {
  return {
    userId: 'u-1',
    activeDeckId,
    rulesetVersion: 'rs-1',
    decks: entries.map(([deckId, cardIds, active]) => ({
      deckId,
      name: deckId,
      format: 'local_practice',
      rulesetVersion: 'rs-1',
      cardIds,
      active,
    })),
    serverAuthoritative: true,
    serverTimeMs: 0,
    raw: {},
  };
}

/** Seven low-rarity cards, two copies each — 14 cards of "filler". */
const LOW_SEVEN = [
  'focus_lens',
  'hitbox_charm',
  'bomb_amplifier',
  'graze_engine',
  'draw_sigil',
  'tempo_break',
  'purge_charm',
] as const;

/** 14 filler cards (two copies of each of {@link LOW_SEVEN}). */
const LOW14: string[] = LOW_SEVEN.flatMap((cardId) => [cardId, cardId]);

/** Six high-rarity copies: epic `thunder_fall` ×2, rare `aegis_ward` ×2, rare `guard_seal` ×2. */
const HIGH6: string[] = ['thunder_fall', 'thunder_fall', 'aegis_ward', 'aegis_ward', 'guard_seal', 'guard_seal'];

/** A deck the lobby accepts: 6 high-rarity + 14 filler = 20. */
const LEGAL_DECK: string[] = [...HIGH6, ...LOW14];

/** Every card the tests touch, owned in plenty (except where a test says otherwise). */
const POOL: DeckPoolEntry[] = [
  ...LOW_SEVEN.map((cardId) => ({ cardId, owned: 4 })),
  { cardId: 'thunder_fall', owned: 4 },
  { cardId: 'aegis_ward', owned: 4 },
  { cardId: 'guard_seal', owned: 4 },
  { cardId: 'density_surge', owned: 4 },
  { cardId: 'mirror_lance', owned: 4 },
  { cardId: 'aim_baffle', owned: 4 },
  { cardId: 'last_arc', owned: 4 },
  { cardId: 'finale_arc', owned: 4 },
  { cardId: 'purge_bell', owned: 4 },
];

suite('deck: inputs');

test('the pool folds duplicate stacks and drops empty ones', () => {
  const pool = deckPoolFromInventory(
    inventoryOf([
      ['frost_arc', 1],
      ['frost_arc', 2],
      ['iron_veil', 0],
      ['', 5],
      ['ember_lance', 1],
    ]),
  );
  expectDeepEqual(pool, [
    { cardId: 'frost_arc', owned: 3 },
    { cardId: 'ember_lance', owned: 1 },
  ]);
});

test('no inventory means no candidates', () => {
  expectDeepEqual(deckPoolFromInventory(null), []);
});

test('the active deck is picked by id, then by flag, then nothing', () => {
  const byId = deckSourceFromDecks(decksOf([['a', ['frost_arc'], false], ['b', ['iron_veil'], true]], 'a'));
  expectEqual(byId.deckId, 'a');
  expectDeepEqual(byId.cardIds, ['frost_arc']);

  const byFlag = deckSourceFromDecks(decksOf([['a', ['frost_arc'], false], ['b', ['iron_veil'], true]], 'missing'));
  expectEqual(byFlag.deckId, 'b');

  const none = deckSourceFromDecks(decksOf([]));
  expectEqual(none.deckId, '');
  expectDeepEqual(none.cardIds, []);
  expectDeepEqual(deckSourceFromDecks(null).cardIds, []);
});

test('a blank format falls back to local_practice', () => {
  expectEqual(normalizeDeckFormat(''), 'local_practice');
  expectEqual(normalizeDeckFormat('  '), 'local_practice');
  expectEqual(normalizeDeckFormat(' ranked '), 'ranked');
});

test('high-rarity and interference membership match the lobby tables', () => {
  expect(isHighRarityCard('thunder_fall'), 'epic counts as high rarity');
  expect(isHighRarityCard('mirror_lance'), 'rare counts as high rarity');
  expect(!isHighRarityCard('frost_arc'), 'uncommon does not');
  expect(!isHighRarityCard('focus_lens'), 'common does not');
  expectDeepEqual([...STRONG_INTERFERENCE_CARDS], ['density_surge', 'aim_baffle', 'mirror_lance']);
  expect(isBannedInFormat('last_arc', 'ranked'), 'last_arc is banned in ranked');
  expect(!isBannedInFormat('last_arc', 'local_practice'), 'and legal elsewhere');
});

suite('deck: the lobby rules');

test('the deck must hold exactly 20 cards', () => {
  expectEqual(LEGAL_DECK.length, DECK_SIZE);
  expectEqual(deckProblem(LEGAL_DECK, POOL), '');
  // 19 cards: one short.
  const short = LEGAL_DECK.slice(0, DECK_SIZE - 1);
  const shortVerdict = validateDeck(short, POOL);
  expectEqual(shortVerdict.problem, 'deck_incomplete');
  expectEqual(shortVerdict.missing, 1);
  // 21 cards: one over.
  expectEqual(deckProblem([...LEGAL_DECK, 'focus_lens'], POOL), 'deck_overflow');
  // An empty deck is just the extreme of "incomplete".
  expectEqual(deckProblem([], POOL), 'deck_incomplete');
});

test('one card may appear at most twice', () => {
  const thrice = [...LEGAL_DECK.slice(0, DECK_SIZE - 1), 'focus_lens'];
  const verdict = validateDeck(thrice, POOL);
  expectEqual(verdict.problem, 'copy_cap');
  expectEqual(verdict.cardId, 'focus_lens');
  expectEqual(MAX_COPIES_PER_CARD, 2);
});

test('copies are capped by what the inventory holds', () => {
  const pool = POOL.map((entry) => (entry.cardId === 'focus_lens' ? { ...entry, owned: 1 } : entry));
  const verdict = validateDeck(LEGAL_DECK, pool);
  expectEqual(verdict.problem, 'copy_limit');
  expectEqual(verdict.cardId, 'focus_lens');
});

test('high-rarity copies are capped at 6', () => {
  // 8 high-rarity copies: the 6 from LEGAL_DECK plus two epic `last_arc`
  // (epic but *not* an interference card, so only the rarity cap is broken).
  const tooMany = [...LEGAL_DECK.slice(0, DECK_SIZE - 2), 'last_arc', 'last_arc'];
  const verdict = validateDeck(tooMany, POOL);
  expectEqual(verdict.problem, 'high_rarity_limit');
  expectEqual(verdict.highRarity, 8);
  expectEqual(MAX_HIGH_RARE_CARDS, 6);
  // Exactly 6 is fine.
  expectEqual(validateDeck(LEGAL_DECK, POOL).highRarity, 6);
});

test('strong-interference copies are capped at 4', () => {
  // 5 interference copies (2× mirror_lance, 2× density_surge, 1× aim_baffle),
  // 5 high-rarity ones — so only the interference cap is broken.
  const tooMany = [
    'mirror_lance',
    'mirror_lance',
    'density_surge',
    'density_surge',
    'aim_baffle',
    ...LOW14,
    'purge_bell',
  ];
  expectEqual(tooMany.length, DECK_SIZE);
  const verdict = validateDeck(tooMany, POOL);
  expectEqual(verdict.problem, 'interference_limit');
  expectEqual(verdict.interference, 5);
  expectEqual(MAX_INTERFERENCE_CARDS, 4);
  // Exactly 4 is fine.
  const legal = ['mirror_lance', 'mirror_lance', 'density_surge', 'density_surge', ...LOW14, 'purge_bell', 'purge_bell'];
  expectEqual(legal.length, DECK_SIZE);
  expectEqual(validateDeck(legal, POOL).problem, '');
});

test('ranked bans last_arc / finale_arc, other formats do not', () => {
  const withFinale = [...LOW14, 'finale_arc', 'finale_arc', 'thunder_fall', 'thunder_fall', 'aegis_ward', 'aegis_ward'];
  expectEqual(withFinale.length, DECK_SIZE);
  expectEqual(validateDeck(withFinale, POOL, 'local_practice').problem, '');
  const ranked = validateDeck(withFinale, POOL, 'ranked');
  expectEqual(ranked.problem, 'ranked_banned');
  expectEqual(ranked.cardId, 'finale_arc');
});

test('a card outside the catalogue is refused', () => {
  const unknown = [...LEGAL_DECK.slice(0, DECK_SIZE - 1), 'not_a_card'];
  const verdict = validateDeck(unknown, POOL);
  expectEqual(verdict.problem, 'card_not_owned');
  expectEqual(verdict.cardId, 'not_a_card');
});

suite('deck: draft edits');

test('adding stops at two copies of the same card', () => {
  const draft = new DeckDraft({ deckId: 'd1', name: 'd1', format: '', cardIds: [] }, POOL);
  expectEqual(draft.add('focus_lens'), '');
  expectEqual(draft.add('focus_lens'), '');
  expectEqual(draft.add('focus_lens'), 'copy_cap');
  expectEqual(draft.countOf('focus_lens'), 2);
  expectEqual(draft.capOf('focus_lens'), 2);
});

test('the cap is the smaller of two and what is owned', () => {
  const pool: DeckPoolEntry[] = [{ cardId: 'focus_lens', owned: 1 }];
  expectEqual(copyCapFor('focus_lens', pool), 1);
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: [] }, pool);
  expectEqual(draft.add('focus_lens'), '');
  expectEqual(draft.add('focus_lens'), 'copy_limit');
  expectEqual(draft.add('not_owned'), 'card_not_owned');
});

test('adding past 20 cards is refused', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: [...LEGAL_DECK] }, POOL);
  expectEqual(draft.count, DECK_SIZE);
  expectEqual(draft.add('focus_lens'), 'deck_overflow');
});

test('removal takes the last copy out and reports unknown cards', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: ['focus_lens', 'thunder_fall', 'focus_lens'] }, POOL);
  expectEqual(draft.removeLast('focus_lens'), '');
  expectDeepEqual(draft.cardIds, ['focus_lens', 'thunder_fall']);
  expectEqual(draft.removeLast('aegis_ward'), 'card_not_owned');
  expectEqual(draft.removeAt(0), '');
  expectDeepEqual(draft.cardIds, ['thunder_fall']);
  expectEqual(draft.removeAt(5), 'slot_invalid');
});

test('replaceAt swaps in place and counts the outgoing copy as freed', () => {
  const draft = new DeckDraft(
    { deckId: '', name: '', format: '', cardIds: ['thunder_fall', 'focus_lens', 'focus_lens'] },
    POOL,
  );
  // The replaced slot frees itself first, so a second copy of `thunder_fall`
  // (which is already in slot 0) is still legal…
  expectEqual(draft.replaceAt(1, 'thunder_fall'), '');
  expectDeepEqual(draft.cardIds, ['thunder_fall', 'thunder_fall', 'focus_lens']);
  // …but a third copy is not, and the third slot is a different card.
  expectEqual(draft.replaceAt(2, 'thunder_fall'), 'copy_cap');
  expectEqual(draft.replaceAt(2, ''), '');
  expectDeepEqual(draft.cardIds, ['thunder_fall', 'thunder_fall']);
  expectEqual(draft.replaceAt(9, 'focus_lens'), 'slot_invalid');
});

test('move reorders the list and rejects out-of-range indices', () => {
  const draft = new DeckDraft(
    { deckId: '', name: '', format: '', cardIds: ['focus_lens', 'thunder_fall', 'aegis_ward'] },
    POOL,
  );
  expectEqual(draft.move(2, 0), '');
  expectDeepEqual(draft.cardIds, ['aegis_ward', 'focus_lens', 'thunder_fall']);
  expectEqual(draft.move(0, 0), '');
  expectEqual(draft.move(0, 7), 'slot_invalid');
  expectDeepEqual(draft.cardIds, ['aegis_ward', 'focus_lens', 'thunder_fall']);
});

test('clear empties the draft without committing it', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: [...LEGAL_DECK] }, POOL);
  draft.clear();
  expectEqual(draft.count, 0);
  expectEqual(draft.validate().problem, 'deck_incomplete');
  expectEqual(draft.dirty, true);
});

suite('deck: dirty tracking and save payload');

test('a fresh draft is clean and an edit makes it dirty', () => {
  const draft = new DeckDraft({ deckId: 'd1', name: 'Main', format: 'boss_race', cardIds: ['focus_lens'] }, POOL);
  expectEqual(draft.dirty, false);
  draft.add('thunder_fall');
  expectEqual(draft.dirty, true);
  draft.removeLast('thunder_fall');
  expectEqual(draft.dirty, false);
});

test('reset adopts a new baseline so the draft reads clean again', () => {
  const draft = new DeckDraft({ deckId: 'd1', name: 'Main', format: 'boss_race', cardIds: [] }, POOL);
  draft.add('focus_lens');
  expectEqual(draft.dirty, true);
  draft.reset({ deckId: 'd1', name: 'Main', format: 'boss_race', cardIds: [...LEGAL_DECK] });
  expectEqual(draft.dirty, false);
  expectEqual(draft.count, DECK_SIZE);
});

test('the save payload keeps the deck id, normalises the format and activates it', () => {
  const draft = new DeckDraft({ deckId: 'd7', name: 'Main', format: '', cardIds: ['focus_lens'] }, POOL);
  expectDeepEqual(draft.toSavePayload(), {
    deckId: 'd7',
    name: 'Main',
    format: 'local_practice',
    cardIds: ['focus_lens'],
    active: true,
  });
});

test('setPool re-reads ownership without touching the draft', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: [...LEGAL_DECK] }, POOL);
  expectEqual(draft.validate().problem, '');
  draft.setPool([{ cardId: 'focus_lens', owned: 0 }]);
  expectEqual(draft.owned('focus_lens'), 0);
  expectEqual(draft.validate().problem, 'copy_limit');
  expectDeepEqual(draft.cardIds, LEGAL_DECK);
});

suite('deck: view model');

test('the view exposes all 20 slots, filled ones first in order', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: LEGAL_DECK }, POOL);
  const view = draft.view();
  expectEqual(view.slots.length, DECK_SIZE);
  expectEqual(view.slots[0].cardId, 'thunder_fall');
  expectEqual(view.slots[0].name, 'thunder_fall');
  expect(view.slots[0].rarity !== '', 'a known card carries a rarity label');
  expectEqual(view.count, DECK_SIZE);
  expectEqual(view.missing, 0);
  expectEqual(view.maxSize, DECK_SIZE);
  expectEqual(view.canSave, true);
  expectEqual(view.canClear, true);
  expectEqual(view.dirty, false);
  expectEqual(view.problem, '');
  expectEqual(view.highRarity, 6);
  expectEqual(view.maxHighRarity, MAX_HIGH_RARE_CARDS);
  expectEqual(view.interference, 0);
  expectEqual(view.maxInterference, MAX_INTERFERENCE_CARDS);
});

test('an incomplete deck reports how many cards are missing', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: LEGAL_DECK.slice(0, 17) }, POOL);
  const view = draft.view();
  expectEqual(view.canSave, false);
  expectEqual(view.problem, 'deck_incomplete');
  expectEqual(view.missing, 3);
  expectEqual(view.canClear, true);
  expectEqual(view.slots[17].cardId, '');
});

test('candidate rows report used / cap / owned and button availability', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: ['focus_lens', 'focus_lens'] }, POOL);
  const rows = draft.view().candidates;
  const focus = rows.find((row) => row.cardId === 'focus_lens');
  const thunder = rows.find((row) => row.cardId === 'thunder_fall');
  expect(focus !== undefined && thunder !== undefined, 'both cards are listed');
  expectEqual(focus?.used, 2);
  expectEqual(focus?.cap, 2);
  expectEqual(focus?.owned, 4);
  expectEqual(focus?.canAdd, false, 'the two-copy cap is already reached');
  expectEqual(focus?.canRemove, true);
  expectEqual(thunder?.used, 0);
  expectEqual(thunder?.canAdd, true);
  expectEqual(thunder?.canRemove, false);
});

test('a full deck disables every add button', () => {
  const draft = new DeckDraft({ deckId: '', name: '', format: '', cardIds: LEGAL_DECK }, POOL);
  const rows = draft.view().candidates;
  expect(rows.every((row) => !row.canAdd), 'no card may be added to a full deck');
});

test('a card banned in the draft format is flagged and cannot be added', () => {
  const ranked = new DeckDraft({ deckId: '', name: '', format: 'ranked', cardIds: [] }, POOL);
  const row = ranked.view().candidates.find((candidate) => candidate.cardId === 'last_arc');
  expect(row !== undefined, 'last_arc is in the pool');
  expectEqual(row?.banned, true);
  expectEqual(row?.canAdd, false);
});
