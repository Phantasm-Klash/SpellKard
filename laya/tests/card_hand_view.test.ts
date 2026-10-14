/**
 * Hand-bar presentation model: the strip is rendered only from the ticket's
 * opening hand, an empty hand draws nothing, and a slot click arms the cast
 * intent for exactly one input packet. The client performs no cost/cooldown
 * gating — that is the point of the "low energy still shows the slot" case.
 */

import { buildHandBar, HandBarController } from '../src/core/game/card_hand_view';
import { MAX_CARD_SLOTS } from '../src/core/game/input';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

suite('hand bar view');

test('an absent or empty hand renders nothing and never throws', () => {
  const absent = buildHandBar(null);
  expectEqual(absent.visible, false, 'a null opening hides the bar');
  expectDeepEqual(absent.slots, [], 'a null opening has no slots');
  expectEqual(absent.energy, 0, 'a null opening has no energy');

  const missing = buildHandBar(undefined);
  expectEqual(missing.visible, false, 'an undefined opening hides the bar');

  const empty = buildHandBar({ handCardIds: [], initialEnergy: 0, serverSeed: '' });
  expectEqual(empty.visible, false, 'an empty hand hides the bar');
  expectDeepEqual(empty.slots, [], 'an empty hand has no slots');
});

test('slots are the server hand, in server order, capped at the cast limit', () => {
  const bar = buildHandBar({
    handCardIds: ['mirror_lance', 'purge_bell'],
    initialEnergy: 2,
    serverSeed: '1',
  });
  expectEqual(bar.visible, true, 'a hand shows the bar');
  expectEqual(bar.slots.length, 2, 'one slot per card');
  expectEqual(bar.slots[0].index, 0, 'the first slot is 0-based');
  expectEqual(bar.slots[1].index, 1, 'the second slot follows');
  expectEqual(bar.slots[0].cardId, 'mirror_lance', 'server order is preserved');
  expectEqual(bar.energy, 2, 'energy is carried verbatim');

  const wide = buildHandBar({ handCardIds: ['a', 'b', 'c', 'd', 'e'], initialEnergy: 0, serverSeed: '' });
  expectEqual(wide.slots.length, MAX_CARD_SLOTS, 'the bar never exceeds the cast limit');
});

test('a known card carries its rarity and summary; an unknown card still shows', () => {
  const bar = buildHandBar({
    handCardIds: ['purge_bell', 'mystery_card'],
    initialEnergy: 0,
    serverSeed: '',
  });
  expectEqual(bar.slots[0].rarity, 'uncommon', 'purge_bell is uncommon');
  expect(bar.slots[0].summary !== '', 'a known card has a summary');
  expectEqual(bar.slots[1].rarity, '', 'an unknown card has no rarity');
  expectEqual(bar.slots[1].summary, '', 'an unknown card has no summary');
  expectEqual(bar.slots[1].cardId, 'mystery_card', 'the raw id is still shown');
});

test('a click arms the intent for exactly one packet', () => {
  const controller = new HandBarController();
  controller.setOpening({ handCardIds: ['mirror_lance', 'purge_bell'], initialEnergy: 2, serverSeed: '' });
  expectEqual(controller.armed, false, 'starts disarmed');
  expect(controller.click(1), 'clicking a filled slot arms it');
  expectEqual(controller.armed, true, 'armed after a click');
  expectEqual(controller.take(), 1, 'the armed slot is the clicked one');
  expectEqual(controller.armed, false, 'the cast lasts one packet only');
  expectEqual(controller.take(), -1, 'a second take yields the no-card sentinel');
});

test('a click on an empty slot never arms', () => {
  const controller = new HandBarController();
  controller.setOpening({ handCardIds: ['mirror_lance'], initialEnergy: 2, serverSeed: '' });
  expectEqual(controller.click(1), false, 'slot 1 holds no card');
  expectEqual(controller.click(-1), false, 'the sentinel is not a click');
  expectEqual(controller.click(MAX_CARD_SLOTS), false, 'past the hand limit');
  expectEqual(controller.armed, false, 'nothing was armed');
});

test('no client-side cost or cooldown check filters a slot', () => {
  // An expensive card with zero energy must still be present and clickable: the
  // client only shows what the server dealt.
  const controller = new HandBarController();
  controller.setOpening({ handCardIds: ['finale_arc'], initialEnergy: 0, serverSeed: '' });
  expectEqual(controller.view.slots.length, 1, 'a costly card is not hidden by low energy');
  expectEqual(controller.energy, 0, 'the energy readout is the server value');
  expect(controller.click(0), 'and the slot is still clickable');
});

test('a changed hand cancels a pending cast; a cleared opening hides the bar', () => {
  const controller = new HandBarController();
  controller.setOpening({ handCardIds: ['aegis_ward'], initialEnergy: 1, serverSeed: '' });
  controller.click(0);
  controller.setOpening({ handCardIds: ['purge_bell'], initialEnergy: 1, serverSeed: '' });
  expectEqual(controller.take(), -1, 'a grant that changed the hand drops the stale click');

  controller.setOpening(null);
  expectEqual(controller.view.visible, false, 'a cleared opening hides the bar');
  expectDeepEqual(controller.view.slots, [], 'and leaves no slots');
});
