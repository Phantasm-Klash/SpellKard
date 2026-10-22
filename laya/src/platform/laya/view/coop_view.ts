/**
 * 合作模式（coop_boss）战斗渲染 —— **千夜追忆（TNA）美术**版本。
 *
 * 底层原则（`docs/ART_POLICY.md`）：游戏内一切可见美术都来自 TNA 导入树，
 * 客户端不自绘矢量美术作为最终表现。因此本视图不再画圆形 Boss / 三角自机 /
 * 圆点弹幕，而是：
 *
 *  - **背景**：`bg_XX_01/02.png` 双层滚动（复用 `StageBackgroundLayer`）；
 *  - **Boss**：`enemylist01/stage_boss_01_11.png`（击破后 `stage_boss_damage_01_11.png`）；
 *  - **自机**：`ply_shot_0N/player_0N.png`（32×48，机头朝上，按座位旋转）；
 *  - **弹幕**：按 wire `kind`（0=fan 1=cannon 2=spiral）取 `kome`/`mtama`/`stama`。
 *
 * 仅保留**玩法指示**（格挡扇形弧、巨炮封锁弹道、spiral 相位线、锁定/格挡标记）
 * 与 HUD 文本/血条这些「非美术」元素——它们不是画面美术，而是可读性所需。
 *
 * 帧坐标集中在 `core/game/coop_art.ts`（纯数据、可 Node 直测）；本文件只做
 * 布局与精灵池。`render(null)` 表示「快照未到」：只画背景与 HUD 骨架，绝不
 * 回落到另一种美术风格（这正是过去进入对局时 TNA 美术一闪而过的成因）。
 *
 * NOTE: `platform/laya/` only。
 */

import { CoopBossState } from '../../../core/sim/coop_boss';
import {
  COOP_BOSS_ART,
  COOP_BOSS_DEFEATED_ART,
  coopBulletArt,
  coopPlayerArt,
  type CoopArtFrame,
} from '../../../core/game/coop_art';
import type { CoopFrame, CoopPlayerItem } from '../../../core/game/coop_view_model';
import { sharedTnaFrameSource, type LayaAtlasFrameSource } from './bullet_atlas';
import { StageBackgroundLayer } from './stage_background';
import * as theme from './theme';
import { fade } from './sprites';

const BOSS_RADIUS_RATIO = 0.075;
/** Boss 美术显示高度 = 判定半径 × 该系数（TNA 立绘比判定圈大一圈）。 */
const BOSS_ART_HEIGHT_RATIO = 4;
const SHIELD_ARC_RADIUS_RATIO = 0.3;
const HP_BAR_HEIGHT = 10;
/** TNA 自机精灵原始高度（`player_0N.png` 为 32×48）。 */
const PLAYER_ART_HEIGHT = 48;
/** 子弹美术直径相对判定直径的放大系数。 */
const BULLET_ART_RADIUS_RATIO = 1.6;
/** 美术按 640 宽战场绘制，按 playfield 实际宽度等比缩放。 */
const ART_REFERENCE_WIDTH = 640;
/** 合作模式最多 4 个座位。 */
const MAX_SEATS = 4;

export interface CoopViewOptions {
  stageWidth: number;
  stageHeight: number;
}

export class CoopView {
  readonly root: Laya.Sprite;
  /** TNA 双层滚动背景（唯一背景美术来源）。 */
  private readonly background: StageBackgroundLayer;
  /** 玩法指示层（格挡弧/巨炮弹道/相位线），不是美术。 */
  private readonly telegraph: Laya.Sprite;
  private readonly telegraphGraphics: Laya.Graphics;
  /** 子弹精灵层（TNA 弹幕帧）。 */
  private readonly bulletLayer: Laya.Sprite;
  /** 角色精灵层（Boss + 自机）。 */
  private readonly actorLayer: Laya.Sprite;
  private readonly bossSprite: Laya.Sprite;
  private readonly playerSprites: Laya.Sprite[] = [];
  private readonly bulletSprites: Laya.Sprite[] = [];
  private readonly hud: Laya.Sprite;
  private readonly hudGraphics: Laya.Graphics;
  private readonly title: Laya.Text;
  private readonly detail: Laya.Text;
  private readonly source: LayaAtlasFrameSource;
  private width = 0;
  private height = 0;

