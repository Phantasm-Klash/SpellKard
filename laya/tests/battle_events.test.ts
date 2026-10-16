/**
 * `core/game/battle_events` — the bridge from lobby match-event rows to the
 * battle scene's card-effect input and sound channels.
 *
 * The card→effect expectations are hand-derived from `card_records_spec.md`
 * §1.2 (`mirror_lance` = opponent_pattern, `purge_bell` = bullet_purge,
 * `aegis_ward` = invulnerable, `finale_arc` = finisher), so a mismatch between
 * the wire projection and the mirror table fails here.
 */

import {
  eventToSfx,
  matchEventViewFromPayload,
  toCardEffectEvent,
  type MatchEventView,
} from '../src/core/game/battle_events';
import { expect, expectEqual, suite, test } from './harness';

/** A card event row, with the type/card fields the tests vary. */
function cardEvent(overrides: Partial<MatchEventView>): MatchEventView {
  return { seq: 1, type: 'card_effect_applied', tick: 120, ...overrides };
}

suite('match event payload projection');

test('snake_case wire fields are projected to camelCase', () => {
  const view = matchEventViewFromPayload({
    seq: 3,
    type: 'card_effect_applied',
    tick: 120,
    user_id: 'u-1',
    card_id: 'finale_arc',
    slot: 2,
    value: 60,
    reason: 'played',
    expires_tick: 180,
    target_user_id: 'u-2',
    action_id: 'a-1',
    bullet_id: 'b-1',
  });
  expect(view !== null, 'a well-formed row must project');
  expectEqual(view?.seq, 3);
  expectEqual(view?.type, 'card_effect_applied');
  expectEqual(view?.tick, 120);
  expectEqual(view?.userId, 'u-1');
  expectEqual(view?.cardId, 'finale_arc');
  expectEqual(view?.slot, 2);
  expectEqual(view?.value, 60);
  expectEqual(view?.reason, 'played');
  expectEqual(view?.expiresTick, 180);
  expectEqual(view?.targetUserId, 'u-2');
  expectEqual(view?.actionId, 'a-1');
  expectEqual(view?.bulletId, 'b-1');
});

test('camelCase payloads and numeric strings are accepted', () => {
  const view = matchEventViewFromPayload({ type: 'hit', tick: '7', userId: 'u-9', cardId: 'purge_bell' });
  expectEqual(view?.tick, 7);
  expectEqual(view?.userId, 'u-9');
  expectEqual(view?.cardId, 'purge_bell');
});

test('the `to_user_id` spelling also fills targetUserId', () => {
  const view = matchEventViewFromPayload({ type: 'card_effect_applied', tick: 1, to_user_id: 'u-4' });
  expectEqual(view?.targetUserId, 'u-4');
});

test('an unusable row (missing type or tick) projects to null', () => {
  expectEqual(matchEventViewFromPayload({ tick: 1 }), null);
  expectEqual(matchEventViewFromPayload({ type: 'hit' }), null);
  expectEqual(matchEventViewFromPayload({ type: 'hit', tick: 'later' }), null);
  expectEqual(matchEventViewFromPayload({ type: '', tick: 1 }), null);
});

test('absent optional fields stay absent rather than empty', () => {
  const view = matchEventViewFromPayload({ type: 'graze', tick: 5, card_id: '' });
  expect(view !== null, 'a graze row projects');
  expect(!('userId' in (view ?? {})), 'no user id on the wire means no field');
  expect(!('cardId' in (view ?? {})), 'an empty card id is dropped');
  expect(!('value' in (view ?? {})), 'no value on the wire means no field');
});

suite('card event to effect');

test('mirror_lance maps to opponent_pattern with patternId = cardId and a resolved target', () => {
  const seen: string[] = [];
  const resolve = (userId: string): string => {
    seen.push(userId);
    return `p-${userId}`;
  };
  const effect = toCardEffectEvent(
    cardEvent({ cardId: 'mirror_lance', userId: 'u-1', targetUserId: 'u-2', value: 8 }),
    resolve,
  );
  expect(effect !== null, 'a known card must produce an effect');
  expectEqual(effect?.cardId, 'mirror_lance');
  expectEqual(effect?.patternId, 'mirror_lance', 'the curtain fires under the card id');
  expectEqual(effect?.targetPlayerId, 'p-u-2');
  expectEqual(effect?.effectKind, undefined, 'the kind is never guessed on the wire');
  expectEqual(seen.length, 1, 'the resolver is called once');
  expectEqual(seen[0], 'u-2', 'the resolver receives the RAW lobby user id');
});

