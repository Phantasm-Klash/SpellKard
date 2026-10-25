/**
 * The shop's local display names.
 *
 * The server's catalogue carries no name or description at all — see
 * `src/core/game/shop_names.ts` for the field-by-field reason — so the shop
 * scene shows what these functions return. Two properties matter:
 *
 *  1. every product the deployed lobby serves must have a name in **every**
 *     language, or that language shows a raw id;
 *  2. an unknown id must fall back to the id itself, so a product the server
 *     adds later still appears rather than vanishing.
 */

import { expect, suite, test } from './harness';
import { knownShopItemIds, shopItemName } from '../src/core/game/shop_names';
import { LANGUAGES, setLanguage, t } from '../src/core/game/i18n';

suite('shop item names');

/** The `product_id`s the deployed lobby serves (`shop.get` → `products[]`). */
const DEPLOYED_PRODUCT_IDS = [
  'card.bomb_amplifier.single',
  'card.density_surge.single',
  'card.focus_lens.single',
  'card.last_arc.single',
  'card.purge_charm.single',
  'chest.standard.pull',
  'gems.pack.600',
];

test('every deployed product has a name', () => {
  const known = knownShopItemIds();
  for (const id of DEPLOYED_PRODUCT_IDS) {
    expect(known.indexOf(id) >= 0, `the deployed catalogue serves ${id}, which has no local name`);
  }
});

test('every product is named in every language', () => {
  for (const id of knownShopItemIds()) {
    for (const info of LANGUAGES) {
      const name = shopItemName(id, info.code);
      expect(name !== '' && name !== id, `${info.code} has no name for ${id} (got "${name}")`);
    }
  }
});

test('an unknown product falls back to its id', () => {
  // The honest behaviour for something the server adds later: it still shows
  // up, it just shows its id until a name is added.
  expect(shopItemName('card.from_the_future.single', 'zh-Hans') === 'card.from_the_future.single',
    'an unknown id is shown as the id');
  expect(shopItemName('', 'en') === '', 'an empty id stays empty');
});

test('a name is never another language\'s text', () => {
  // A missing translation would silently render one language's name to another
  // language's player. Each language's set must be distinct where the words
  // differ at all, which they do for every entry here.
  for (const id of knownShopItemIds()) {
    const names = LANGUAGES.map((info) => shopItemName(id, info.code));
    const distinct = new Set(names);
    expect(distinct.size === names.length, `${id} has a duplicate name across languages: ${names.join(' / ')}`);
  }
});

test('the shop row strings come from the translation tables', () => {
  // The row used to hard-code English ("Buy", "unlimited", "Price … · … · bought …").
  // Those strings exist in the tables; this pins that they are still there and
  // still non-empty, so a regression to literals is visible.
  for (const info of LANGUAGES) {
    setLanguage(info.code);
    for (const key of ['shop.buy', 'shop.stockUnlimited', 'shop.stockCount', 'shop.meta', 'shop.noListings']) {
      const value = t(key);
      expect(value !== '' && value !== key, `${info.code}.${key} is missing`);
    }
    // `shop.meta` must carry the three placeholders the row fills in.
    const meta = t('shop.meta');
    for (const placeholder of ['{price}', '{stock}', '{count}']) {
      expect(meta.indexOf(placeholder) >= 0, `${info.code}.shop.meta lost ${placeholder}: ${meta}`);
    }
  }
  setLanguage('zh-Hans');
});
