/**
 * 合作模式（coop_boss）战斗渲染。
 *
 * 与 `boss_race_view.ts` 同纪律：纯绘制、显式 tick、无模块级可变状态；本文件
 * 只依赖 core 的帧模型与 `theme`/`sprites`，不 import 场景。
 *
 * 画面要点（COOP_MODE_CONTRACT.md §3.3）：
 *  - 方形战场（2 人房在 2:3 竖屏内居中 letterbox），Boss 恒在中心；
 *  - 本地玩家恒在底部朝上（帧已按座位旋转），他机与他弹半透明（alpha 由帧给出）；
 *  - 格挡方向画 Boss 周围扇形弧；巨炮封锁画该方向的宽弹道预警与巨宽弹；
 *  - 旋转弹幕按帧里的子弹圆点绘制（公共弹幕不透明）。
 */

import { CoopBossState } from '../../../core/sim/coop_boss';
import type { CoopBulletItem, CoopFrame, CoopPlayerItem } from '../../../core/game/coop_view_model';
import * as theme from './theme';
import { fade, mix } from './sprites';

const GRID_STEP = 40;
const BOSS_RADIUS_RATIO = 0.075;
const SHIELD_ARC_RADIUS_RATIO = 0.3;
const HP_BAR_HEIGHT = 10;

export interface CoopViewOptions {
  stageWidth: number;
  stageHeight: number;
}

export class CoopView {
  readonly root: Laya.Sprite;
  private readonly graphics: Laya.Graphics;
  private readonly hud: Laya.Sprite;
  private readonly hudGraphics: Laya.Graphics;
  private readonly title: Laya.Text;
  private readonly detail: Laya.Text;
  private width = 0;
  private height = 0;

  constructor(options: CoopViewOptions) {
    this.root = new Laya.Sprite();
    this.root.visible = false;
    this.graphics = this.root.graphics;
    this.hud = new Laya.Sprite();
    this.hudGraphics = this.hud.graphics;
    this.title = new Laya.Text();
    this.title.fontSize = 20;
    this.title.color = theme.COLOR_HUD;
    this.title.bold = true;
    this.detail = new Laya.Text();
    this.detail.fontSize = 14;
    this.detail.color = theme.COLOR_HUD_DIM;
    this.root.addChild(this.hud);
    this.root.addChild(this.title);
    this.root.addChild(this.detail);
    this.root.size(options.stageWidth, options.stageHeight);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 布局：战场矩形 + 舞台尺寸（场景 relayout 时调用）。 */
  layout(playfieldX: number, playfieldY: number, width: number, height: number): void {
    this.root.pos(playfieldX, playfieldY);
    this.root.size(width, height);
    this.width = width;
    this.height = height;
    this.title.pos(8, 6);
    this.detail.pos(8, 28);
  }

  render(frame: CoopFrame): void {
    const g = this.graphics;
    g.clear();
    this.hudGraphics.clear();
    if (this.width <= 0 || this.height <= 0) {
      return;
    }
    this.drawPlayfield(g, frame);
    this.drawShieldArcs(g, frame);
    this.drawLockLane(g, frame);
    this.drawBoss(g, frame);
    for (const bullet of frame.bullets) {
      this.drawBullet(g, bullet);
    }
    for (const player of frame.players) {
      this.drawPlayer(g, player);
    }
    this.drawHud(frame);
  }

  private drawPlayfield(g: Laya.Graphics, frame: CoopFrame): void {
    const w = this.width;
    const h = this.height;
    // 背板
    g.drawRect(0, 0, w, h, theme.COLOR_PLAYFIELD);
    const grid = fade(theme.COLOR_PLAYFIELD_EDGE, 0.55);
    for (let x = GRID_STEP; x < w; x += GRID_STEP) {
      g.drawLine(x, 0, x, h, grid, 1);
    }
    for (let y = GRID_STEP; y < h; y += GRID_STEP) {
      g.drawLine(0, y, w, y, grid, 1);
    }
    // 方形战场边界（letterbox 时可视地标出实际场地）
    const side = Math.min(w, h);
    const left = (w - side) / 2;
    const top = (h - side) / 2;
    g.drawRect(left, top, side, side, null, fade(theme.COLOR_ACCENT, 0.55), 1);
    // 中心环
    const cx = w / 2;
    const cy = h / 2;
    const ring = side * 0.12;
    g.drawCircle(cx, cy, ring, null, fade(theme.COLOR_BOSS_RING, 0.5), 1);
    void frame;
  }

  private drawShieldArcs(g: Laya.Graphics, frame: CoopFrame): void {
    const side = Math.min(this.width, this.height);
    const radius = side * SHIELD_ARC_RADIUS_RATIO;
    const cx = this.width / 2;
    const cy = this.height / 2;
    for (const arc of frame.shieldArcs) {
      const color = arc.isLocalDir ? theme.COLOR_WARNING : theme.COLOR_INFO;
      // 扇形弧：用短线段沿方位角铺开（Graphics 无 arc 原语）。
      const spread = Math.PI / 5;
      const segments = 10;
      for (let i = 0; i < segments; i += 1) {
        const a0 = arc.bearingRad - spread / 2 + (spread * i) / segments;
        const a1 = arc.bearingRad - spread / 2 + (spread * (i + 1)) / segments;
        g.drawLine(
          cx + Math.cos(a0) * radius,
          cy + Math.sin(a0) * radius,
          cx + Math.cos(a1) * radius,
          cy + Math.sin(a1) * radius,
          fade(color, 0.85),
          3,
        );
      }
    }
  }

  private drawLockLane(g: Laya.Graphics, frame: CoopFrame): void {
    if (frame.lockBearingRad < 0) {
      return;
    }
    const side = Math.min(this.width, this.height);
    const cx = this.width / 2;
    const cy = this.height / 2;
    const cos = Math.cos(frame.lockBearingRad);
    const sin = Math.sin(frame.lockBearingRad);
    // 巨炮弹道：从中心到边界的一条宽半透明带 + 两侧警戒线。
    const halfWidth = side * 0.09;
    const px = -sin * halfWidth;
    const py = cos * halfWidth;
    g.drawLine(cx + px, cy + py, cx + cos * side, cy + sin * side, fade(theme.COLOR_DANGER, 0.28), 1);
    g.drawLine(cx - px, cy - py, cx - cos * side, cy - sin * side, fade(theme.COLOR_DANGER, 0.28), 1);
    g.drawLine(cx, cy, cx + cos * side, cy + sin * side, fade(theme.COLOR_DANGER, 0.16), 2);
  }

  private drawBoss(g: Laya.Graphics, frame: CoopFrame): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const side = Math.min(this.width, this.height);
    const radius = side * BOSS_RADIUS_RATIO;
    const defeated = frame.state === CoopBossState.Finished && frame.bossHp === 0;
    const body = defeated ? theme.COLOR_BOSS_DEFEATED : theme.COLOR_BOSS;
    g.drawCircle(cx, cy, radius, body, fade(theme.COLOR_BOSS_RING, 0.9), 2);
    g.drawCircle(cx, cy, radius * 0.55, mix(body, theme.COLOR_VOID, 0.35), null, 1);
    // 旋转相位指示（spiral 激活时）
    if (frame.spiralActive) {
      const phase = (frame.tick % 360) * (Math.PI / 180);
      g.drawLine(
        cx + Math.cos(phase) * radius * 0.9,
        cy + Math.sin(phase) * radius * 0.9,
        cx + Math.cos(phase) * radius * 1.5,
        cy + Math.sin(phase) * radius * 1.5,
        fade(theme.COLOR_ACCENT, 0.8),
        2,
      );
    }
  }

