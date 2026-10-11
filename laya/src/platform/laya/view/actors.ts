/**
 * Actor rendering for the boss-race view: real TNA sprite art with a vector
 * fallback.
 *
 * The Boss copies and player ships used to be drawn entirely from
 * `Laya.Graphics` primitives (`arena.ts`). This module adds an `ActorSpriteRenderer`
 * seam so the view can blit real atlas frames while keeping the exact same
 * silhouettes when a frame is missing (headless / offline / un-imported art).
 *
 * Two implementations:
 *  - `VectorActorRenderer` — delegates to the original `arena` draw functions.
 *  - `AtlasActorRenderer` — looks up `boss`/`player` frames via a
 *    `BulletFrameSource`, and falls back to vector art for any frame that has
 *    not loaded.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic frame descriptors.
 */

import { bossFrame, playerFrame, type TnaActorFrame } from '../../../core/game/tna_actor_frames';
import { drawBoss, drawPlayer } from './arena';
import type { BulletFrameSource } from './bullet_atlas';

/** Draws a Boss copy / player ship into a pooled sprite (pixel space). */
export interface ActorSpriteRenderer {
  drawBoss(
    sprite: Laya.Sprite,
    radius: number,
    hpRatio: number,
    defeated: boolean,
    isLocal: boolean,
    tick: number,
  ): void;
  drawPlayer(sprite: Laya.Sprite, radius: number, isLocal: boolean, isFocused: boolean, angleRad: number): void;
}

/** Display height of the Boss art, as a multiple of the body radius. */
const BOSS_ART_HEIGHT_RATIO = 4;
/** Display height of the player-ship art, as a multiple of the hitbox radius. */
const PLAYER_ART_HEIGHT_RATIO = 6;

/** Pure-vector actor renderer (the original `arena` look). */
export class VectorActorRenderer implements ActorSpriteRenderer {
  drawBoss(
    sprite: Laya.Sprite,
    radius: number,
    hpRatio: number,
    defeated: boolean,
    isLocal: boolean,
    tick: number,
  ): void {
    resetSprite(sprite);
    drawBoss(sprite.graphics, radius, hpRatio, defeated, isLocal, tick);
  }

  drawPlayer(sprite: Laya.Sprite, radius: number, isLocal: boolean, isFocused: boolean, angleRad: number): void {
    resetSprite(sprite);
    drawPlayer(sprite.graphics, radius, isLocal, isFocused, angleRad);
  }
}

/** Shared stateless instance; the vector renderer holds no per-frame state. */
export const vectorActorRenderer = new VectorActorRenderer();

/**
 * Real-art actor renderer. A frame that has not loaded (or does not exist)
 * degrades to the vector renderer for that actor only, so a partial atlas never
 * blanks the field.
 */
export class AtlasActorRenderer implements ActorSpriteRenderer {
  private readonly fallback: ActorSpriteRenderer;

  constructor(
    private readonly frames: BulletFrameSource,
    fallback: ActorSpriteRenderer = vectorActorRenderer,
  ) {
    this.fallback = fallback;
  }

  drawBoss(
    sprite: Laya.Sprite,
    radius: number,
    hpRatio: number,
    defeated: boolean,
    isLocal: boolean,
    tick: number,
  ): void {
    const texture = this.lookup(bossFrame(isLocal, defeated));
    if (texture === null) {
      this.fallback.drawBoss(sprite, radius, hpRatio, defeated, isLocal, tick);
      return;
    }
    this.blit(sprite, texture, radius * BOSS_ART_HEIGHT_RATIO);
    // A defeated copy is dimmed so the damage art reads as "out".
    sprite.alpha = defeated ? 0.6 : 1;
  }

  drawPlayer(sprite: Laya.Sprite, radius: number, isLocal: boolean, isFocused: boolean, angleRad: number): void {
    const texture = this.lookup(playerFrame(isLocal));
    if (texture === null) {
      this.fallback.drawPlayer(sprite, radius, isLocal, isFocused, angleRad);
      return;
    }
    this.blit(sprite, texture, radius * PLAYER_ART_HEIGHT_RATIO);
    const heading = Number.isFinite(angleRad) ? angleRad : 0;
    // Player art is authored nose-up; rotate to the heading (0 = no rotation).
    sprite.rotation = (heading * 180) / Math.PI;
    sprite.alpha = 1;
  }

  private lookup(frame: TnaActorFrame): Laya.Texture | null {
    return this.frames.frame(frame.atlas, frame.frame);
  }

  private blit(sprite: Laya.Sprite, texture: Laya.Texture, targetHeight: number): void {
    sprite.graphics.clear();
    sprite.texture = texture;
    const sourceW = texture.sourceWidth || texture.width;
    const sourceH = texture.sourceHeight || texture.height;
    sprite.pivot(sourceW / 2, sourceH / 2);
    const scale = sourceH > 0 ? targetHeight / sourceH : 1;
    sprite.scaleX = scale;
    sprite.scaleY = scale;
    sprite.rotation = 0;
  }
}

/** Clears a pooled sprite and resets the transforms the atlas path may have set. */
function resetSprite(sprite: Laya.Sprite): void {
  sprite.texture = null;
  sprite.graphics.clear();
  sprite.pivot(0, 0);
  sprite.scaleX = 1;
  sprite.scaleY = 1;
  sprite.rotation = 0;
  sprite.alpha = 1;
}
