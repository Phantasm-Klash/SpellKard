/**
 * Character / boss "watermark" portraits.
 *
 * A faint, slow-breathing portrait sits in a corner of the stage — the local
 * character top-left, the boss top-right — so the player can read who is on the
 * field without the art competing with the bullets. The boss art is **not**
 * mirrored: it is authored facing the viewer, so a `scaleX = -1` would only
 * flip its lighting for no gain.
 *
 * Motion is purely time-driven (no tween library): a sine "breathe" of
 * `±idleScaleAmplitude` over `idlePeriodMs`, plus a `flash()` that snaps the
 * portrait to full opacity and decays back to the resting `opacity`.
 *
 * Art is loaded through the shared TNA frame source by TNA-root-relative name
 * (`player/player_01.png`, `boss/boss_01_11.png`). A missing portrait degrades
 * to "no watermark" — the sprite is hidden and the layer never throws.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic art-name / tuning / geometry helpers.
 */

import { DEFAULT_WATERMARK_TUNING, type WatermarkTuning } from '../../../core/game/tna_stage_tuning';
import { idleScale } from '../../../core/game/stage_visual';
import { sharedTnaFrameSource, type LayaAtlasFrameSource } from './bullet_atlas';
import * as theme from './theme';

export class WatermarkLayer {
  readonly root: Laya.Sprite;

  private readonly source: LayaAtlasFrameSource;
  private readonly tuning: WatermarkTuning;
  private readonly character: Laya.Sprite;
  private readonly boss: Laya.Sprite;
  private characterName = '';
  private bossName = '';
  private characterRequested = false;
  private bossRequested = false;
  private characterFlashMs = 0;
  private bossFlashMs = 0;
  private elapsedMs = 0;
  private width = 0;
  private height = 0;

  constructor(
    tuning: WatermarkTuning = DEFAULT_WATERMARK_TUNING,
    source: LayaAtlasFrameSource = sharedTnaFrameSource(),
  ) {
    this.tuning = tuning;
    this.source = source;
    this.root = new Laya.Sprite();
    this.root.mouseEnabled = false;
    this.character = new Laya.Sprite();
    this.boss = new Laya.Sprite();
    this.character.visible = false;
    this.boss.visible = false;
    this.root.addChild(this.character);
    this.root.addChild(this.boss);
  }

  /** Sets the local character's portrait (TNA-root-relative name). */
  showCharacter(portrait: string): void {
    if (portrait === this.characterName) {
      return;
    }
    this.characterName = portrait;
    this.character.texture = null;
    this.character.visible = false;
    this.characterRequested = false;
    this.characterFlashMs = 0;
    this.requestCharacter();
  }

  /**
   * Sets the boss portrait for a stage phase. A changed portrait flashes in;
   * `phase` is kept so a future phase-specific treatment can read it.
   */
  showBoss(portrait: string, phase: number): void {
    if (portrait === this.bossName) {
      return;
    }
    this.bossName = portrait;
    this.boss.texture = null;
    this.boss.visible = false;
    this.bossRequested = false;
    this.bossFlashMs = this.tuning.flashMs;
    void phase;
    this.requestBoss();
  }

  /** Brightens a portrait to full opacity for `ms`, then decays back. */
  flash(kind: 'character' | 'boss', ms: number): void {
    const duration = Number.isFinite(ms) && ms > 0 ? ms : this.tuning.flashMs;
    if (kind === 'character') {
      this.characterFlashMs = duration;
    } else {
      this.bossFlashMs = duration;
    }
  }

  /** Advances the idle phase and decays any active flash. */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }
    this.elapsedMs += dtMs;
    this.characterFlashMs = Math.max(0, this.characterFlashMs - dtMs);
    this.bossFlashMs = Math.max(0, this.bossFlashMs - dtMs);
    const scale = idleScale(this.elapsedMs, this.tuning.idlePeriodMs, this.tuning.idleScaleAmplitude);
    this.applySprite(this.character, scale, this.characterFlashMs);
    this.applySprite(this.boss, scale, this.bossFlashMs);
  }

  /** Re-anchors the portraits after a stage resize. */
  relayout(width: number, height: number): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.root.size(this.width, this.height);
    this.placeSprites();
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private applySprite(sprite: Laya.Sprite, scale: number, flashMs: number): void {
    if (sprite.texture === null) {
      sprite.visible = false;
      return;
    }
    sprite.visible = true;
    sprite.scaleX = scale;
    sprite.scaleY = scale;
    const base = this.tuning.opacity;
    const window = this.tuning.flashMs > 0 ? this.tuning.flashMs : 1;
    const flash = Math.max(0, Math.min(1, flashMs / window));
    sprite.alpha = Math.min(1, base + (1 - base) * flash);
  }

  /**
   * Places the portraits: character top-left, boss top-right. The boss pivots
   * on its top-right corner so the idle breathe grows inward and never spills
   * past the stage edge.
   */
  private placeSprites(): void {
    const margin = theme.SPACE_MD;
    const characterTexture = this.character.texture;
    if (characterTexture !== null) {
      this.character.pivot(0, 0);
      this.character.pos(margin, margin);
    }
    const bossTexture = this.boss.texture;
    if (bossTexture !== null) {
      this.boss.pivot(bossTexture.width || 0, 0);
      this.boss.pos(Math.max(margin, this.width - margin), margin);
    }
  }

  private requestCharacter(): void {
    if (this.characterRequested || this.characterName === '') {
      return;
    }
    this.characterRequested = true;
    void this.loadPortrait('character');
  }

  private requestBoss(): void {
    if (this.bossRequested || this.bossName === '') {
      return;
    }
    this.bossRequested = true;
    void this.loadPortrait('boss');
  }

  private async loadPortrait(kind: 'character' | 'boss'): Promise<void> {
    const name = kind === 'character' ? this.characterName : this.bossName;
    await this.source.load();
    await this.source.ensureImage(name);
    // The portrait may have changed while the art was in flight.
    if (name !== (kind === 'character' ? this.characterName : this.bossName)) {
      return;
    }
    const texture = this.source.image(name);
    if (kind === 'character') {
      this.character.texture = texture;
    } else {
      this.boss.texture = texture;
    }
    if (texture !== null) {
      this.placeSprites();
    }
  }
}
