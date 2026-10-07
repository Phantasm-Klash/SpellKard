/**
 * LayaAir rendering of a `BossRaceFrame`.
 *
 * Draws the portrait playfield, both Boss copies, the local player's ship and the
 * bullet curtain. Rendering is intentionally vector-based (`Graphics`) so the
 * client has no binary asset dependency yet; sprite atlases can replace the
 * draw calls later without touching the frame model.
 *
 * This is a thin adapter: all coordinates and colour decisions come from
 * `core/game/boss_race_view_model`; the actual shapes live in the sibling
 * `arena` (field + actors), `bullets` (curtain) and `hud` (status strip)
 * modules, so this file stays a layer-ordering skeleton with object pools.
 */

import type { BossRaceFrame, PlayfieldLayout, RenderPoint } from '../../../core/game/boss_race_view_model';
import { drawBoss, drawPlayfield, drawPlayer } from './arena';
import { vectorBulletRenderer } from './bullets';
import { drawHudBar, type HudState } from './hud';
import * as theme from './theme';

const COLOR_BACKGROUND = theme.COLOR_BACKGROUND;
const COLOR_HUD = theme.COLOR_HUD;

/** Pixel radius of a Boss copy: the local one reads larger than the rival's. */
const BOSS_RADIUS_LOCAL = 22;
const BOSS_RADIUS_RIVAL = 16;
/** Pixel radius of the player ship hitbox. */
const PLAYER_RADIUS = 4;

export interface BossRaceViewOptions {
  /** Playfield size in pixels (the 3:2 portrait battle area). */
  layout: PlayfieldLayout;
  /** Height of the status bar below the playfield. */
  hudHeight?: number;
  /**
   * Width of the status bar. Defaults to the playfield width. The status bar is
   * a stage-wide band, so it may be wider than the playfield once the playfield
   * stops filling the stage.
   */
  hudWidth?: number;
}

export class BossRaceView {
  readonly root: Laya.Sprite;

  private readonly layout: PlayfieldLayout;
  private readonly hudWidth: number;
  private readonly hudHeight: number;
  private readonly playfield: Laya.Sprite;
  private readonly bulletLayer: Laya.Sprite;
  private readonly actorLayer: Laya.Sprite;
  private readonly hudLayer: Laya.Sprite;
  private readonly hud: Laya.Text;
  private readonly bulletPool: Laya.Sprite[] = [];
  private readonly actorPool: Laya.Sprite[] = [];
  private activeBullets = 0;
  private activeActors = 0;

  constructor(options: BossRaceViewOptions) {
    this.layout = options.layout;
    this.hudWidth = options.hudWidth ?? options.layout.width;
    this.hudHeight = options.hudHeight ?? 72;
    const stageWidth = Math.max(this.layout.width, this.hudWidth);

    this.root = new Laya.Sprite();
    this.root.size(stageWidth, this.layout.height + this.hudHeight);

    const background = new Laya.Sprite();
    background.graphics.drawRect(0, 0, stageWidth, this.layout.height + this.hudHeight, COLOR_BACKGROUND);
    this.root.addChild(background);

    this.playfield = new Laya.Sprite();
    this.playfield.pos(0, 0);
    drawPlayfield(this.playfield.graphics, this.layout.width, this.layout.height);
    this.root.addChild(this.playfield);

    this.bulletLayer = new Laya.Sprite();
    this.actorLayer = new Laya.Sprite();
    this.root.addChild(this.bulletLayer);
    this.root.addChild(this.actorLayer);

    // Structured HUD strip. It can render either as vector bars (`hudState`) or
    // as a plain text block (`hudLines`); both target the same region.
    this.hudLayer = new Laya.Sprite();
    this.hudLayer.pos(0, this.layout.height);
    this.root.addChild(this.hudLayer);

    this.hud = new Laya.Text();
    this.hud.pos(8, this.layout.height + 8);
    this.hud.fontSize = 14;
    this.hud.color = COLOR_HUD;
    this.hud.leading = 4;
    this.hud.width = this.hudWidth - 16;
    this.hud.wordWrap = true;
    this.root.addChild(this.hud);
  }

  get playfieldHeight(): number {
    return this.layout.height;
  }

  /**
   * Redraws the whole frame.
   *
   * @param hudLines  plain-text HUD lines, rendered verbatim (legacy contract)
   * @param hudState  when given, the HUD strip is drawn as vector bars instead
   *                  of text; `hudLines` is then ignored
   */
  render(frame: BossRaceFrame, hudLines: string[] = [], hudState?: HudState): void {
    this.drawBullets(frame);
    this.drawActors(frame);
    if (hudState !== undefined) {
      this.hud.text = '';
      this.hud.visible = false;
      this.hudLayer.visible = true;
      this.hudLayer.graphics.clear();
      drawHudBar(this.hudLayer.graphics, 0, 0, this.hudWidth, this.hudHeight, hudState);
    } else {
      this.hudLayer.visible = false;
      this.hud.text = hudLines.join('\n');
      this.hud.visible = true;
    }
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
      sprite.graphics.clear();
      // Pattern-specific vector art (orb / arrow / laser / streak); `angleRad`
      // orients the directional families and `tick` drives the animation.
      vectorBulletRenderer.draw(
        sprite.graphics,
        bullet.patternId,
        bullet.radius,
        bullet.ownerIsLocal,
        bullet.angleRad,
        frame.tick,
      );
      this.activeBullets += 1;
    }
    for (let i = this.activeBullets; i < this.bulletPool.length; i += 1) {
      this.bulletPool[i].visible = false;
    }
  }

  private drawActors(frame: BossRaceFrame): void {
    this.activeActors = 0;

    // Draw the rival Boss first so the local copy stays on top.
    if (frame.opponentBoss !== null) {
      this.drawBoss(frame.opponentBoss.position, frame.opponentBoss.defeated, false, frame.opponentBoss.hpRatio, frame.tick);
    }
    if (frame.boss !== null) {
      this.drawBoss(frame.boss.position, frame.boss.defeated, true, frame.boss.hpRatio, frame.tick);
    }
    for (const player of frame.players) {
      const sprite = this.actorSprite(this.activeActors);
      sprite.visible = true;
      sprite.pos(player.position.x, player.position.y);
      sprite.graphics.clear();
      // `PlayerRenderItem` carries no facing yet, so ships default to +x.
      drawPlayer(sprite.graphics, PLAYER_RADIUS, player.isLocal, false, 0);
      this.activeActors += 1;
    }
    for (let i = this.activeActors; i < this.actorPool.length; i += 1) {
      this.actorPool[i].visible = false;
    }
  }

  private drawBoss(position: RenderPoint, defeated: boolean, isLocal: boolean, hpRatio: number, tick: number): void {
    const sprite = this.actorSprite(this.activeActors);
    sprite.visible = true;
    sprite.pos(position.x, position.y);
    sprite.graphics.clear();
    drawBoss(sprite.graphics, isLocal ? BOSS_RADIUS_LOCAL : BOSS_RADIUS_RIVAL, hpRatio, defeated, isLocal, tick);
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
