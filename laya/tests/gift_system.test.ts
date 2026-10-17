/**
 * Gift system tests: catalog resolution, the bar's affordability rule, the
 * announcement line, the glyph paths (they must stay non-empty and centred
 * or the icons silently vanish), and the bitmap icons (every gift must have a
 * usable icon file *or* a glyph, and the shipped files must be real 64x64
 * PNGs so a botched asset drop fails the build instead of blanking the bar).
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
import {
  GIFT_ASSET_DIR,
  GIFT_NATIVE_ROOT,
  GIFT_WEB_ROOT,
  giftAssetRootCandidates,
  giftIconUrl,
  giftIconUrlAt,
  resolveGiftAssetRoot,
} from '../src/core/game/gift_assets';

interface NodeFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
}
declare const require: (id: string) => NodeFs;
declare const __dirname: string;

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

test('every gift has a bitmap icon or a glyph — never neither', () => {
  // The scene draws `icon` when the texture loaded and the glyph otherwise, so
  // an entry with neither would be an invisible slot.
  for (const definition of giftCatalog()) {
    const hasGlyph = giftGlyphPath(definition.glyph).length > 0;
    const hasIcon = definition.icon !== undefined && definition.icon !== '';
    expect(hasGlyph || hasIcon, `${definition.giftId} has an icon or a glyph`);
    if (hasIcon) {
      expect(
        definition.icon!.endsWith('.png'),
        `${definition.giftId} icon is a png (${definition.icon})`,
      );
    }
  }
});

test('the bar stays drawable when a bitmap is missing', () => {
  // The fallback contract: `icon` is optional, and a definition without one is
  // still renderable through its glyph. The shipped catalog carries bitmaps,
  // so this pins the type-level fallback with a stripped definition.
  const stripped = { ...giftCatalog()[0], icon: undefined };
  expect(stripped.icon === undefined, 'icon can be absent');
  expect(giftGlyphPath(stripped.glyph).length > 0, 'the glyph still draws it');
  // …and the view model does not care which path a slot takes.
  const view = giftBarView(1000, 0);
  expectEqual(view.slots.length, giftCatalog().length);
  for (const slot of view.slots) {
    expect(slot.affordable, 'slots stay affordable regardless of the icon');
  }
});

test('every shipped gift icon is a real 64x64 png under the asset root', () => {
  const fs = require('fs');
  const dir = `${__dirname}/../../layaide/assets/resources/${GIFT_ASSET_DIR}`;
  const icons = giftCatalog()
    .map((definition) => definition.icon)
    .filter((icon): icon is string => icon !== undefined);
  expect(icons.length >= 4, 'the catalog ships a handful of icons');
  for (const icon of icons) {
    const path = `${dir}/${icon}`;
    expect(fs.existsSync(path), `${icon} exists under the gift asset root`);
    const bytes = fs.readFileSync(path, 'latin1');
    // 8-byte PNG signature, read byte-exact through latin1.
    expect(bytes.slice(0, 8) === '\x89PNG\r\n\x1a\n', `${icon} carries the png signature`);
    // IHDR: width/height are big-endian uint32 at bytes 16..24.
    const width = ihdrU32(bytes, 16);
    const height = ihdrU32(bytes, 20);
    expectEqual(width, 64, `${icon} width`);
    expectEqual(height, 64, `${icon} height`);
    expect(bytes.length > 200, `${icon} is not empty`);
    expect(bytes.length <= 200 * 1024, `${icon} stays under the 200KB per-icon budget`);
  }
});

function ihdrU32(bytes: string, offset: number): number {
  return (
    (bytes.charCodeAt(offset) * 0x1000000) +
    (bytes.charCodeAt(offset + 1) << 16) +
    (bytes.charCodeAt(offset + 2) << 8) +
    bytes.charCodeAt(offset + 3)
  );
}

test('gift asset roots and urls resolve per deployment', () => {
  expectEqual(GIFT_WEB_ROOT, 'layaide/assets/resources/gifts');
  expectEqual(GIFT_NATIVE_ROOT, 'resources/gifts');
  expectEqual(resolveGiftAssetRoot(false), GIFT_WEB_ROOT);
  expectEqual(resolveGiftAssetRoot(true), GIFT_NATIVE_ROOT);
  // Most-likely-first ordering: the web build is the common case.
  expectEqual(giftAssetRootCandidates(false)[0], GIFT_WEB_ROOT);
  expectEqual(giftAssetRootCandidates(true)[0], GIFT_NATIVE_ROOT);
  expectEqual(giftIconUrl('gift_heart.png', false), 'layaide/assets/resources/gifts/gift_heart.png');
  expectEqual(giftIconUrl('gift_heart.png', true), 'resources/gifts/gift_heart.png');
  // A leading slash joins identically (the `gifts` segment is never doubled).
  expectEqual(giftIconUrl('/gift_heart.png', false), 'layaide/assets/resources/gifts/gift_heart.png');
  expectEqual(giftIconUrlAt(GIFT_NATIVE_ROOT, 'gift_star.png'), 'resources/gifts/gift_star.png');
});