  constructor(options: CoopViewOptions, source: LayaAtlasFrameSource = sharedTnaFrameSource()) {
    this.source = source;
    this.root = new Laya.Sprite();
    this.root.visible = false;
    this.root.size(options.stageWidth, options.stageHeight);

    // 背景美术：TNA 双层滚动图（bg_XX_01 下落 + bg_XX_02 反向旋转）。
    this.background = new StageBackgroundLayer(undefined, source);
    this.background.setStage(1);
    this.root.addChild(this.background.root);

    this.telegraph = new Laya.Sprite();
    this.telegraph.mouseEnabled = false;
    this.telegraphGraphics = this.telegraph.graphics;
    this.root.addChild(this.telegraph);

    this.bulletLayer = new Laya.Sprite();
    this.bulletLayer.mouseEnabled = false;
    this.root.addChild(this.bulletLayer);

    this.actorLayer = new Laya.Sprite();
    this.actorLayer.mouseEnabled = false;
    this.root.addChild(this.actorLayer);

    this.bossSprite = new Laya.Sprite();
    this.bossSprite.mouseEnabled = false;
    this.bossSprite.visible = false;
    this.actorLayer.addChild(this.bossSprite);
    for (let seat = 0; seat < MAX_SEATS; seat += 1) {
      const ship = new Laya.Sprite();
      ship.mouseEnabled = false;
      ship.visible = false;
      this.actorLayer.addChild(ship);
      this.playerSprites.push(ship);
    }

    this.hud = new Laya.Sprite();
    this.hud.mouseEnabled = false;
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

    // 图集切片是共享的、只探测一次；背景图在首次 update 时按需加载。
    void this.source.load();
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** 选择 TNA 背景组（与大厅 stage 1..4 对应）。 */
  setStage(stage: number): void {
    this.background.setStage(stage);
  }

  /** 布局：战场矩形 + 舞台尺寸（场景 relayout 时调用）。 */
  layout(playfieldX: number, playfieldY: number, width: number, height: number): void {
    this.root.pos(playfieldX, playfieldY);
    this.root.size(width, height);
    this.width = width;
    this.height = height;
    // 裁剪到战场矩形：背景图集按 256×256 平铺并旋转，若不外裁会溢出到 HUD
    // 与舞台留白区（截图里表现为硬边旋转方块）。
    this.root.scrollRect = width > 0 && height > 0 ? new Laya.Rectangle(0, 0, width, height) : null;
    this.background.relayout(width, height);
    this.telegraph.size(width, height);
    this.bulletLayer.size(width, height);
    this.actorLayer.size(width, height);
    this.hud.size(width, height);
    this.title.pos(8, 6);
    this.detail.pos(8, 28);
  }

  /** 推进背景滚动时钟（由场景的固定 tick 驱动）。 */
  update(dtMs: number): void {
    this.background.update(dtMs);
  }

  /**
   * 绘制一帧。
   *
   * @param frame 最新合作快照帧；`null` 表示快照未到（只画 TNA 背景与 HUD
   *              骨架，不回落其他美术风格）。
   */
  render(frame: CoopFrame | null): void {
    if (this.width <= 0 || this.height <= 0) {
      return;
    }
    this.telegraphGraphics.clear();
    if (frame === null) {
      this.hideActors();
      this.hudGraphics.clear();
      this.title.text = 'COOP';
      this.detail.text = '';
      return;
    }
    this.drawShieldArcs(frame);
    this.drawLockLane(frame);
    this.drawBoss(frame);
    this.drawPlayers(frame);
    this.drawBullets(frame);
    this.drawHud(frame);
  }

  destroy(): void {
    this.background.destroy();
    this.root.destroy(true);
  }

  // --- 美术层 ---------------------------------------------------------------

  private artScale(): number {
    return this.width > 0 ? this.width / ART_REFERENCE_WIDTH : 0;
  }

  /**
   * 把一帧 TNA 美术贴到精灵上并按其原始尺寸居中。
   *
   * @param displayHeight 目标显示高度（像素）；宽度按原始宽高比跟随。
   * @returns 纹理是否可用（不可用时精灵被隐藏）。
   */
  private blit(sprite: Laya.Sprite, art: CoopArtFrame, displayHeight: number): boolean {
    const texture = this.source.frame(art.atlas, art.frame);
    if (texture === null || texture === undefined) {
      sprite.visible = false;
      return false;
    }
    const sourceW = texture.sourceWidth || texture.width || 1;
    const sourceH = texture.sourceHeight || texture.height || 1;
    sprite.texture = texture;
    sprite.pivot(sourceW / 2, sourceH / 2);
    const scale = sourceH > 0 ? displayHeight / sourceH : 1;
    sprite.scaleX = scale;
    sprite.scaleY = scale;
    sprite.visible = true;
    return true;
  }

  private hideActors(): void {
    this.bossSprite.visible = false;
    for (const ship of this.playerSprites) {
      ship.visible = false;
    }
    for (const bullet of this.bulletSprites) {
      bullet.visible = false;
    }
  }

  private drawBoss(frame: CoopFrame): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const side = Math.min(this.width, this.height);
    const radius = side * BOSS_RADIUS_RATIO;
    const defeated = frame.state === CoopBossState.Finished && frame.bossHp === 0;
    const art = defeated ? COOP_BOSS_DEFEATED_ART : COOP_BOSS_ART;
    this.bossSprite.pos(cx, cy);
    this.bossSprite.rotation = 0;
    const shown = this.blit(this.bossSprite, art, radius * BOSS_ART_HEIGHT_RATIO);
    this.bossSprite.alpha = defeated ? 0.85 : 1;
    if (!shown) {
      return;
    }
    // spiral 相位指示（玩法指示，不是美术）：Boss 周围一条缓慢旋转的短线。
    if (frame.spiralActive) {
      const phase = (frame.tick % 360) * (Math.PI / 180);
      const g = this.telegraphGraphics;
      g.drawLine(
        cx + Math.cos(phase) * radius * 0.95,
        cy + Math.sin(phase) * radius * 0.95,
        cx + Math.cos(phase) * radius * 1.45,
        cy + Math.sin(phase) * radius * 1.45,
        fade(theme.COLOR_ACCENT, 0.8),
        2,
      );
    }
  }

