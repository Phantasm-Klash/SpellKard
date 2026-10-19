/**
 * Gacha mirror coverage (T10).
 *
 * The client never rolls — `Gensoulkyo/runtime/core/gacha.go` owns every
 * outcome. This suite pins the *mirror tables* the UI renders so they cannot
 * drift from the server or from the playable shot table:
 *   - 52 character entries derived from PLAYER_SHOTS,
 *   - 13 entries per rarity tier (A1/A2/B1/B2),
 *   - the starter kit 博丽灵梦 A (ReimuA1+A2),
 *   - Mahjong-Soul parity costs (200/1800 gems, 150 faith),
 *   - pool weights/pity matching `gachaPools()`,
 *   - duplicate-shot faith values.
 */

import {
  GACHA_CARD_POOL_ID,
  GACHA_CHARACTER_POOL,
  GACHA_CHARACTER_POOL_ID,
  GACHA_DEFAULT_SHOT_IDS,
  GACHA_FAITH_EXCHANGE_COST,
  GACHA_POOLS,
  GACHA_SINGLE_COST_GEMS,
  GACHA_TEN_COST_GEMS,
  characterRarityFor,
  charaLabel,
  dupeFaithFor,
  gachaPercent,
  gachaPoolMirror,
  gachaWeightTotal,
  rarityRank,
  shotLabel,
} from '../src/core/game/gacha_model';
import { PLAYER_SHOTS } from '../src/core/sim/danmaku/player_loadout';
import { expect, expectEqual, suite, test } from './harness';

suite('gacha mirror: character pool');

test('character pool covers exactly the 52 playable shots', () => {
  expectEqual(GACHA_CHARACTER_POOL.length, 52);
  expectEqual(PLAYER_SHOTS.length, 52);
  const poolIds = new Set(GACHA_CHARACTER_POOL.map((entry) => entry.shotId));
  for (const shot of PLAYER_SHOTS) {
    expect(poolIds.has(shot.name), `shot ${shot.name} missing from the gacha pool`);
  }
  for (const entry of GACHA_CHARACTER_POOL) {
    const shot = PLAYER_SHOTS.find((candidate) => candidate.name === entry.shotId);
    expect(shot !== undefined, `pool entry ${entry.shotId} is not a playable shot`);
    if (shot !== undefined) {
      expectEqual(entry.chara, shot.chara);
      expectEqual(entry.rarity, characterRarityFor(shot.mode, shot.variant));
    }
  }
});

test('rarity tiers split 13/13/13/13 by shot form', () => {
  const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, epic: 0 };
  for (const entry of GACHA_CHARACTER_POOL) {
    counts[entry.rarity] += 1;
  }
  expectEqual(counts.common, 13);
  expectEqual(counts.uncommon, 13);
  expectEqual(counts.rare, 13);
  expectEqual(counts.epic, 13);
  expectEqual(characterRarityFor('A', 1), 'common');
  expectEqual(characterRarityFor('A', 2), 'uncommon');
  expectEqual(characterRarityFor('B', 1), 'rare');
  expectEqual(characterRarityFor('B', 2), 'epic');
});

test('starter kit is 博丽灵梦 A (both A variants, Reimu)', () => {
  expectEqual(GACHA_DEFAULT_SHOT_IDS.length, 2);
  expectEqual(GACHA_DEFAULT_SHOT_IDS[0], 'ReimuA1');
  expectEqual(GACHA_DEFAULT_SHOT_IDS[1], 'ReimuA2');
  for (const shotId of GACHA_DEFAULT_SHOT_IDS) {
    const entry = GACHA_CHARACTER_POOL.find((candidate) => candidate.shotId === shotId);
    expect(entry !== undefined, `${shotId} must exist in the pool`);
    if (entry !== undefined) {
      expectEqual(entry.chara, 'Reimu');
      expectEqual(charaLabel(entry.chara), '博丽灵梦');
    }
  }
  expectEqual(shotLabel('ReimuA1'), '博丽灵梦 A·1');
  expectEqual(shotLabel('MarisaB2'), '雾雨魔理沙 B·2');
});

test('duplicate faith scales by rarity', () => {
  expectEqual(dupeFaithFor('common'), 10);
  expectEqual(dupeFaithFor('uncommon'), 20);
  expectEqual(dupeFaithFor('rare'), 40);
  expectEqual(dupeFaithFor('epic'), 80);
  expect(rarityRank('epic') > rarityRank('rare'), 'epic outranks rare');
  expect(rarityRank('rare') > rarityRank('uncommon'), 'rare outranks uncommon');
  expect(rarityRank('uncommon') > rarityRank('common'), 'uncommon outranks common');
});

suite('gacha mirror: pools');

test('both pools mirror the server table (weights, pity, costs)', () => {
  expectEqual(GACHA_POOLS.length, 2);
  const card = gachaPoolMirror(GACHA_CARD_POOL_ID);
  const character = gachaPoolMirror(GACHA_CHARACTER_POOL_ID);
  expect(card !== null && character !== null, 'both pools must be mirrored');
  if (card === null || character === null) {
    return;
  }
  // Costs: Mahjong-Soul parity (辉玉 200 / 1800).
  expectEqual(card.costGems, 200);
  expectEqual(card.costTenGems, 1800);
  expectEqual(GACHA_SINGLE_COST_GEMS, 200);
  expectEqual(GACHA_TEN_COST_GEMS, 1800);
  expectEqual(GACHA_FAITH_EXCHANGE_COST, 150);
  // Card weights mirror the chest pool; character pool runs hotter.
  expectEqual(card.weights.common, 70);
  expectEqual(card.weights.epic, 2);
  expectEqual(card.pity.rareEvery, 10);
  expectEqual(card.pity.epicEvery, 60);
  expectEqual(character.weights.common, 50);
  expectEqual(character.weights.epic, 6);
  expectEqual(character.pity.rareEvery, 10);
  expectEqual(character.pity.epicEvery, 30);
  for (const pool of GACHA_POOLS) {
    expect(gachaWeightTotal(pool.weights) > 0, `${pool.poolId} weights must be positive`);
  }
});

test('odds formatting rounds to whole percentages', () => {
  const total = gachaWeightTotal({ common: 70, uncommon: 20, rare: 8, epic: 2 });
  expectEqual(total, 100);
  expectEqual(gachaPercent(70, total), '70%');
  expectEqual(gachaPercent(2, total), '2%');
  expectEqual(gachaPercent(1, 3), '33%');
  expectEqual(gachaPercent(1, 0), '0%');
});
