/**
 * Gift system tests: catalog resolution, the bar's affordability rule, the
 * announcement line, and the glyph paths (they must stay non-empty and centred
 * or the icons silently vanish).
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import { expect, expectEqual, suite, test } from './harness';
import { giftCatalog, giftDefinition, isKnownGift } from '../src/core/game/gift_catalog';
import {
  affordableGiftAt,
  giftAnnouncement,
  giftBarView,
  giftGlyphPath,
} from '../src/core/game/gift_bar_view';

suite('in-match gifts');

test('every catalog entry resolves and carries a cost and a glyph', () => {
  const catalog = giftCatalog();
  expect(catalog.length >= 4, 'the catalog should offer a handful of gifts');
  for (const definition of catalog) {
    expect(giftDefinition(definition.giftId) === definition, `${definition.giftId} resolves`);
    expect(definition.cost >= 0, `${definition.giftId} cost is not negative`);
    expect(definition.name !== '', `${definition.giftId} has a name`);
    expect(giftGlyphPath(definition.glyph).length > 0, `${definition.giftId} has a glyph`);
  }
});

test('an unknown gift id resolves to null instead of a guess', () => {
  expectEqual(giftDefinition('not_a_gift'), null);
  expect(!isKnownGift('not_a_gift'), 'isKnownGift rejects an unknown id');
  expect(isKnownGift('heart'), 'isKnownGift accepts a catalog id');
});

test('the bar greys gifts the energy cannot cover', () => {
  const poor = giftBarView(15, 0);
  expectEqual(poor.slots.length, giftCatalog().length);
  expect(poor.slots[0].affordable, 'the cheapest gift is affordable at 15 energy');
  expect(!poor.slots[3].affordable, 'a 40-cost gift is not affordable at 15 energy');

  const rich = giftBarView(1000, -1);
  expectEqual(rich.selectedIndex, -1);
  for (const slot of rich.slots) {
    expect(slot.affordable, 'everything is affordable at 1000 energy');
  }
});

test('a gift is only sendable when it is both selected and affordable', () => {
  const broke = giftBarView(25, 2);
  expectEqual(broke.selectedIndex, 2);
  expect(broke.slots[2].selected, 'slot 2 is selected');
  // slot 2 costs 30, so a bar built at 25 energy marks it unaffordable even
  // though it is the selected slot.
  expect(!broke.slots[2].affordable, 'a 30-cost gift is greyed at 25 energy');
  expectEqual(affordableGiftAt(broke, 25), null);
  // The same slot becomes sendable once the energy is there.
  const funded = giftBarView(30, 2);
  expect(funded.slots[2].affordable, 'the same gift is affordable at 30 energy');
  expectEqual(affordableGiftAt(funded, 30)?.giftId, funded.slots[2].definition.giftId);
  // An out-of-range selection must not throw or invent a gift.
  expectEqual(affordableGiftAt(giftBarView(100, 99), 100), null);
});

test('the announcement names both sides and the gift', () => {
  expectEqual(giftAnnouncement('heart', 'Marisa', 'Reimu'), 'Marisa 向 Reimu 送出了 心愿');
  // Unknown ids and empty names must still read as a sentence.
  expectEqual(giftAnnouncement('mystery', '', ''), '对手 向 对手 送出了 mystery');
});

test('glyph paths stay inside the unit box so the icons never clip', () => {
  for (const definition of giftCatalog()) {
    for (const [x, y] of giftGlyphPath(definition.glyph)) {
      expect(x >= -0.55 && x <= 0.55, `${definition.giftId} x in range (${x})`);
      expect(y >= -0.55 && y <= 0.55, `${definition.giftId} y in range (${y})`);
    }
  }
});
