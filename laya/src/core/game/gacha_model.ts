/**
 * Client mirror of the gacha pools (cards + characters).
 *
 * The server owns every roll (see `Gensoulkyo/runtime/core/gacha.go` and the
 * design doc `/root/gotouhou/task-queue/out/T10_gacha_design.md`); this module
 * only mirrors the *tables* so the UI can render probabilities, the pity
 * window and the roster without a second opinion about outcomes. Nothing here
 * computes a result.
 *
 * The character table is derived from `PLAYER_SHOTS` (the same table the
 * danmaku simulation mirrors from PhK-BattleServer), so the gacha pool can
 * never drift from the playable roster.
 */

import { PLAYER_SHOTS } from '../sim/danmaku/player_loadout';

/** Pool ids (must match `runtime/core/gacha.go`). */
export const GACHA_CARD_POOL_ID = 'gacha.cards';
export const GACHA_CHARACTER_POOL_ID = 'gacha.characters';

/** Gem costs (Mahjong-Soul parity: 200 single / 1800 ten). */
export const GACHA_SINGLE_COST_GEMS = 200;
export const GACHA_TEN_COST_GEMS = 1800;
/** A pull request is either 1 or 10. */
export const GACHA_TEN_COUNT = 10;

/** Faith well: one faith per pull; 150 faith exchanges any locked shot. */
export const GACHA_FAITH_EXCHANGE_COST = 150;

/** Starter kit every identity owns: 博丽灵梦 A 型. */
export const GACHA_DEFAULT_SHOT_IDS: readonly string[] = ['ReimuA1', 'ReimuA2'];

export type GachaRarity = 'common' | 'uncommon' | 'rare' | 'epic';

/** One rollable character shot with its rarity tier. */
export interface GachaCharacterEntry {
  shotId: string;
  chara: string;
  rarity: GachaRarity;
}

/** Pity rules per pool (soft pity: force rare/epic within the window). */
export interface GachaPityRules {
  rareEvery: number;
  epicEvery: number;
}

/** Mirrored pool definition (rendering only). */
export interface GachaPoolMirror {
  poolId: string;
  kind: 'card' | 'character';
  nameKey: string;
  weights: Record<GachaRarity, number>;
  pity: GachaPityRules;
  costGems: number;
  costTenGems: number;
}

/**
 * Character rarity binds to the shot form: A extra = common, A focus =
 * uncommon, B extra = rare, B focus = epic (13 chars × 4 forms).
 */
export function characterRarityFor(mode: string, variant: number): GachaRarity {
  if (mode === 'A') {
    return variant <= 1 ? 'common' : 'uncommon';
  }
  return variant <= 1 ? 'rare' : 'epic';
}

/** The full 52-entry character pool, derived from the shot table. */
export const GACHA_CHARACTER_POOL: readonly GachaCharacterEntry[] = PLAYER_SHOTS.map((shot) => ({
  shotId: shot.name,
  chara: shot.chara,
  rarity: characterRarityFor(shot.mode, shot.variant),
}));

/** Faith a duplicate shot converts to, by rarity. */
export function dupeFaithFor(rarity: GachaRarity): number {
  switch (rarity) {
    case 'epic':
      return 80;
    case 'rare':
      return 40;
    case 'uncommon':
      return 20;
    default:
      return 10;
  }
}

/** Lower is weaker; used for the ten-pull rare-plus guarantee display. */
export function rarityRank(rarity: GachaRarity): number {
  switch (rarity) {
    case 'epic':
      return 3;
    case 'rare':
      return 2;
    case 'uncommon':
      return 1;
    default:
      return 0;
  }
}

export const GACHA_POOLS: readonly GachaPoolMirror[] = [
  {
    poolId: GACHA_CARD_POOL_ID,
    kind: 'card',
    nameKey: 'screen.gacha.cards',
    weights: { common: 70, uncommon: 20, rare: 8, epic: 2 },
    pity: { rareEvery: 10, epicEvery: 60 },
    costGems: GACHA_SINGLE_COST_GEMS,
    costTenGems: GACHA_TEN_COST_GEMS,
  },
  {
    poolId: GACHA_CHARACTER_POOL_ID,
    kind: 'character',
    nameKey: 'screen.gacha.characters',
    weights: { common: 50, uncommon: 30, rare: 14, epic: 6 },
    pity: { rareEvery: 10, epicEvery: 30 },
    costGems: GACHA_SINGLE_COST_GEMS,
    costTenGems: GACHA_TEN_COST_GEMS,
  },
];

export function gachaPoolMirror(poolId: string): GachaPoolMirror | null {
  for (const pool of GACHA_POOLS) {
    if (pool.poolId === poolId) {
      return pool;
    }
  }
  return null;
}

/** Weight sum, for the percentage display (weights always sum > 0). */
export function gachaWeightTotal(weights: Record<GachaRarity, number>): number {
  return weights.common + weights.uncommon + weights.rare + weights.epic;
}

/** `0.25` → `25%` for the odds line. */
export function gachaPercent(part: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  return `${Math.round((part / total) * 100)}%`;
}

/** Character label for a shot id, e.g. `ReimuA1` → `博丽灵梦 A·1`. */
const CHARA_LABELS: Record<string, string> = {
  Reimu: '博丽灵梦',
  Marisa: '雾雨魔理沙',
  Sanae: '东风谷早苗',
  Sakuya: '十六夜咲夜',
  Reisen: '铃仙',
  Youmu: '魂魄妖梦',
  Aya: '射命丸文',
  Seija: '鬼人正邪',
  Cirno: '琪露诺',
  Yukari: '八云紫',
  Alice: '爱丽丝',
  Remillia: '蕾米莉亚',
  Yuyuko: '西行寺幽幽子',
};

export function charaLabel(chara: string): string {
  return CHARA_LABELS[chara] ?? chara;
}

/** `ReimuA1` → `博丽灵梦 A·1`. */
export function shotLabel(shotId: string): string {
  const entry = GACHA_CHARACTER_POOL.find((candidate) => candidate.shotId === shotId);
  if (entry === undefined) {
    return shotId;
  }
  const mode = entry.shotId.slice(entry.chara.length, entry.chara.length + 1);
  const variant = entry.shotId.slice(entry.chara.length + 1);
  return `${charaLabel(entry.chara)} ${mode}·${variant}`;
}
