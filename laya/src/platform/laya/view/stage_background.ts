/**
 * Four-sprite stage background.
 *
 * Mirrors the reference `GameLayer::resetBackGround` / `updateImage` model
 * (spec §1.2–§1.4) rather than a generic parallax scroll:
 *
 *   layer 1 — two `bg_XX_01.png` tiles at scale **2.0**, centres 512 reference
 *             px apart vertically, scrolling **down** at 60 px/s so the pair
 *             tiles seamlessly;
 *   layer 2 — two `bg_XX_02.png` tiles at scale **2.4**, exactly overlapping at
 *             the centre, counter-rotating at **±15°/s** to form a symmetric
 *             vortex.
 *
 * There is no animated scale: the reference calls `setScale` exactly once per
 * sprite (spec §1.6). The whole model is scaled by `coveredHeight / 480` so the
 * same proportions hold on the client's variable-size playfield — the pure
 * arithmetic lives in `core/game/stage_visual`.
 *
 * The layer covers the **playfield** (the client's analogue of the reference's
 * 320×480 stage); the caller positions `root` over it. Art loads asynchronously
 * through the shared TNA frame source; until it arrives the layer draws nothing
 * (never throws), and a missing texture degrades to an empty field.
 *
 * NOTE: `platform/laya/` only. Never import from `core/` other than the
 *       engine-agnostic art-name / tuning / geometry helpers.
 */

import { backgroundNames } from '../../../core/game/stage_art';
import {
  DEFAULT_STAGE_BACKGROUND_TUNING,
  type StageBackgroundTuning,
} from '../../../core/game/tna_stage_tuning';
import {
  backgroundScale,
  layer2RotationDeg,
  layerTileOffsets,
} from '../../../core/game/stage_visual';
import { sharedTnaFrameSource, type LayaAtlasFrameSource } from './bullet_atlas';

export class StageBackgroundLayer {
  readonly root: Laya.Sprite;

  private readonly source: LayaAtlasFrameSource;
  private readonly tuning: StageBackgroundTuning;
  /** Layer-1 tiles (`bg_XX_01`), one spacing apart, scrolling down. */
  private readonly layer1: [Laya.Sprite, Laya.Sprite];
  /** Layer-2 tiles (`bg_XX_02`), overlapping and counter-rotating. */
  private readonly layer2: [Laya.Sprite, Laya.Sprite];
  private names: [string, string] = ['', ''];
  private stage = 0;
  private width = 0;
  private height = 0;
  private elapsedMs = 0;
  private requested = false;

  constructor(
    tuning: StageBackgroundTuning = DEFAULT_STAGE_BACKGROUND_TUNING,
    source: LayaAtlasFrameSource = sharedTnaFrameSource(),
  ) {
    this.tuning = tuning;
    this.source = source;
    this.root = new Laya.Sprite();
    this.root.mouseEnabled = false;
    this.layer1 = [this.makeTile(), this.makeTile()];
    this.layer2 = [this.makeTile(), this.makeTile()];
    for (const tile of [...this.layer1, ...this.layer2]) {
      this.root.addChild(tile);
    }
  }

  /** Selects the two background textures for a reference stage (unknown → 1). */
  setStage(stage: number): void {
    if (this.stage === stage && this.names[0] !== '') {
      return;
    }
    this.stage = stage;
    this.names = backgroundNames(stage);
    this.elapsedMs = 0;
    this.requested = false;
    for (const tile of [...this.layer1, ...this.layer2]) {
      tile.texture = null;
      tile.visible = false;
    }
  }

  /** Re-tiles for a new playfield size and re-applies the static scales. */
  relayout(width: number, height: number): void {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.root.size(this.width, this.height);
    this.applyScales();
    this.applyFrame();
  }

  /** Advances the scroll/rotation clock by `dtMs` and repositions the tiles. */
  update(dtMs: number): void {
    if (!this.requested) {
      this.requested = true;
      void this.loadTextures();
    }
    if (Number.isFinite(dtMs) && dtMs > 0) {
      this.elapsedMs += dtMs;
    }
    this.applyFrame();
  }

  destroy(): void {
    this.root.destroy(true);
  }

  private makeTile(): Laya.Sprite {
    const tile = new Laya.Sprite();
    tile.mouseEnabled = false;
    tile.visible = false;
    return tile;
  }

  /** Static scale of every tile: `referenceScale * coveredHeight / 480`. */
  private applyScales(): void {
    const factor = backgroundScale(this.height, this.tuning.referenceStageHeight);
    const scale1 = this.tuning.layer1Scale * factor;
    const scale2 = this.tuning.layer2Scale * factor;
    for (const tile of this.layer1) {
      tile.scaleX = scale1;
      tile.scaleY = scale1;
    }
    for (const tile of this.layer2) {
      tile.scaleX = scale2;
      tile.scaleY = scale2;
    }
  }

  /** Positions and rotates the four tiles for the current elapsed time. */
  private applyFrame(): void {
    const factor = backgroundScale(this.height, this.tuning.referenceStageHeight);
    const cx = this.width / 2;
    const cy = this.height / 2;
    const spacing = this.tuning.layer1SpacingPx * factor;
    const [first, second] = layerTileOffsets(
      this.elapsedMs,
      spacing,
      this.tuning.layer1ScrollPxPerFrame,
      this.tuning.framesPerSecond,
    );
    this.place(this.layer1[0], cx, cy + first, 0);
    this.place(this.layer1[1], cx, cy + second, 0);
    const spin = layer2RotationDeg(
      this.elapsedMs,
      this.tuning.layer2RotationDegPerFrame,
      this.tuning.framesPerSecond,
      1,
    );
    // Spec §1.4 also holds layer 2 still for stage 22 when `boss & ~1 == 0xc`
    // (boss 12/13). That branch is deliberately not modelled: the client only
    // maps the four lobby stages onto reference stages 1..4, so stage 22 — and
    // with it every boss id that reaches it — is unreachable here.
    this.place(this.layer2[0], cx, cy, spin);
    this.place(this.layer2[1], cx, cy, -spin);
  }

  /** Centres `tile` on `(x, y)` and rotates it; hidden while it has no texture. */
  private place(tile: Laya.Sprite, x: number, y: number, rotationDeg: number): void {
    const texture = tile.texture;
    if (texture === null) {
      tile.visible = false;
      return;
    }
    tile.pivot((texture.width || 0) / 2, (texture.height || 0) / 2);
    tile.pos(x, y);
    tile.rotation = rotationDeg;
    tile.visible = true;
  }

  private async loadTextures(): Promise<void> {
    await this.source.load();
    const [farName, nearName] = this.names;
    if (farName === '') {
      return;
    }
    await this.source.ensureImage(farName);
    await this.source.ensureImage(nearName);
    // The stage may have changed while the art was in flight: drop a stale load.
    if (farName !== this.names[0] || nearName !== this.names[1]) {
      return;
    }
    const farTexture = this.source.image(farName);
    const nearTexture = this.source.image(nearName);
    for (const tile of this.layer1) {
      tile.texture = farTexture;
    }
    for (const tile of this.layer2) {
      tile.texture = nearTexture;
    }
    this.applyScales();
    this.applyFrame();
  }
}