test('mirror_lance without a target keeps patternId and leaves the target unset', () => {
  let called = 0;
  const effect = toCardEffectEvent(cardEvent({ cardId: 'mirror_lance' }), () => {
    called += 1;
    return 'p-x';
  });
  expectEqual(effect?.patternId, 'mirror_lance');
  expect(!('targetPlayerId' in (effect ?? {})), 'no target user id means no target field');
  expectEqual(called, 0, 'the resolver is not consulted without a target');
});

test('purge_bell maps value onto purgeCount', () => {
  const effect = toCardEffectEvent(cardEvent({ cardId: 'purge_bell', value: 7 }), () => 'p-x');
  expectEqual(effect?.cardId, 'purge_bell');
  expectEqual(effect?.purgeCount, 7);
  expectEqual(effect?.effectKind, undefined);
  expect(!('damage' in (effect ?? {})), 'a purge must not read the value as damage');
});

test('aegis_ward (invulnerable) carries no overloaded value', () => {
  const effect = toCardEffectEvent(cardEvent({ cardId: 'aegis_ward', value: 999 }), () => 'p-x');
  expectEqual(effect?.cardId, 'aegis_ward');
  expectEqual(effect?.effectKind, undefined);
  expect(!('damage' in (effect ?? {})), 'invulnerable must not read the value as damage');
  expect(!('purgeCount' in (effect ?? {})), 'invulnerable must not read the value as a purge count');
  expect(!('patternId' in (effect ?? {})), 'invulnerable must not read the value as a pattern');
});

test('finale_arc maps value onto damage', () => {
  const effect = toCardEffectEvent(cardEvent({ cardId: 'finale_arc', value: 60 }), () => 'p-x');
  expectEqual(effect?.cardId, 'finale_arc');
  expectEqual(effect?.damage, 60);
  expectEqual(effect?.effectKind, undefined);
});

test('card_accepted is treated exactly like card_effect_applied', () => {
  const effect = toCardEffectEvent(cardEvent({ type: 'card_accepted', cardId: 'finale_arc', value: 30 }), () => 'p-x');
  expectEqual(effect?.cardId, 'finale_arc');
  expectEqual(effect?.damage, 30);
});

test('an unknown card id maps to null instead of a guessed effect', () => {
  expectEqual(toCardEffectEvent(cardEvent({ cardId: 'mystery_card' }), () => 'p-x'), null);
  expectEqual(toCardEffectEvent(cardEvent({ cardId: '' }), () => 'p-x'), null);
  expectEqual(toCardEffectEvent(cardEvent({}), () => 'p-x'), null);
});

test('non-card events never produce an effect', () => {
  expectEqual(toCardEffectEvent(cardEvent({ type: 'hit', cardId: 'finale_arc' }), () => 'p-x'), null);
  expectEqual(toCardEffectEvent(cardEvent({ type: 'card_expired', cardId: 'finale_arc' }), () => 'p-x'), null);
  expectEqual(toCardEffectEvent(cardEvent({ type: 'graze', cardId: 'mirror_lance' }), () => 'p-x'), null);
});

suite('event sound channels');

test('eventToSfx classifies the audible event families', () => {
  expectEqual(eventToSfx(cardEvent({ type: 'graze' })), 'graze');
  expectEqual(eventToSfx(cardEvent({ type: 'hit' })), 'skill');
  expectEqual(eventToSfx(cardEvent({ type: 'bomb_damage' })), 'skill');
  expectEqual(eventToSfx(cardEvent({ type: 'card_effect_applied' })), 'skill');
  expectEqual(eventToSfx(cardEvent({ type: 'card_accepted' })), 'playerShot');
});

test('a purge effect plays the player SE, other kinds keep the spell SE', () => {
  expectEqual(eventToSfx(cardEvent({ type: 'card_effect_applied', cardId: 'purge_bell' })), 'playerShot');
  expectEqual(eventToSfx(cardEvent({ type: 'card_effect_applied', cardId: 'finale_arc' })), 'skill');
  // An unknown card id must not borrow the player's channel.
  expectEqual(eventToSfx(cardEvent({ type: 'card_effect_applied', cardId: 'not_a_card' })), 'skill');
});

test('silent events map to null', () => {
  expectEqual(eventToSfx(cardEvent({ type: 'round_start' })), null);
  expectEqual(eventToSfx(cardEvent({ type: 'card_expired' })), null);
  expectEqual(eventToSfx(cardEvent({ type: 'match_end' })), null);
});
