/**
 * 合作模式布局回归（COOP_MODE_CONTRACT.md §3.2）。
 *
 * 2 人房必须逐字段等于 `battleLayout`（复用既有竖屏）；4 人房是方形战场 +
 * 右侧 HUD，且沿用 battleLayout 的居中不变量（奇数像素留右边、不溢界）。
 */

import { battleLayout, MIN_HUD_WIDTH, type BattleLayout } from '../src/core/game/battle_layout';
import { coopBattleLayout } from '../src/core/game/coop_layout';
import { expect, expectEqual, suite, test } from './harness';

function assertInvariants(layout: BattleLayout, width: number, height: number): void {
  expect(layout.playfieldX >= 0, 'playfieldX >= 0');
  expect(layout.playfieldY >= 0, 'playfieldY >= 0');
  expect(layout.playfield.width >= 0 && layout.playfield.height >= 0, 'non-negative playfield');
  expect(
    layout.playfieldX + layout.playfield.width + layout.hudWidth <= width,
    `content overflows width (${layout.playfieldX}+${layout.playfield.width}+${layout.hudWidth} > ${width})`,
  );
  expectEqual(layout.hudX, layout.playfieldX + layout.playfield.width, 'hudX adjacency');
  expectEqual(
    layout.rightGutter,
    width - layout.playfieldX - layout.playfield.width - layout.hudWidth,
    'rightGutter',
  );
  expect(layout.rightGutter >= 0, 'rightGutter >= 0');
  expect(layout.rightGutter - layout.playfieldX <= 1, 'margins differ by at most 1px');
  expect(layout.playfieldY + layout.playfield.height <= height, 'playfield fits height');
}

suite('coop layout');

test('2-player coop reuses the portrait battle layout', () => {
  const sizes: Array<[number, number]> = [
    [960, 720],
    [1280, 720],
    [1920, 1080],
    [720, 1280],
    [1001, 700],
  ];
  for (const [width, height] of sizes) {
    const coop = coopBattleLayout(width, height, 2);
    const base = battleLayout(width, height);
    expectEqual(coop.playfield.width, base.playfield.width, `2p width @${width}x${height}`);
    expectEqual(coop.playfield.height, base.playfield.height, `2p height @${width}x${height}`);
    expectEqual(coop.playfieldX, base.playfieldX, '2p playfieldX');
    expectEqual(coop.hudWidth, base.hudWidth, '2p hudWidth');
  }
});

test('4-player coop uses a square playfield with a readable HUD', () => {
  const sizes: Array<[number, number]> = [
    [960, 720],
    [1280, 720],
    [1920, 1080],
    [720, 1280],
    [1000, 700],
    [801, 601],
  ];
  for (const [width, height] of sizes) {
    const layout = coopBattleLayout(width, height, 4);
    expectEqual(layout.playfield.width, layout.playfield.height, `square @${width}x${height}`);
    expect(layout.hudWidth >= MIN_HUD_WIDTH, `hud readable @${width}x${height} (${layout.hudWidth})`);
    assertInvariants(layout, width, height);
  }
});

test('degenerate stages never produce negative sizes', () => {
  for (const [width, height] of [[0, 0], [10, 10], [100, 0]] as Array<[number, number]>) {
    const layout = coopBattleLayout(width, height, 4);
    expect(layout.playfield.width >= 0 && layout.playfield.height >= 0, 'non-negative playfield');
    expect(layout.hudWidth >= 0, 'non-negative hud');
  }
});
