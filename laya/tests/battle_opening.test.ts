/**
 * W-1 opening loadout decode.
 *
 * The signed ticket now carries `hand_card_ids`, `initial_energy` and
 * `server_seed` (a DECIMAL STRING). The client must surface them without
 * narrowing the seed: a JSON number above 2^53 is already lossy by the time it
 * reaches JS, so a numeric `server_seed` is treated as absent instead of being
 * coerced — that is the regression this file guards.
 */

import { MAX_OPENING_HAND, openingStateFromPayload } from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

suite('battle opening loadout');

test('reads the snake_case payload the server signs', () => {
  const state = openingStateFromPayload({
    hand_card_ids: ['mirror_lance', 'purge_bell'],
    initial_energy: 2,
    server_seed: '12345678901234567890',
  });
  expect(state !== null, 'a payload with a hand must project a state');
  if (state === null) {
    return;
  }
  expectDeepEqual(state.handCardIds, ['mirror_lance', 'purge_bell'], 'hand ids differ');
  expectEqual(state.initialEnergy, 2, 'energy differs');
  expectEqual(state.serverSeed, '12345678901234567890', 'seed differs');
});

test('reads the camelCase spelling too', () => {
  const state = openingStateFromPayload({
    handCardIds: ['aegis_ward'],
    initialEnergy: 1.5,
    serverSeed: '42',
  });
  expect(state !== null, 'a payload with a hand must project a state');
  if (state === null) {
    return;
  }
  expectDeepEqual(state.handCardIds, ['aegis_ward'], 'hand ids differ');
  expectEqual(state.initialEnergy, 1.5, 'energy differs');
  expectEqual(state.serverSeed, '42', 'seed differs');
});

test('rejects a numeric server_seed instead of narrowing it', () => {
  // 2^53 + 1 cannot be represented as a JS number; the wire must carry text.
  const state = openingStateFromPayload({
    hand_card_ids: ['finale_arc'],
    server_seed: 9007199254740993,
  });
  expect(state !== null, 'a numeric seed must not invalidate the hand');
  if (state === null) {
    return;
  }
  expectEqual(state.serverSeed, '', 'a numeric seed must be dropped, never coerced');
  expectDeepEqual(state.handCardIds, ['finale_arc'], 'the hand must survive');
});

test('keeps a seed above 2^53 verbatim', () => {
  const seed = '9007199254740993';
  const state = openingStateFromPayload({ hand_card_ids: ['a'], server_seed: seed });
  expect(state !== null, 'expected a state');
  if (state === null) {
    return;
  }
  expectEqual(state.serverSeed, seed, 'the seed must survive verbatim');
});

test('deduplicates the hand and caps it at the lobby hand limit', () => {
  const state = openingStateFromPayload({
    hand_card_ids: ['a', 'a', 'b', 'c', 'd', 'e'],
    initial_energy: 0,
  });
  expect(state !== null, 'expected a state');
  if (state === null) {
    return;
  }
  expectDeepEqual(state.handCardIds, ['a', 'b', 'c', 'd'], 'dedup + cap differ');
  expectEqual(state.handCardIds.length, MAX_OPENING_HAND, 'cap differs');
});

test('drops blank and non-string rows without failing the rest', () => {
  const state = openingStateFromPayload({
    hand_card_ids: ['  ', 'keep_me', 7, null, '  also_kept  '],
  });
  expect(state !== null, 'expected a state');
  if (state === null) {
    return;
  }
  expectDeepEqual(state.handCardIds, ['keep_me', 'also_kept'], 'row filtering differs');
});

test('an absent hand projects null (old server or non-object payload)', () => {
  expectEqual(openingStateFromPayload({}), null, 'missing hand must be null');
  expectEqual(openingStateFromPayload({ initial_energy: 3 }), null, 'hand-only null');
  const nonArray = { hand_card_ids: 'mirror_lance' } as unknown as Record<string, unknown>;
  expectEqual(openingStateFromPayload(nonArray), null, 'a non-array hand must be null');
});

test('malformed payloads never throw', () => {
  const weird: Array<Record<string, unknown>> = [
    { hand_card_ids: [] },
    { hand_card_ids: [], initial_energy: -5 },
    { hand_card_ids: [], initial_energy: Number.NaN },
    { hand_card_ids: [], initial_energy: 'nonsense' },
    { hand_card_ids: [], server_seed: '' },
  ];
  for (const payload of weird) {
    const state = openingStateFromPayload(payload);
    expect(state !== null, 'an empty hand is still a valid state');
    if (state === null) {
      return;
    }
    expect(state.initialEnergy >= 0, 'energy must never be negative');
    expect(Number.isFinite(state.initialEnergy), 'energy must stay finite');
  }
});

test('an empty hand is a valid state, not null', () => {
  const state = openingStateFromPayload({ hand_card_ids: [], initial_energy: 0 });
  expect(state !== null, 'an empty hand must still project');
  if (state === null) {
    return;
  }
  expectDeepEqual(state.handCardIds, [], 'hand must be empty');
  expectEqual(state.initialEnergy, 0, 'energy differs');
  expectEqual(state.serverSeed, '', 'seed differs');
});
