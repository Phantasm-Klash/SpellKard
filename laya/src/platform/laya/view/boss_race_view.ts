/**
 * LayaAir rendering of a `BossRaceFrame`.
 *
 * Draws the portrait playfield, both Boss copies, the local player's ship and the
 * bullet curtain. Actors and the backdrop prefer the real TNA art
 * (`AtlasActorRenderer` + a backdrop texture) and fall back to the vector
 * `Graphics` look per-actor whenever a frame has not loaded.
 *
 * This is a thin adapter: all coordinates and colour decisions come from
 * `core/game/boss_race_view_model`; the actual shapes live in the sibling
 * `arena` (field + vector actors), `actors` (real-art actors), `bullets`
 * (curtain) and `hud` (status strip) modules, so this file stays a
 * layer-ordering skeleton with object pools.
 */

import type { BossRaceFrame, PlayfieldLayout, RenderPoint } from '../../../core/game/boss_race_view_model';
import { TNA_BACKGROUND_IMAGE } from '../../../core/game/tna_actor_frames';
import { AtlasActorRenderer, type ActorSpriteRenderer } from './actors';
import { drawPlayfield } from './arena';
import { sharedTnaFrameSource } from './bullet_atlas';
import { vectorBulletRenderer } from './bullets';
import { drawHudBar, type HudState } from './hud';
import type { BulletRenderer } from './sprites';
import * as theme from './theme';

const COLOR_BACKGROUND = theme.COLOR_BACKGROUND;
const COLOR_HUD = theme.COLOR_HUD;

/** Pixel radius of a Boss copy: the local one reads larger than the rival's. */
const BOSS_RADIUS_LOCAL = 22;
const BOSS_RADIUS_RIVAL = 16;
/** Pixel radius of the player ship hitbox. */
const PLAYER_RADIUS = 4;

export interface BossRaceViewOptions {
  /** Playfield size in pixels (the 2:3 portrait battle area). */
  layout: PlayfieldLayout;
  /** Left edge of the playfield inside the stage. Defaults to 0. */
  playfieldX?: number;
  /** Top edge of the playfield inside the stage. Defaults to 0. */
  playfieldY?: number;
  /** Width of the status panel on the right. */
  hudWidth?: number;
  /** Height of the status panel on the right. */
  hudHeight?: number;
  /** Left edge of the status panel inside the stage. Defaults to the playfield's right edge. */
  hudX?: number;
  /** Top edge of the status panel inside the stage. Defaults to 0 (stage top). */
  hudY?: number;
  /** Whole stage width; defaults to `playfieldX + layout.width + hudWidth`. */
  stageWidth?: number;
  /** Whole stage height; defaults to `playfieldY + layout.height`. */
  stageHeight?: number;
  /** Bullet renderer; defaults to the pure-vector fallback. */
  bulletRenderer?: BulletRenderer;
  /** Animate species frames locally (opt-in; server frame index is authoritative). */
  animateBulletFrames?: boolean;
  /**
   * Actor renderer for the Boss copies and player ships. Defaults to real TNA
   * atlas art with the vector renderer as per-actor fallback.
   */
  actorRenderer?: ActorSpriteRenderer;
  /**
   * Playfield backdrop texture. When omitted the view tries the shared TNA
   * backdrop image and keeps the vector playfield if it is unavailable.
   */
  backgroundTexture?: Laya.Texture;
  /**
   * Optional watermark layer (character/boss portraits). Inserted between the
   * actor layer and the HUD strip, so portraits sit above the actors and below
   * the status panel. Owned and sized by the caller.
   */
  watermark?: Laya.Sprite;
}

export class BossRaceView {
  readonly root: Laya.Sprite;

  // Mutable so `relayout` can re-tile the view when the stage is resized.
  private layout: PlayfieldLayout;
  private playfieldX: number;
  private playfieldY: number;
  private hudX: number;
  private hudY: number;
  private hudWidth: number;
  private hudHeight: number;
  private stageWidth: number;
  private stageHeight: number;
  private readonly background: Laya.Sprite;
  private readonly playfield: Laya.Sprite;
  private readonly backdrop: Laya.Sprite;
  private readonly bulletLayer: Laya.Sprite;
  private readonly actorLayer: Laya.Sprite;
  private readonly watermark: Laya.Sprite | null;
  private readonly hudLayer: Laya.Sprite;
  private readonly hud: Laya.Text;
  private readonly bulletPool: Laya.Sprite[] = [];
  private readonly actorPool: Laya.Sprite[] = [];
  private readonly bulletRenderer: BulletRenderer;
  private readonly actorRenderer: ActorSpriteRenderer;
  private readonly animateBulletFrames: boolean;
  private backgroundTexture: Laya.Texture | null;
  private activeBullets = 0;
  private activeActors = 0;

