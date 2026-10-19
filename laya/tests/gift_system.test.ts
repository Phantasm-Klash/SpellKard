/**
 * Gift system tests: catalog resolution, the charge-based affordability rule,
 * the announcement line, the glyph paths (they must stay non-empty and centred
 * or the icons silently vanish), the bitmap icons (every gift must have a
 * usable icon file *or* a glyph), and the charge derivation from the event
 * stream (the server pushes no count, so the bar's grey-out is derived).
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

import { expect, expectEqual, suite, test } from './harness';
import { GIFT_CHARGE_BUDGET, giftCatalog, giftDefinition, isKnownGift } from '../src/core/game/gift_catalog';
import {
  affordableGiftAt,
  giftAnnouncement,
  giftBarView,
  giftChargesLeft,
  giftChargesSpentFrom,
  giftGlyphPath,
} from '../src/core/game/gift_bar_view';
import type { MatchEventView } from '../src/core/game/battle_events';
import { matchGiftPayload } from '../src/core/net/lobby_client';
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

test('every catalog entry resolves and carries a charge cost and a glyph', () => {
  const catalog = giftCatalog();
  expect(catalog.length >= 4, 'the catalog should offer a handful of gifts');
  let wholeCatalogCost = 0;
  for (const definition of catalog) {
    expect(giftDefinition(definition.giftId) === definition, `${definition.giftId} resolves`);
    expect(definition.cost > 0, `${definition.giftId} costs at least one charge`);
    expect(definition.name !== '', `${definition.giftId} has a name`);
    expect(giftGlyphPath(definition.glyph).length > 0, `${definition.giftId} has a glyph`);
    wholeCatalogCost += definition.cost;
  }
  // The lobby's price table (Gensoulkyo gifts.go): 1/1/1/2/2/3.
  expectEqual(giftDefinition('heart')?.cost, 1, 'heart costs 1');
  expectEqual(giftDefinition('star')?.cost, 1, 'star costs 1');
  expectEqual(giftDefinition('ribbon')?.cost, 1, 'ribbon costs 1');
  expectEqual(giftDefinition('lantern')?.cost, 2, 'lantern costs 2');
  expectEqual(giftDefinition('wand')?.cost, 2, 'wand costs 2');
  expectEqual(giftDefinition('cup')?.cost, 3, 'cup costs 3');
  // One full sweep of the catalog costs more than the per-match budget, so the
  // 5-charge pool is a real choice rather than a formality.
  expect(wholeCatalogCost > GIFT_CHARGE_BUDGET, 'the whole catalog outcosts the budget');
  expectEqual(GIFT_CHARGE_BUDGET, 5, 'the budget mirrors the server giftChargeBudget');
});

test('an unknown gift id resolves to null instead of a guess', () => {
  expectEqual(giftDefinition('not_a_gift'), null);
  expect(!isKnownGift('not_a_gift'), 'isKnownGift rejects an unknown id');
  expect(isKnownGift('heart'), 'isKnownGift accepts a catalog id');
});

test('the bar greys gifts the remaining charges cannot cover', () => {
  const full = giftBarView(GIFT_CHARGE_BUDGET, -1);
  expectEqual(full.slots.length, giftCatalog().length);
  expectEqual(full.selectedIndex, -1);
  for (const slot of full.slots) {
    expect(slot.affordable, `everything is affordable at ${GIFT_CHARGE_BUDGET} charges`);
  }
  // Two charges left: the 1- and 2-cost gifts still fit, cup (3) does not.
  const twoLeft = giftBarView(2, -1);
  expect(twoLeft.slots[0].affordable, 'heart (1) is affordable at 2 charges');
  expect(twoLeft.slots[1].affordable, 'star (1) is affordable at 2 charges');
  expect(twoLeft.slots[2].affordable, 'ribbon (1) is affordable at 2 charges');
  expect(twoLeft.slots[3].affordable, 'lantern (2) is affordable at 2 charges');
  expect(twoLeft.slots[4].affordable, 'wand (2) is affordable at 2 charges');
  expect(!twoLeft.slots[5].affordable, 'cup (3) is greyed at 2 charges');
  // One charge left: only the cheap three survive.
  const oneLeft = giftBarView(1, -1);
  expect(oneLeft.slots[0].affordable, 'heart (1) is affordable at 1 charge');
  expect(!oneLeft.slots[3].affordable, 'lantern (2) is greyed at 1 charge');
  expect(!oneLeft.slots[5].affordable, 'cup (3) is greyed at 1 charge');
});

test('a gift is only sendable when it is both selected and affordable', () => {
  // Slot 5 is cup (3 charges): selected but unaffordable at 2 left.
  const broke = giftBarView(2, 5);
  expectEqual(broke.selectedIndex, 5);
  expect(broke.slots[5].selected, 'slot 5 is selected');
  expect(!broke.slots[5].affordable, 'cup (3) is greyed at 2 charges');
  expectEqual(affordableGiftAt(broke, 2), null);
  // The same slot becomes sendable once the third charge is there.
  const funded = giftBarView(3, 5);
  expect(funded.slots[5].affordable, 'cup (3) is affordable at 3 charges');
  expectEqual(affordableGiftAt(funded, 3)?.giftId, funded.slots[5].definition.giftId);
  // An out-of-range selection must not throw or invent a gift.
  expectEqual(affordableGiftAt(giftBarView(GIFT_CHARGE_BUDGET, 99), GIFT_CHARGE_BUDGET), null);
});

test('gift charges derive from the match event stream', () => {
  const gift = (giftId: string, from: string, value?: number): MatchEventView => ({
    seq: 1,
    type: 'gift_sent',
    tick: 10,
    userId: from,
    cardId: giftId,
    targetUserId: from === 'me' ? 'you' : 'me',
    ...(value === undefined ? {} : { value }),
  });
  // heart (1) + cup (3) from the local player = 4 spent → 1 left. The
  // opponent's star must not count: charges are per sender.
  const events = [gift('heart', 'me'), gift('cup', 'me'), gift('star', 'you')];
  expectEqual(giftChargesSpentFrom(events, 'me'), 4, 'only the local player rows count');
  expectEqual(giftChargesLeft(giftChargesSpentFrom(events, 'me')), 1, 'one charge remains');
  // Non-gift rows and malformed rows contribute nothing.
  const mixed: MatchEventView[] = [
    { seq: 2, type: 'card_effect_applied', tick: 11, cardId: 'heart' },
    gift('', 'me'),
    gift('wand', 'you'),
  ];
  expectEqual(giftChargesSpentFrom(mixed, 'me'), 0, 'non-gift and empty-id rows are free');
  // An id this build does not know falls back to the server's charge value.
  const future = [gift('mystery_gift', 'me', 2)];
  expectEqual(giftChargesSpentFrom(future, 'me'), 2, 'unknown id uses the event value');
  // Pre-sign-in (no local id) counts nothing rather than everyone's gifts.
  expectEqual(giftChargesSpentFrom(events, ''), 0, 'no local id counts nothing');
});

test('the remaining-charge count clamps into the budget', () => {
  expectEqual(giftChargesLeft(0), GIFT_CHARGE_BUDGET, 'nothing spent leaves the full pool');
  expectEqual(giftChargesLeft(4), 1, 'four spent leaves one');
  expectEqual(giftChargesLeft(5), 0, 'a full pool spent reads zero');
  // The stream is a log, not a ledger: a replayed or hostile overspend must
  // read as "none left", never a negative number.
  expectEqual(giftChargesLeft(7), 0, 'an overspend clamps to zero');
  expectEqual(giftChargesLeft(Number.NaN), GIFT_CHARGE_BUDGET, 'a NaN count reads as untouched');
  expectEqual(giftChargesLeft(-3), GIFT_CHARGE_BUDGET, 'a negative count reads as untouched');
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
  const view = giftBarView(GIFT_CHARGE_BUDGET, 0);
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

suite('gift wire contract with the lobby');

test('the gift payload keys match what the lobby reads', () => {
  // The lobby's ModeActionRequest (runtime/core/types.go) reads `action_type`
  // and `payload`, and applyGiftLocked (runtime/core/service.go) reads
  // `payload["gift_id"]`. Neither side's unit test sees the other's keys, so
  // this pins the seam: a rename on either side fails here, not in a live match.
  const payload = matchGiftPayload('match-1', 'heart', 'mvp_boss_race');
  expectEqual(payload['action_type'], 'gift');
  expectEqual(payload['match_id'], 'match-1');
  expectEqual(payload['mode_id'], 'mvp_boss_race');
  expectEqual(payload['client_result_authoritative'], false);
  const inner = payload['payload'];
  expect(typeof inner === 'object' && inner !== null, 'payload is an object');
  const gift = (inner as Record<string, unknown>)['gift_id'];
  expectEqual(gift, 'heart');
  // No extra keys: an unknown key is silently ignored today, which is how a
  // typo survives review.
  expectEqual(Object.keys(payload).sort().join(','), 'action_type,client_result_authoritative,match_id,mode_id,payload');
});

test('the client catalog is the lobby catalog, id for id', () => {
  // runtime/core/gifts.go is the server-side table. If a gift is added there
  // and not here (or priced differently) the bar either shows nothing or the
  // lobby rejects a legitimate send.
  const server: Record<string, number> = {
    heart: 1,
    star: 1,
    ribbon: 1,
    lantern: 2,
    wand: 2,
    cup: 3,
  };
  const client = giftCatalog();
  expectEqual(client.length, Object.keys(server).length);
  for (const definition of client) {
    expect(definition.giftId in server, `${definition.giftId} exists on the lobby`);
    expectEqual(definition.cost, server[definition.giftId], `${definition.giftId} price`);
  }
  for (const id of Object.keys(server)) {
    expect(isKnownGift(id), `${id} is sendable by this build`);
  }
});
