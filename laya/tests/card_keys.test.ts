/**
 * Card-slot key mapping: the digit keys `1`..`4` map onto **0-based** wire
 * slots (key `1` = the first card), and the armed slot is transient — it
 * survives exactly one packet, matching the wire's `-1` no-card sentinel.
 *
 * Regression guard for the old `keyCode - KEY_1 + 1` mapping, which was
 * 1-based: key `1` cast the second card and key `4` produced an out-of-range
 * slot the server rejects (`cast_card_slot_out_of_range`).
 */

import { CARD_KEY_CODES, CardCastIntent, CardKeyState, cardSlotForKeyCode } from '../src/core/game/input';
import { expect, expectDeepEqual, expectEqual, suite, test } from './harness';

suite('card slot keys');

test('key 1 arms the first slot (0) and key 4 the last (3)', () => {
  expectEqual(cardSlotForKeyCode(49), 0, 'key 1 is slot 0');
  expectEqual(cardSlotForKeyCode(50), 1, 'key 2 is slot 1');
  expectEqual(cardSlotForKeyCode(51), 2, 'key 3 is slot 2');
  expectEqual(cardSlotForKeyCode(52), 3, 'key 4 is slot 3');
  expectDeepEqual([...CARD_KEY_CODES], [49, 50, 51, 52], 'the mapped key codes');
});

test('a key outside 1..4 is not a card slot', () => {
  expectEqual(cardSlotForKeyCode(53), -1, 'key 5 is not a card key');
  expectEqual(cardSlotForKeyCode(48), -1, 'key 0 is not a card key');
  expectEqual(cardSlotForKeyCode(90), -1, 'key Z is not a card key');
});

test('every mapped slot is accepted by the cast intent (0..3)', () => {
  for (const code of CARD_KEY_CODES) {
    const slot = cardSlotForKeyCode(code);
    const intent = new CardCastIntent();
    expect(intent.request(slot), `slot ${slot} from key code ${code} must be in range`);
  }
});

test('the armed slot survives exactly one packet, then resets', () => {
  const keys = new CardKeyState();
  expectEqual(keys.slot, -1, 'starts with no card');
  keys.press(49);
  expectEqual(keys.slot, 0, 'key 1 arms slot 0');
  keys.press(52);
  expectEqual(keys.slot, 3, 'key 4 arms slot 3');
  keys.consume();
  expectEqual(keys.slot, -1, 'consume resets to the no-card sentinel');
});

test('a non-card key never changes the armed slot', () => {
  const keys = new CardKeyState();
  keys.press(49);
  keys.press(90); // Z (shoot)
  keys.press(53); // 5
  expectEqual(keys.slot, 0, 'only the card keys arm a slot');
  keys.consume();
  keys.press(90);
  expectEqual(keys.slot, -1, 'a lone non-card key still reads as no card');
});
