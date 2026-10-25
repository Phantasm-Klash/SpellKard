/**
 * Local names for the shop listings.
 *
 * The server's catalogue carries no display name: `ServerShopProduct`
 * (`Gensoulkyo/runtime/core/shop.go`) is `product_id` / `kind` / `cost_kind` /
 * `cost_amount` / `payload` / `quantity` / `rarity` / `season` /
 * `daily_limit` / `purchasable` — and nothing else. The client used to render
 * `item.name || item.itemId`, and since `name` is always empty the shop showed
 * a column of raw ids like `card.bomb_amplifier.single`.
 *
 * So the display names live here, keyed by `product_id`, and the shop falls
 * back to the id when a product is not listed — which is the honest behaviour
 * for something the server adds later: an unknown product still shows up, it
 * just shows its id until a name is added here.
 *
 * The names are plain data rather than `i18n` keys on purpose: the shop scene
 * is the only consumer, and the catalogue is small enough that keeping the
 * four languages side by side makes a missing translation obvious at a glance.
 *
 * NOTE: `core/game/` only — the shop scene reads this, the protocol stack does
 * not.
 */

/** A display name in every language the client ships. */
export interface ShopItemNames {
  /** Simplified Chinese (the default). */
  'zh-Hans': string;
  /** Traditional Chinese. */
  'zh-Hant': string;
  /** Japanese. */
  ja: string;
  /** English. */
  en: string;
}

/**
 * Display names by `product_id`.
 *
 * The seven entries are the catalogue the deployed lobby serves today. A
 * product the server adds but this table does not know renders as its id.
 */
const SHOP_ITEM_NAMES: Readonly<Record<string, ShopItemNames>> = {
  'card.bomb_amplifier.single': {
    'zh-Hans': '炸弹增幅器',
    'zh-Hant': '炸彈增幅器',
    ja: '爆弾増幅器',
    en: 'Bomb Amplifier',
  },
  'card.density_surge.single': {
    'zh-Hans': '弹幕密涌',
    'zh-Hant': '彈幕密湧',
    ja: '弾幕密度波',
    en: 'Density Surge',
  },
  'card.focus_lens.single': {
    'zh-Hans': '集中火力透镜',
    'zh-Hant': '集中火力透鏡',
    ja: '集中火力レンズ',
    en: 'Focus Lens',
  },
  'card.last_arc.single': {
    'zh-Hans': '终末之弧',
    'zh-Hant': '終末之弧',
    ja: '終末の弧',
    en: 'Last Arc',
  },
  'card.purge_charm.single': {
    'zh-Hans': '消弹符',
    'zh-Hant': '消彈符',
    ja: '消弾お守り',
    en: 'Purge Charm',
  },
  'chest.standard.pull': {
    'zh-Hans': '标准卡包',
    'zh-Hant': '標準卡包',
    ja: 'スタンダードパック',
    en: 'Standard Pack',
  },
  'gems.pack.600': {
    'zh-Hans': '宝石 ×600',
    'zh-Hant': '寶石 ×600',
    ja: 'ジェム ×600',
    en: '600 Gems',
  },
};

/** Every `product_id` this table can name, for tests and diagnostics. */
export function knownShopItemIds(): readonly string[] {
  return Object.keys(SHOP_ITEM_NAMES).sort();
}

/**
 * The display name for a `product_id` in `language`.
 *
 * @param language one of the client's language codes
 * @returns the name, or the id itself when the product is not in the table
 */
export function shopItemName(productId: string, language: string): string {
  const names = SHOP_ITEM_NAMES[productId];
  if (names === undefined) {
    // Unknown product: showing the id is better than showing nothing.
    return productId;
  }
  const name = names[language as keyof ShopItemNames];
  return name ?? productId;
}