  private drawBullet(g: Laya.Graphics, bullet: CoopBulletItem): void {
    const color =
      bullet.kind === 1
        ? fade(theme.COLOR_DANGER, bullet.alpha)
        : bullet.kind === 2
          ? fade(theme.COLOR_ACCENT, bullet.alpha)
          : fade(theme.COLOR_OPPONENT_BULLET, bullet.alpha);
    g.drawCircle(bullet.x, bullet.y, bullet.radius, color, null, 0);
  }

  private drawPlayer(g: Laya.Graphics, player: CoopPlayerItem): void {
    const color = player.isLocal ? theme.COLOR_LOCAL_PLAYER : fade(theme.COLOR_PLAYER, player.alpha);
    // 朝向箭头（0 = 向上）
    const size = player.isLocal ? 11 : 9;
    const rad = player.facingRad;
    const tipX = player.x + Math.sin(rad) * size;
    const tipY = player.y - Math.cos(rad) * size;
    const leftX = player.x + Math.sin(rad + 2.5) * size * 0.8;
    const leftY = player.y - Math.cos(rad + 2.5) * size * 0.8;
    const rightX = player.x + Math.sin(rad - 2.5) * size * 0.8;
    const rightY = player.y - Math.cos(rad - 2.5) * size * 0.8;
    g.drawLine(tipX, tipY, leftX, leftY, color, 2);
    g.drawLine(tipX, tipY, rightX, rightY, color, 2);
    g.drawLine(leftX, leftY, rightX, rightY, color, 2);
    g.drawCircle(player.x, player.y, 3, fade(theme.COLOR_HITBOX, player.alpha), null, 0);
    // 封锁：红色方框；格挡：黄色小圈
    if (player.locked) {
      g.drawRect(player.x - 12, player.y - 12, 24, 24, null, fade(theme.COLOR_DANGER, 0.9), 2);
    }
    if (player.shielded) {
      g.drawCircle(player.x, player.y, 15, null, fade(theme.COLOR_WARNING, 0.8), 1);
    }
    if (!player.connected) {
      g.drawLine(player.x - 6, player.y - 6, player.x + 6, player.y + 6, fade(theme.COLOR_HUD_DIM, 0.8), 2);
    }
  }

  private drawHud(frame: CoopFrame): void {
    const g = this.hudGraphics;
    const barWidth = Math.max(0, this.width - 16);
    const ratio = frame.bossMaxHp > 0 ? Math.max(0, Math.min(1, frame.bossHp / frame.bossMaxHp)) : 0;
    g.drawRect(8, 48, barWidth, HP_BAR_HEIGHT, theme.COLOR_HP_BACK);
    g.drawRect(8, 48, barWidth * ratio, HP_BAR_HEIGHT, ratio > 0.3 ? theme.COLOR_HP_BAR : theme.COLOR_HP_BAR_LOW);
    this.title.text = `BOSS  ${frame.bossHp} / ${frame.bossMaxHp}`;
    const seatLabel = frame.players
      .map((player) => `${player.isLocal ? '★' : '·'}S${player.seat} ${player.damageDealt}`)
      .join('   ');
    const flags: string[] = [];
    if (frame.shieldArcs.length > 0) {
      flags.push(`shield:${frame.shieldArcs.map((arc) => arc.seat).join('/')}`);
    }
    if (frame.lockDir >= 0) {
      flags.push(`lock:S${frame.lockDir}`);
    }
    if (frame.spiralActive) {
      flags.push('spiral');
    }
    this.detail.text = `${seatLabel}${flags.length > 0 ? `   [${flags.join(' ')}]` : ''}`;
  }
}
