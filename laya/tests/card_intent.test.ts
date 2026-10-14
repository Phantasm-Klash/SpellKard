/**
 * Card intent plumbing: the one-shot cast intent the battle loop consumes, the
 * draft projections the UI renders from, and the mode-action payload the lobby
 * expects for a pick.
 */

import { CardCastIntent, MAX_CARD_SLOTS } from '../src/core/game/input';
import {
  draftGrantFromEvent,
  draftPickFromEvent,
  draftPickerRole,
  draftViewFromEvent,
  matchEventViewFromPayload,
} from '../src/core/game/battle_events';
import { roundCardPickPayload } from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

suite('card cast intent');

test('arms a slot for exactly one packet', () => {
  const intent = new CardCastIntent();
  expectEqual(intent.armed, false, 'starts disarmed');
  expect(intent.request(2), 'slot 2 is in range');
  expectEqual(intent.armed, true, 'armed after a request');
  expectEqual(intent.take(), 2, 'the armed slot is taken');
  expectEqual(intent.armed, false, 'disarmed after take');
  expectEqual(intent.take(), -1, 'a second take yields the no-card sentinel');
});

test('rejects out-of-range and non-integer slots instead of clamping', () => {
  const intent = new CardCastIntent();
  expectEqual(intent.request(-1), false, 'the sentinel is not a cast');
  expectEqual(intent.request(MAX_CARD_SLOTS), false, 'the hand limit is exclusive');
  expectEqual(intent.request(1.5), false, 'a fractional slot is rejected');
  expectEqual(intent.request(Number.NaN), false, 'NaN is rejected');
  expectEqual(intent.armed, false, 'nothing was armed');
});

test('cancel clears a pending cast', () => {
  const intent = new CardCastIntent();
  intent.request(0);
  intent.cancel();
  expectEqual(intent.take(), -1, 'a cancelled cast must not fire');
});

suite('draft events');

test('projects a draft_open row (candidates are comma-joined in card_id)', () => {
  const event = matchEventViewFromPayload({
    seq: 12,
    type: 'draft_open',
    tick: 600,
    user_id: 'u-first',
    from_user_id: 'u-second',
    action_id: 'boss-1',
    card_id: 'mirror_lance,purge_bell,aegis_ward',
    round_index: 3,
    expires_tick: 2400,
    reason: 'poolhash123',
    value: 3,
  });
  expect(event !== null, 'a well-formed row projects');
  if (event === null) {
    return;
  }
  const draft = draftViewFromEvent(event);
  expect(draft !== null, 'draft_open must project a view');
  if (draft === null) {
    return;
  }
  expectDeepEqual(draft.candidates, ['mirror_lance', 'purge_bell', 'aegis_ward'], 'candidates differ');
  expectEqual(draft.firstUserId, 'u-first', 'first picker differs');
  expectEqual(draft.secondUserId, 'u-second', 'second picker differs');
  expectEqual(draft.bossId, 'boss-1', 'boss id differs');
  expectEqual(draft.poolHash, 'poolhash123', 'pool hash differs');
  expectEqual(draft.expiresTick, 2400, 'deadline differs');
  expectEqual(draft.roundIndex, 3, 'round differs');
});

test('a malformed draft_open (no candidates) projects null', () => {
  const event = matchEventViewFromPayload({ type: 'draft_open', tick: 1, card_id: ' , ' });
  expect(event !== null, 'the row itself is usable');
  if (event === null) {
    return;
  }
  expectEqual(draftViewFromEvent(event), null, 'an empty candidate list is not a draft');
});

test('non-draft rows project null', () => {
  const event = matchEventViewFromPayload({ type: 'graze', tick: 3 });
  expect(event !== null, 'the row itself is usable');
  if (event === null) {
    return;
  }
  expectEqual(draftViewFromEvent(event), null, 'graze is not a draft');
  expectEqual(draftGrantFromEvent(event), null, 'graze is not a grant');
  expectEqual(draftPickFromEvent(event), null, 'graze is not a pick');
});

test('draft_grant rows carry a shared grant id; deferred rows are flagged', () => {
  const granted = matchEventViewFromPayload({
    type: 'draft_grant', tick: 700, user_id: 'u-first', card_id: 'purge_bell',
    action_id: 'grant-7', round_index: 3, status: 'granted',
  });
  const deferred = matchEventViewFromPayload({
    type: 'card_grant_deferred', tick: 700, user_id: 'u-second', card_id: 'aegis_ward',
    action_id: 'grant-7', round_index: 3, reason: 'hand_full', status: 'deferred',
  });
  expect(granted !== null && deferred !== null, 'both rows project');
  if (granted === null || deferred === null) {
    return;
  }
  const first = draftGrantFromEvent(granted);
  const second = draftGrantFromEvent(deferred);
  expect(first !== null && second !== null, 'both grants project');
  if (first === null || second === null) {
    return;
  }
  expectEqual(first.cardId, 'purge_bell', 'first grant card differs');
  expectEqual(second.cardId, 'aegis_ward', 'second grant card differs');
  expectEqual(first.grantId, 'grant-7', 'grant ids must match');
  expectEqual(second.grantId, 'grant-7', 'grant ids must match');
  expectEqual(first.deferred, false, 'the first grant is immediate');
  expectEqual(second.deferred, true, 'the deferred row must be flagged');
});

test('draft_pick rows carry the picker role, and the role resolves locally', () => {
  const event = matchEventViewFromPayload({
    type: 'draft_pick', tick: 650, user_id: 'u-second', card_id: 'aegis_ward',
    round_index: 3, status: 'second',
  });
  expect(event !== null, 'the row projects');
  if (event === null) {
    return;
  }
  const pick = draftPickFromEvent(event);
  expect(pick !== null, 'a pick must project');
  if (pick === null) {
    return;
  }
  expectEqual(pick.role, 'second', 'role differs');
  expectEqual(pick.cardId, 'aegis_ward', 'card differs');

  const view = { roundIndex: 3, bossId: 'b', candidates: ['a'], firstUserId: 'u-first', secondUserId: 'u-second', poolHash: 'h', expiresTick: 0 };
  expectEqual(draftPickerRole(view, 'u-first'), 'first', 'first picker role');
  expectEqual(draftPickerRole(view, 'u-second'), 'second', 'second picker role');
  expectEqual(draftPickerRole(view, 'someone-else'), 'spectator', 'a third player spectates');
  expectEqual(draftPickerRole(view, ''), 'spectator', 'an unknown local user spectates');
});

test('the mode-action payload matches the lobby contract', () => {
  expectDeepEqual(
    roundCardPickPayload('m-1', 1, 'battle_royale'),
    {
      match_id: 'm-1',
      mode_id: 'battle_royale',
      action_type: 'select_round_card',
      payload: { candidate_index: 1 },
      client_result_authoritative: false,
    },
    'pick payload differs',
  );
});