  constructor(options: BossRaceViewOptions) {
    this.layout = options.layout;
    this.bulletRenderer = options.bulletRenderer ?? vectorBulletRenderer;
    this.animateBulletFrames = options.animateBulletFrames ?? false;
    this.playfieldX = options.playfieldX ?? 0;
    this.playfieldY = options.playfieldY ?? 0;
    this.hudX = options.hudX ?? this.playfieldX + this.layout.width;
    this.hudY = options.hudY ?? 0;
    this.hudWidth = options.hudWidth ?? this.layout.width;
    this.hudHeight = options.hudHeight ?? 72;
    this.stageWidth = options.stageWidth ?? this.hudX + this.hudWidth;
    this.stageHeight = options.stageHeight ?? Math.max(this.playfieldY + this.layout.height, this.hudHeight);
    this.backgroundTexture = options.backgroundTexture ?? null;
    this.watermark = options.watermark ?? null;

    // Real TNA art (Boss / player / backdrop) with vector fallback. The shared
    // source is only created when a caller has not supplied its own renderer or
    // backdrop, so tests can drive the view without a Laya loader.
    const source = options.actorRenderer === undefined || this.backgroundTexture === null ? sharedTnaFrameSource() : null;
    this.actorRenderer = options.actorRenderer ?? new AtlasActorRenderer(source!);

    this.root = new Laya.Sprite();
    this.root.size(this.stageWidth, this.stageHeight);

    this.background = new Laya.Sprite();
    this.background.graphics.drawRect(0, 0, this.stageWidth, this.stageHeight, COLOR_BACKGROUND);
    this.root.addChild(this.background);

    // Backdrop image (real art) sits between the solid stage colour and the
    // playfield grid; the grid/reticle/border are still drawn on top.
    this.backdrop = new Laya.Sprite();
    this.backdrop.pos(this.playfieldX, this.playfieldY);
    this.root.addChild(this.backdrop);

    this.playfield = new Laya.Sprite();
    this.playfield.pos(this.playfieldX, this.playfieldY);
    this.redrawPlayfield();
    this.root.addChild(this.playfield);

    this.bulletLayer = new Laya.Sprite();
    this.bulletLayer.pos(this.playfieldX, this.playfieldY);
    this.actorLayer = new Laya.Sprite();
    this.actorLayer.pos(this.playfieldX, this.playfieldY);
    this.root.addChild(this.bulletLayer);
    this.root.addChild(this.actorLayer);

    // Watermark portraits sit above the actors but below the HUD strip.
    if (this.watermark !== null) {
      this.root.addChild(this.watermark);
    }

    // Structured HUD panel: a vertical strip to the right of the playfield. It
    // can render either as vector cards (`hudState`) or as a plain text block
    // (`hudLines`); both target the same region.
    //
    // The panel is a full-height strip: it starts at the top of the stage (not
    // at `playfieldY`, which is the vertically-centred playfield's offset) and
    // spans `hudHeight`, so it never runs off the bottom when the playfield is
    // shorter than the stage.
    this.hudLayer = new Laya.Sprite();
    this.hudLayer.pos(this.hudX, this.hudY);
    this.root.addChild(this.hudLayer);

    this.hud = new Laya.Text();
    this.hud.pos(this.hudX + 8, this.hudY + 8);
    this.hud.fontSize = 14;
    this.hud.color = COLOR_HUD;
    this.hud.leading = 4;
    this.hud.width = this.hudWidth - 16;
    this.hud.wordWrap = true;
    this.root.addChild(this.hud);

    if (source !== null) {
      // Fire-and-forget: the backdrop swaps in as soon as the image resolves;
      // actor frames are picked up by the per-frame lookups automatically.
      void source.load().then(() => {
        if (this.backgroundTexture === null) {
          const texture = source.image(TNA_BACKGROUND_IMAGE);
          if (texture !== null) {
            this.backgroundTexture = texture;
            this.redrawPlayfield();
          }
        }
      });
    }
  }