  private drawPlayers(frame: CoopFrame): void {
    const artHeight = PLAYER_ART_HEIGHT * this.artScale();
    for (const player of frame.players) {
      const sprite = this.playerSprites[player.seat];
      if (sprite === undefined) {
        continue;
      }
      this.blit(sprite, coopPlayerArt(player.seat), artHeight);
      if (!sprite.visible) {
        continue;
      }
      sprite.pos(player.x, player.y);
      // 机头朝上绘制，按视图朝向旋转（帧里的 facingRad 已含视野旋转）。
      sprite.rotation = (player.facingRad * 180) / Math.PI;
      sprite.alpha = player.alpha;
      this.drawPlayerMarkers(player);
    }
    // 未参战的座位精灵保持隐藏（他机在半透明之外不显示）。
    for (let seat = 0; seat < this.playerSprites.length; seat += 1) {
      if (frame.players.some((player) => player.seat === seat)) {
        continue;
      }
      this.playerSprites[seat].visible = false;
    }
  }

  /** 锁定/格挡/断线标记：玩法指示，画在自机上方。 */
  private drawPlayerMarkers(player: CoopPlayerItem): void {
    const g = this.telegraphGraphics;
    if (player.locked) {
      g.drawRect(player.x - 14, player.y - 14, 28, 28, null, fade(theme.COLOR_DANGER, 0.9), 2);
    }
    if (player.shielded) {
      g.drawCircle(player.x, player.y, 17, null, fade(theme.COLOR_WARNING, 0.85), 1);
    }
    if (!player.connected) {
      g.drawLine(player.x - 7, player.y - 7, player.x + 7, player.y + 7, fade(theme.COLOR_HUD_DIM, 0.8), 2);
    }
  }

  private drawBullets(frame: CoopFrame): void {
    let used = 0;
    for (const bullet of frame.bullets) {
      const sprite = this.bulletSprite(used);
      const diameter = Math.max(6, bullet.radius * 2 * BULLET_ART_RADIUS_RATIO);
      const shown = this.blit(sprite, coopBulletArt(bullet.kind), diameter);
      if (!shown) {
        used += 1;
        continue;
      }
      sprite.pos(bullet.x, bullet.y);
      sprite.rotation = 0;
      sprite.alpha = bullet.alpha;
      used += 1;
    }
    for (let index = used; index < this.bulletSprites.length; index += 1) {
      this.bulletSprites[index].visible = false;
    }
  }

  private bulletSprite(index: number): Laya.Sprite {
    while (this.bulletSprites.length <= index) {
      const sprite = new Laya.Sprite();
      sprite.mouseEnabled = false;
      sprite.visible = false;
      this.bulletLayer.addChild(sprite);
      this.bulletSprites.push(sprite);
    }
    return this.bulletSprites[index];
  }

  // --- 玩法指示（非美术） ----------------------------------------------------

  private drawShieldArcs(frame: CoopFrame): void {
    const side = Math.min(this.width, this.height);
    const radius = side * SHIELD_ARC_RADIUS_RATIO;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const g = this.telegraphGraphics;
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

  private drawLockLane(frame: CoopFrame): void {
    if (frame.lockBearingRad < 0) {
      return;
    }
    const side = Math.min(this.width, this.height);
    const cx = this.width / 2;
    const cy = this.height / 2;
    const cos = Math.cos(frame.lockBearingRad);
    const sin = Math.sin(frame.lockBearingRad);
    // 巨炮弹道：从中心到边界的两条半透明警戒线 + 一条中轴提示。
    const halfWidth = side * 0.09;
    const px = -sin * halfWidth;
    const py = cos * halfWidth;
    const g = this.telegraphGraphics;
    g.drawLine(cx + px, cy + py, cx + cos * side, cy + sin * side, fade(theme.COLOR_DANGER, 0.28), 1);
    g.drawLine(cx - px, cy - py, cx - cos * side, cy - sin * side, fade(theme.COLOR_DANGER, 0.28), 1);
    g.drawLine(cx, cy, cx + cos * side, cy + sin * side, fade(theme.COLOR_DANGER, 0.16), 2);
  }

  // --- HUD（文本/血条，非美术） ----------------------------------------------

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
