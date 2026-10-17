/**
 * In-match interactive gifts: what a player can hand to a character mid-race.
 *
 * A gift is a *social* interaction, not a simulation effect: it costs one of
 * the player's **gift charges** (an independent per-match pool — NOT card
 * energy), it is announced to both players through the match event stream,
 * and it is drawn from a real 64x64 icon when the asset tree ships one (see
 * {@link ./gift_assets}) with the scene's own vector glyph as the fallback.
 * Keeping the effect out of the deterministic simulation is what lets a `.dem`
 * replay stay byte-identical: a gift changes what the players see, never what
 * the server ticks.
 *
 * The price table mirrors the lobby's `GiftCatalog` / `giftChargeBudget`
 * (`Gensoulkyo/runtime/core/gifts.go`): a gift spends charges, never card
 * energy, so a player at 0 energy can still be generous. Charges are counted
 * **per sender** (the recipient is never charged) and do not migrate across
 * matches.
 *
 * 版权：东方同人逆向成果，仅用于自研玩法。
 */

/** Glyph shapes the gift bar draws, resolved by {@link giftGlyph}. */
export type GiftGlyphKind =
  | 'heart'
  | 'star'
  | 'ribbon'
  | 'lantern'
  | 'wand'
  | 'cup';

/**
 * Gift charges every player gets per match. Mirrors the lobby's
 * `giftChargeBudget` (`Gensoulkyo/runtime/core/gifts.go`) — the two must stay
 * equal or the client's grey-out preview disagrees with the server's refusals.
 * Sending the whole catalog once costs 10, so 5 is a real choice.
 */
export const GIFT_CHARGE_BUDGET = 5;

export interface GiftDefinition {
  readonly giftId: string;
  /** Player-facing name (Chinese, matching the rest of the UI). */
  readonly name: string;
  /** One-line description shown in the gift bar tooltip. */
  readonly blurb: string;
  /**
   * Gift charges the sender spends (see {@link GIFT_CHARGE_BUDGET}). This is
   * NOT card energy: the two pools are fully decoupled.
   */
  readonly cost: number;
  /** Glyph the icon is drawn from when no bitmap is available. */
  readonly glyph: GiftGlyphKind;
  /**
   * Optional bitmap icon: a file name relative to the gift asset root (see
   * {@link ./gift_assets}), e.g. `gift_heart.png`. When present the gift bar
   * draws the texture; when absent — or when the file fails to load — it falls
   * back to the vector {@link glyph}. Omitting the field entirely is allowed:
   * the glyph is the guaranteed-drawable path.
   */
  readonly icon?: string;
  /** Accent colour used for the glyph and the toast, as `0xRRGGBB`. */
  readonly accent: number;
}

/**
 * The gift catalog. Ids are stable wire values: the lobby echoes them back in
 * `gift_sent` events, so renaming one is a protocol change.
 *
 * `cost` is in gift charges, mirroring `Gensoulkyo/runtime/core/gifts.go`:
 * heart/star/ribbon = 1, lantern/wand = 2, cup = 3.
 */
export const GIFT_IDS = ['heart', 'star', 'ribbon', 'lantern', 'wand', 'cup'] as const;

export type GiftId = (typeof GIFT_IDS)[number];

const GIFTS: Readonly<Record<string, GiftDefinition>> = {
  heart: {
    giftId: 'heart',
    name: '心愿',
    blurb: '把一份心意递给对方',
    cost: 1,
    glyph: 'heart',
    accent: 0xff5f8d,
    icon: 'gift_heart.png',
  },
  star: {
    giftId: 'star',
    name: '星砂',
    blurb: '撒一把会发光的碎星',
    cost: 1,
    glyph: 'star',
    accent: 0xffd166,
    icon: 'gift_star.png',
  },
  ribbon: {
    giftId: 'ribbon',
    name: '丝带',
    blurb: '系一个蝴蝶结过去',
    cost: 1,
    glyph: 'ribbon',
    accent: 0x8ecae6,
    icon: 'gift_ribbon.png',
  },
  lantern: {
    giftId: 'lantern',
    name: '灯笼',
    blurb: '提一盏灯照路',
    cost: 2,
    glyph: 'lantern',
    accent: 0xff8fab,
    icon: 'gift_lantern.png',
  },
  wand: {
    giftId: 'wand',
    name: '御币',
    blurb: '借一根扫帚……不，御币',
    cost: 2,
    glyph: 'wand',
    accent: 0xb5e48c,
    icon: 'gift_wand.png',
  },
  cup: {
    giftId: 'cup',
    name: '茶',
    blurb: '请对方喝一杯茶',
    cost: 3,
    glyph: 'cup',
    accent: 0xc8b6ff,
    icon: 'gift_cup.png',
  },
};

/** The gift definition, or `null` for an id this build does not know. */
export function giftDefinition(giftId: string): GiftDefinition | null {
  return GIFTS[giftId] ?? null;
}

/** Every gift, in catalog order — the gift bar renders this list. */
export function giftCatalog(): readonly GiftDefinition[] {
  return GIFT_IDS.map((id) => GIFTS[id]);
}

/** True when `giftId` is one this build can send. */
export function isKnownGift(giftId: string): giftId is GiftId {
  return Object.prototype.hasOwnProperty.call(GIFTS, giftId);
}