  /** Repaints the playfield grid, skipping the gradient when a backdrop covers it. */
  private redrawPlayfield(): void {
    this.playfield.graphics.clear();
    drawPlayfield(this.playfield.graphics, this.layout.width, this.layout.height, this.backgroundTexture === null);
    this.backdrop.graphics.clear();
    this.backdrop.texture = null;
    this.backdrop.scaleX = 1;
    this.backdrop.scaleY = 1;
    if (this.backgroundTexture !== null) {
      const texW = this.backgroundTexture.width || 1;
      const texH = this.backgroundTexture.height || 1;
      this.backdrop.texture = this.backgroundTexture;
      // Stretch to fill the playfield exactly so the image never spills into
      // the HUD strip; the art is a seamless starfield, so the stretch is fine.
      this.backdrop.scaleX = this.layout.width / texW;
      this.backdrop.scaleY = this.layout.height / texH;
    }
  }

  get playfieldHeight(): number {
    return this.layout.height;
  }

  /**
   * Re-tiles the view after the stage has been resized.
   *
   * Only the geometry fields passed here are overwritten; anything omitted keeps
   * its current value. The object pools (bullets / actors) are deliberately left
   * alone — they position purely from frame coordinates in `render`, so a resize
   * only needs the layers re-placed and the playfield/backdrop repainted.
   *
   * Must be called after the constructor has built `root`.
   */
  relayout(options: {
    layout?: PlayfieldLayout;
    playfieldX?: number;
    playfieldY?: number;
    hudX?: number;
    hudY?: number;
    hudWidth?: number;
    hudHeight?: number;
    stageWidth?: number;
    stageHeight?: number;
  }): void {
    if (options.layout !== undefined) {
      this.layout = options.layout;
    }
    if (options.playfieldX !== undefined) {
      this.playfieldX = options.playfieldX;
    }
    if (options.playfieldY !== undefined) {
      this.playfieldY = options.playfieldY;
    }
    if (options.hudX !== undefined) {
      this.hudX = options.hudX;
    }
    if (options.hudY !== undefined) {
      this.hudY = options.hudY;
    }
    if (options.hudWidth !== undefined) {
      this.hudWidth = options.hudWidth;
    }
    if (options.hudHeight !== undefined) {
      this.hudHeight = options.hudHeight;
    }
    if (options.stageWidth !== undefined) {
      this.stageWidth = options.stageWidth;
    }
    if (options.stageHeight !== undefined) {
      this.stageHeight = options.stageHeight;
    }

    this.root.size(this.stageWidth, this.stageHeight);
    this.background.graphics.clear();
    this.background.graphics.drawRect(0, 0, this.stageWidth, this.stageHeight, COLOR_BACKGROUND);

    this.backdrop.pos(this.playfieldX, this.playfieldY);
    this.playfield.pos(this.playfieldX, this.playfieldY);
    this.bulletLayer.pos(this.playfieldX, this.playfieldY);
    this.actorLayer.pos(this.playfieldX, this.playfieldY);
    // Re-apply the watermark's stage-sized geometry. Its z-order was fixed at
    // construction (above actors, below the HUD) and is left untouched.
    if (this.watermark !== null) {
      this.watermark.pos(0, 0);
      this.watermark.size(this.stageWidth, this.stageHeight);
    }
    this.hudLayer.pos(this.hudX, this.hudY);
    this.hud.pos(this.hudX + 8, this.hudY + 8);
    this.hud.width = this.hudWidth - 16;

    this.redrawPlayfield();
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
      drawHudBar(this.hudLayer.graphics, 0, 0, this.hudWidth, this.hudHeight, hudState);    } else {
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
      // The renderer owns the sprite's art: the atlas renderer sets a texture
      // (and pivot/scale/rotation); the vector renderer clears and redraws.
      this.bulletRenderer.draw(sprite, {
        bulletKind: bullet.bulletKind,
        patternId: bullet.bulletKind > 0 ? '' : bullet.patternId,
        radius: bullet.radius,
        ownerIsLocal: bullet.ownerIsLocal,
        angleRad: bullet.angleRad,
        angleDeg: bullet.angleDeg,
        motionFamily: bullet.motionFamily,
        tick: frame.tick,
        animate: this.animateBulletFrames,
      });
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
      // `PlayerRenderItem` carries no facing yet, so ships default to +x.
      this.actorRenderer.drawPlayer(sprite, PLAYER_RADIUS, player.isLocal, false, 0);
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
    this.actorRenderer.drawBoss(
      sprite,
      isLocal ? BOSS_RADIUS_LOCAL : BOSS_RADIUS_RIVAL,
      hpRatio,
      defeated,
      isLocal,
      tick,
    );
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
