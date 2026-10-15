/**
 * Draft-panel presentation model: a `draft_open` renders exactly the server's
 * three candidates, a click submits one `candidate_index`, a spectator gets no
 * pick control, and a local `draft_grant` is the only thing that grows the hand.
 */

import { HandBarController } from '../src/core/game/card_hand_view';
import { buildDraftPanel, DraftPanelController, localGrantCardId } from '../src/core/game/draft_panel_view';
import { draftPickFromEvent, draftViewFromEvent, matchEventViewFromPayload } from '../src/core/game/battle_events';
import { roundCardPickPayload } from '../src/core/net/lobby_client';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

/** A well-formed `draft_open` with `candidates`, first and second pickers. */
function draftOpen(candidates: string[], first: string, second: string) {
  const event = matchEventViewFromPayload({
    seq: 12,
    type: 'draft_open',
    tick: 600,
    user_id: first,
    from_user_id: second,
    action_id: 'boss-1',
    card_id: candidates.join(','),
    round_index: 3,
    expires_tick: 2400,
    reason: 'poolhash123',
  });
  expect(event !== null, 'the draft_open row projects');
  if (event === null) {
    return null;
  }
  return draftViewFromEvent(event);
}

suite('draft panel view');

test('a draft_open with three candidates renders them and clicking the 2nd submits candidate_index 1', () => {
  const draft = draftOpen(['mirror_lance', 'purge_bell', 'aegis_ward'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const calls: Array<{ matchId: string; candidateIndex: number; modeId: string }> = [];
  const controller = new DraftPanelController((matchId, candidateIndex, modeId) =>
    calls.push({ matchId, candidateIndex, modeId }),
  );
  controller.setContext('m-1', 'battle_royale', 'u-first');
  controller.setDraft(draft);

  const panel = controller.panel;
  expect(panel !== null, 'the panel projects');
  if (panel === null) {
    return;
  }
  expectEqual(panel.candidates.length, 3, 'three candidates are rendered');
  expectDeepEqual(
    panel.candidates.map((candidate) => candidate.cardId),
    ['mirror_lance', 'purge_bell', 'aegis_ward'],
    'server order is preserved',
  );
  expectEqual(panel.pickerRole, 'first', 'the first defeater picks first');
  expectEqual(panel.canPick, true, 'the picker gets a control');

  expect(controller.click(1), 'clicking the second candidate submits');
  expectDeepEqual(
    calls,
    [{ matchId: 'm-1', candidateIndex: 1, modeId: 'battle_royale' }],
    'the pick was submitted once with the match context',
  );
  expectDeepEqual(
    roundCardPickPayload(calls[0].matchId, calls[0].candidateIndex, calls[0].modeId).payload,
    { candidate_index: 1 },
    'the payload carries candidate_index 1',
  );
});

test('the second picker may pick, but an out-of-range candidate is rejected', () => {
  const draft = draftOpen(['a', 'b', 'c'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const submitted: number[] = [];
  const controller = new DraftPanelController((_matchId, candidateIndex) => submitted.push(candidateIndex));
  controller.setContext('m-1', '', 'u-second');
  controller.setDraft(draft);
  expectEqual(controller.panel?.pickerRole, 'second', 'the second defeater picks second');
  expect(controller.click(2), 'a candidate in range is submitted');
  expectEqual(controller.click(3), false, 'an out-of-range index is not');
  expectDeepEqual(submitted, [2], 'only the valid click went out');
});

test('a spectator (unknown local id) gets no pick control', () => {
  const draft = draftOpen(['a', 'b', 'c'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const submitted: number[] = [];
  const controller = new DraftPanelController((_matchId, candidateIndex) => submitted.push(candidateIndex));
  controller.setContext('m-1', '', 'u-third');
  controller.setDraft(draft);
  expectEqual(controller.panel?.pickerRole, 'spectator', 'a third player spectates');
  expectEqual(controller.panel?.canPick, false, 'and has no control');
  expectEqual(controller.click(0), false, 'a spectator click is a no-op');

  controller.setContext('m-1', '', '');
  expectEqual(controller.panel?.pickerRole, 'spectator', 'an unknown local id spectates');
  expectEqual(controller.click(0), false, 'and has no control either');
  expectDeepEqual(submitted, [], 'nothing was ever submitted');
});

test('a hidden panel projects nothing and accepts no click', () => {
  const controller = new DraftPanelController(() => {
    throw new Error('a hidden panel must never submit');
  });
  controller.setContext('m-1', '', 'u-first');
  controller.setDraft(null);
  expectEqual(controller.panel, null, 'no round means no panel');
  expectEqual(controller.visible, false, 'the panel is hidden');
  expectEqual(controller.click(0), false, 'a click on a hidden panel is a no-op');
});

test('a round with no candidates is never rendered', () => {
  const empty = { roundIndex: 0, bossId: '', candidates: [], firstUserId: 'u', secondUserId: '', poolHash: '', expiresTick: 0 };
  expectEqual(buildDraftPanel(empty, 'u'), null, 'an empty candidate list hides the panel');
  expectEqual(buildDraftPanel(null, 'u'), null, 'no draft hides the panel');
});

test('a local draft_grant updates the hand; the opponent and a deferred grant do not', () => {
  const controller = new HandBarController();
  controller.setOpening({ handCardIds: ['mirror_lance'], initialEnergy: 1, serverSeed: '' });

  const grant = matchEventViewFromPayload({
    type: 'draft_grant', tick: 700, user_id: 'me', card_id: 'purge_bell',
    action_id: 'grant-7', round_index: 3, status: 'granted',
  });
  expect(grant !== null, 'the grant row projects');
  if (grant === null) {
    return;
  }
  const cardId = localGrantCardId(grant, 'me');
  expectEqual(cardId, 'purge_bell', 'the local grant names the card');
  if (cardId !== null) {
    controller.applyGrant(cardId);
  }
  expectDeepEqual(controller.handCardIds, ['mirror_lance', 'purge_bell'], 'the hand grew');

  expectEqual(localGrantCardId(grant, 'someone-else'), null, "the opponent's grant is not mine");

  const deferred = matchEventViewFromPayload({
    type: 'card_grant_deferred', tick: 700, user_id: 'me', card_id: 'aegis_ward',
    action_id: 'grant-7', round_index: 3, reason: 'hand_full', status: 'deferred',
  });
  expect(deferred !== null, 'the deferred row projects');
  if (deferred === null) {
    return;
  }
  expectEqual(localGrantCardId(deferred, 'me'), null, 'a deferred grant waits in the server');
});

/** A `draft_pick` row naming the card a picker took in a round. */
function draftPick(cardId: string, userId: string, role: string, roundIndex = 3) {
  const event = matchEventViewFromPayload({
    seq: 20,
    type: 'draft_pick',
    tick: 650,
    user_id: userId,
    card_id: cardId,
    action_id: 'boss-1',
    round_index: roundIndex,
    status: role,
  });
  expect(event !== null, 'the draft_pick row projects');
  if (event === null) {
    return null;
  }
  return draftPickFromEvent(event);
}

test('the second picker is offered the two left after the first pick, at their original indices', () => {
  const draft = draftOpen(['mirror_lance', 'purge_bell', 'aegis_ward'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const controller = new DraftPanelController(() => {});
  controller.setContext('m-1', '', 'u-second');
  controller.setDraft(draft);

  const before = controller.panel;
  expect(before !== null, 'the panel projects');
  if (before === null) {
    return;
  }
  expectEqual(before.candidates.length, 3, 'before the pick row arrives all three are on offer');

  const pick = draftPick('purge_bell', 'u-first', 'first');
  expect(pick !== null, 'the pick projects');
  if (pick === null) {
    return;
  }
  expect(controller.notePick(pick), 'the current panel changed');
  const after = controller.panel;
  expect(after !== null, 'the panel still projects');
  if (after === null) {
    return;
  }
  expectDeepEqual(
    after.candidates.map((candidate) => [candidate.cardId, candidate.index]),
    [['mirror_lance', 0], ['aegis_ward', 2]],
    'the taken card is gone; the rest keep their candidate_index',
  );
  expectEqual(after.canPick, true, 'the second picker may still pick');
});

test('a pick for another round does not touch the open panel', () => {
  const draft = draftOpen(['a', 'b', 'c'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const controller = new DraftPanelController(() => {});
  controller.setContext('m-1', '', 'u-second');
  controller.setDraft(draft);
  const pick = draftPick('a', 'u-first', 'first', 9);
  expect(pick !== null, 'the pick projects');
  if (pick === null) {
    return;
  }
  expectEqual(controller.notePick(pick), false, 'the open round did not change');
  const panel = controller.panel;
  expect(panel !== null, 'the panel projects');
  if (panel !== null) {
    expectEqual(panel.candidates.length, 3, 'all three candidates stay on offer');
  }
});

test('the first picker and a spectator keep seeing the full round after a pick row', () => {
  const draft = draftOpen(['mirror_lance', 'purge_bell', 'aegis_ward'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const pick = draftPick('purge_bell', 'u-first', 'first');
  expect(pick !== null, 'the pick projects');
  if (pick === null) {
    return;
  }

  const asFirst = new DraftPanelController(() => {});
  asFirst.setContext('m-1', '', 'u-first');
  asFirst.setDraft(draft);
  asFirst.notePick(pick);
  const firstPanel = asFirst.panel;
  expect(firstPanel !== null, 'the panel projects');
  if (firstPanel !== null) {
    expectEqual(firstPanel.candidates.length, 3, 'the first picker still sees every candidate');
  }

  const asSpectator = new DraftPanelController(() => {});
  asSpectator.setContext('m-1', '', '');
  asSpectator.setDraft(draft);
  asSpectator.notePick(pick);
  const spectatorPanel = asSpectator.panel;
  expect(spectatorPanel !== null, 'the panel projects');
  if (spectatorPanel !== null) {
    expectEqual(spectatorPanel.candidates.length, 3, 'a spectator still sees every candidate');
  }
});

test('the second picker cannot click the card the first picker took', () => {
  const draft = draftOpen(['mirror_lance', 'purge_bell', 'aegis_ward'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const calls: number[] = [];
  const controller = new DraftPanelController((_, candidateIndex) => calls.push(candidateIndex));
  controller.setContext('m-1', '', 'u-second');
  controller.setDraft(draft);
  const pick = draftPick('purge_bell', 'u-first', 'first');
  expect(pick !== null, 'the pick projects');
  if (pick === null) {
    return;
  }
  controller.notePick(pick);

  expectEqual(controller.click(1), false, 'the taken card is no longer on offer');
  expect(controller.click(2), 'the last candidate still submits');
  expectDeepEqual(calls, [2], 'exactly one pick was submitted, with the original candidate_index');
});

test('the second picker own pick row leaves the open round untouched', () => {
  const draft = draftOpen(['mirror_lance', 'purge_bell', 'aegis_ward'], 'u-first', 'u-second');
  expect(draft !== null, 'the draft projects');
  if (draft === null) {
    return;
  }
  const controller = new DraftPanelController(() => {});
  controller.setContext('m-1', '', 'u-second');
  controller.setDraft(draft);
  const secondPick = draftPick('aegis_ward', 'u-second', 'second');
  expect(secondPick !== null, 'the pick projects');
  if (secondPick === null) {
    return;
  }
  expectEqual(controller.notePick(secondPick), false, "the second picker's pick is not a first pick");
  const panel = controller.panel;
  expect(panel !== null, 'the panel projects');
  if (panel !== null) {
    expectEqual(panel.candidates.length, 3, 'all three candidates stay on offer');
  }
});
