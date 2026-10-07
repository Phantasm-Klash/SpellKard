/**
 * LayaAir rendering of a `BossRaceFrame`.
 *
 * Draws the portrait playfield, both Boss copies, the local player's ship and the
 * bullet curtain. Rendering is intentionally vector-based (`Graphics`) so the
 * client has no binary asset dependency yet; sprite atlases can replace the
 * draw calls later without touching the frame model.
 *
 * This is a thin adapter: all coordinates and colour decisions come from
 * `core/game/boss_race_view_model`.
 */

import type { BossRaceFrame, PlayfieldLayout, RenderPoint } from '../../../core/game/boss_race_view_model';

const COLOR_BACKGROUND = '#0a0713';
const COLOR_PLAYFIELD = '#150c22';
const COLOR_BORDER = '#4a3a6a';
const COLOR_LOCAL_BULLET = '#7fd4ff';
const COLOR_OPPONENT_BULLET = '#ff8fb1';
const COLOR_PLAYER = '#ffffff';
const COLOR_LOCAL_PLAYER = '#ffe36e';
const COLOR_BOSS = '#c46bff';
const COLOR_BOSS_DEFEATED = '#4b3a63';
const COLOR_HUD = '#e8e2ff';
const COLOR_HP_BAR = '#59e08a';
const COLOR_HP_BACK = '#331e3f';

export interface BossRaceViewOptions {
  layout: PlayfieldLayout;
  hudHeight?: number;
}

export class BossRaceView {
  readonly root: Laya.Sprite;

  private readonly layout: PlayfieldLayout;
  private readonly hudHeight: number;
  private readonly playfield: Laya.Sprite;
  private readonly bulletLayer: Laya.Sprite;
  private readonly actorLayer: Laya.Sprite;
  private readonly hud: Laya.Text;
  private readonly bulletPool: Laya.Sprite[] = [];
  private readonly actorPool: Laya.Sprite[] = [];
  private activeBullets = 0;
  private activeActors = 0;

  constructor(options: BossRaceViewOptions) {
    this.layout = options.layout;
    this.hudHeight = options.hudHeight ?? 72;

    this.root = new Laya.Sprite();
    this.root.size(this.layout.width, this.layout.height + this.hudHeight);

    const background = new Laya.Sprite();
    background.graphics.drawRect(0, 0, this.layout.width, this.layout.height + this.hudHeight, COLOR_BACKGROUND);
    this.root.addChild(background);

    this.playfield = new Laya.Sprite();
    this.playfield.pos(0, 0);
    this.playfield.graphics.drawRect(0, 0, this.layout.width, this.layout.height, COLOR_PLAYFIELD);
    this.playfield.graphics.drawRect(0, 0, this.layout.width, this.layout.height, null, COLOR_BORDER, 2);
    this.root.addChild(this.playfield);

    this.bulletLayer = new Laya.Sprite();
    this.actorLayer = new Laya.Sprite();
    this.root.addChild(this.bulletLayer);
    this.root.addChild(this.actorLayer);

    this.hud = new Laya.Text();
    this.hud.pos(8, this.layout.height + 8);
    this.hud.fontSize = 14;
    this.hud.color = COLOR_HUD;
    this.hud.leading = 4;
    this.hud.width = this.layout.width - 16;
    this.hud.wordWrap = true;
    this.root.addChild(this.hud);
  }

  get playfieldHeight(): number {
    return this.layout.height;
  }

  /** Redraws the whole frame. `hudLines` are rendered verbatim in the HUD block. */
  render(frame: BossRaceFrame, hudLines: string[] = []): void {
    this.drawBullets(frame);
    this.drawActors(frame);
    this.hud.text = hudLines.join('\n');
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private drawBullets(frame: BossRaceFrame): void {
    this.activeBullets = 0;
    for (const bullet of frame.bullets) {
      const sprite = this.bulletSprite(this.activeBullets);
      sprite.visible = true;
      sprite.pos(bullet.position.x, bullet.position.y);
      const radius = bullet.radius;
      sprite.graphics.clear();
      sprite.graphics.drawCircle(0, 0, radius, bullet.ownerIsLocal ? COLOR_LOCAL_BULLET : COLOR_OPPONENT_BULLET);
      this.activeBullets += 1;
    }
    for (let i = this.activeBullets; i < this.bulletPool.length; i += 1) {
      this.bulletPool[i].visible = false;
    }
  }

  private drawActors(frame: BossRaceFrame): void {
    this.activeActors = 0;

    if (frame.opponentBoss !== null) {
      this.drawBoss(frame.opponentBoss.position, frame.opponentBoss.defeated, false, frame.opponentBoss.hpRatio);
    }
    if (frame.boss !== null) {
      this.drawBoss(frame.boss.position, frame.boss.defeated, true, frame.boss.hpRatio);
    }
    for (const player of frame.players) {
      const sprite = this.actorSprite(this.activeActors);
      sprite.visible = true;
      sprite.pos(player.position.x, player.position.y);
      sprite.graphics.clear();
      if (player.isLocal) {
        sprite.graphics.drawCircle(0, 0, 4, COLOR_LOCAL_PLAYER, COLOR_PLAYER, 1);
      } else {
        sprite.graphics.drawCircle(0, 0, 3, COLOR_PLAYER);
      }
      this.activeActors += 1;
    }
    for (let i = this.activeActors; i < this.actorPool.length; i += 1) {
      this.actorPool[i].visible = false;
    }
  }

  private drawBoss(position: RenderPoint, defeated: boolean, isLocal: boolean, hpRatio: number): void {
    const sprite = this.actorSprite(this.activeActors);
    sprite.visible = true;
    sprite.pos(position.x, position.y);
    sprite.graphics.clear();
    sprite.graphics.drawCircle(
      0,
      0,
      isLocal ? 22 : 16,
      defeated ? COLOR_BOSS_DEFEATED : COLOR_BOSS,
      COLOR_BORDER,
      2,
    );
    if (isLocal) {
      // Local Boss HP bar, so the race is readable at a glance.
      const barWidth = 48;
      sprite.graphics.drawRect(-barWidth / 2, 30, barWidth, 4, COLOR_HP_BACK);
      sprite.graphics.drawRect(-barWidth / 2, 30, Math.max(0, barWidth * hpRatio), 4, COLOR_HP_BAR);
    }
    this.activeActors += 1;
  }

  private bulletSprite(index: number): Laya.Sprite {
    const existing = this.bulletPool[index];
    if (existing !== undefined) {
      return existing;
    }
    const sprite = new Laya.Sprite();
    this.bulletPool.push(sprite);
    this.bulletLayer.addChild(sprite);
    return sprite;
  }

  private actorSprite(index: number): Laya.Sprite {
    const existing = this.actorPool[index];
    if (existing !== undefined) {
      return existing;
    }
    const sprite = new Laya.Sprite();
    this.actorPool.push(sprite);
    this.actorLayer.addChild(sprite);
    return sprite;
  }
}
