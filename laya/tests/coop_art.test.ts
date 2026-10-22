/**
 * 合作模式 TNA 美术映射单测。
 *
 * 钉住 `core/game/coop_art.ts` 的三条约定：
 *  - 座位 → `ply_shot_0N/player_0N.png`（1..4 号自机，越界安全取模）；
 *  - 弹种 0/1/2 → `kome` / `mtama` / `stama`，未知值按 0 处理且不抛错；
 *  - Boss 待机/击破帧固定为 `enemylist01` 的 `stage_boss_01_11` /
 *    `stage_boss_damage_01_11`。
 *
 * 帧是否真的存在于导入树由 `danmaku_atlas_index.test.ts` 逐项核对 index.json。
 */

import {
  COOP_BOSS_ART,
  COOP_BOSS_DEFEATED_ART,
  allCoopArtFrames,
  coopBulletArt,
  coopPlayerArt,
} from '../src/core/game/coop_art';
import { expect, expectEqual, suite, test } from './harness';

suite('coop art mapping');

test('each seat maps to its own ply_shot atlas frame', () => {
  for (let seat = 0; seat < 4; seat += 1) {
    const art = coopPlayerArt(seat);
    const n = String(seat + 1).padStart(2, '0');
    expectEqual(art.atlas, `ply_shot_${n}`, `seat ${seat} atlas`);
    expectEqual(art.frame, `player_${n}.png`, `seat ${seat} frame`);
  }
});

test('out-of-range and non-finite seats wrap safely', () => {
  expectEqual(coopPlayerArt(4).atlas, 'ply_shot_01', 'seat 4 wraps to 1');
  expectEqual(coopPlayerArt(-1).atlas, 'ply_shot_04', 'seat -1 wraps to 4');
  expectEqual(coopPlayerArt(Number.NaN).atlas, 'ply_shot_01', 'NaN falls back to 1');
});

test('bullet kinds 0/1/2 pick kome / mtama / stama', () => {
  expectEqual(coopBulletArt(0).frame, 'kome_01.png', 'fan');
  expectEqual(coopBulletArt(1).frame, 'mtama_01.png', 'cannon');
  expectEqual(coopBulletArt(2).frame, 'stama_01.png', 'spiral');
});

test('unknown bullet kinds wrap instead of throwing', () => {
  expectEqual(coopBulletArt(3).frame, 'kome_01.png', 'kind 3 wraps to fan art');
  expectEqual(coopBulletArt(-2).frame, 'mtama_01.png', 'kind -2 wraps to cannon art');
  expectEqual(coopBulletArt(Number.NaN).frame, 'kome_01.png', 'NaN falls back to fan art');
});

test('boss art is the enemylist01 idle/damage pair', () => {
  expectEqual(COOP_BOSS_ART.atlas, 'enemylist01');
  expectEqual(COOP_BOSS_ART.frame, 'stage_boss_01_11.png');
  expectEqual(COOP_BOSS_DEFEATED_ART.atlas, 'enemylist01');
  expectEqual(COOP_BOSS_DEFEATED_ART.frame, 'stage_boss_damage_01_11.png');
});

test('allCoopArtFrames covers boss, four seats and three bullet kinds', () => {
  const frames = allCoopArtFrames();
  expect(frames.length >= 9, `expected >= 9 coop art frames, got ${frames.length}`);
  const keys = new Set(frames.map((frame) => `${frame.atlas}/${frame.frame}`));
  expect(keys.has('enemylist01/stage_boss_01_11.png'), 'missing boss idle');
  expect(keys.has('ply_shot_01/player_01.png'), 'missing seat 0 ship');
  expect(keys.has('bulletlist01/kome_01.png'), 'missing fan bullet');
});
