/**
 * 合作模式战斗画面布局（引擎无关、零依赖、可单测）。
 *
 * 与 `battle_layout.ts` 的关系：2 人房直接复用既有 2:3 竖屏布局；4 人房改用
 * **方形战场**（合作模式是四向对称的方形竞技场，竖屏会浪费两侧空间），
 * HUD 仍是右侧竖条，居中规则沿用 battleLayout 的 floor 约定（奇数像素留右边，
 * 保证 originX + contentWidth ≤ stageWidth）。
 */

import { battleLayout, MAX_HUD_WIDTH, MIN_HUD_WIDTH, type BattleLayout } from './battle_layout';

export function coopBattleLayout(width: number, height: number, seatCount: number): BattleLayout {
  if (seatCount <= 2) {
    return battleLayout(width, height);
  }
  const stageWidth = Math.max(0, width);
  const stageHeight = Math.max(0, height);
  // 方形战场：以高度为上限，并给 HUD 留出最小可读宽度。
  const side = Math.min(stageHeight, Math.max(0, stageWidth - MIN_HUD_WIDTH));
  const hudWidth = Math.min(Math.max(0, stageWidth - side), MAX_HUD_WIDTH);
  const contentWidth = side + hudWidth;
  const originX = Math.max(0, Math.floor((stageWidth - contentWidth) / 2));
  return {
    playfield: { width: side, height: side },
    playfieldX: originX,
    playfieldY: Math.round((stageHeight - side) / 2),
    hudX: originX + side,
    hudWidth,
    hudHeight: stageHeight,
    rightGutter: Math.max(0, stageWidth - originX - contentWidth),
  };
}
